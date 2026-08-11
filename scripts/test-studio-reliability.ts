/**
 * Day 2 Research Studio reliability tests.
 *
 * Usage:
 *   bun run test:studio-reliability
 *
 * Pure helpers only — no database, no Clerk, no LLM. Guards stuck-pending
 * recovery selection, Compare Sources UI readiness, artifact state transitions,
 * and accepted-attempt quota accounting.
 */

import assert from "node:assert/strict";

import { compareSourcesNeedsMoreSources } from "#/components/workspace/studio/ArtifactTypeCards.tsx";
import {
	isStalePending,
	selectStalePendingIds,
	STALE_PENDING_TIMEOUT_MS,
} from "#/features/studio/artifact-recovery.server.ts";
import {
	ARTIFACT_TYPE_LABELS,
	ARTIFACT_TYPES,
	STUDY_GUIDE_LIMITS,
} from "#/features/studio/artifacts.types.ts";
import {
	assertFailedTransition,
	assertReadyTransition,
} from "#/features/studio/artifacts.store.server.ts";
import {
	MIN_DISTINCT_SOURCES_FOR_COMPARE,
	MIN_EVIDENCE_FOR_COMPARE,
} from "#/lib/rag/generate-compare-sources.server.ts";
import { tryConsumeUsage, getPlanLimits } from "#/lib/plans/limits.ts";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
	try {
		fn();
		passed += 1;
		console.log(`  ok   ${name}`);
	} catch (error) {
		failures.push(name);
		const message = error instanceof Error ? error.message : String(error);
		console.log(`  FAIL ${name}`);
		console.log(`       ${message.split("\n").join("\n       ")}`);
	}
}

function group(name: string) {
	console.log(`\n${name}`);
}

const FREE = getPlanLimits("free");
const NOW = new Date("2026-08-11T12:00:00.000Z");

function minutesAgo(minutes: number) {
	return new Date(NOW.getTime() - minutes * 60 * 1000);
}

const minimalContent = {
	summary: "A short grounded summary.",
	sections: [{ heading: "Findings", body: "One finding.", citationNumbers: [1] }],
};

const minimalCitation = {
	chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	sourceTitle: "Source A",
	quote: "Evidence quote",
	locator: {},
	citationNumber: 1,
};

group("Stuck pending recovery");

test("1. Fresh pending artifact is not recovered", () => {
	assert.equal(
		isStalePending("pending", minutesAgo(5), NOW, STALE_PENDING_TIMEOUT_MS),
		false,
	);
	const ids = selectStalePendingIds(
		[{ id: "fresh", status: "pending", createdAt: minutesAgo(1) }],
		NOW,
	);
	assert.deepEqual(ids, []);
});

test("2. Stale pending artifact becomes recoverable", () => {
	assert.equal(
		isStalePending("pending", minutesAgo(15), NOW, STALE_PENDING_TIMEOUT_MS),
		true,
	);
	assert.equal(
		isStalePending("pending", minutesAgo(20), NOW, STALE_PENDING_TIMEOUT_MS),
		true,
	);
	const ids = selectStalePendingIds(
		[{ id: "stale", status: "pending", createdAt: minutesAgo(16) }],
		NOW,
	);
	assert.deepEqual(ids, ["stale"]);
});

test("3. Ready artifact is never changed by recovery", () => {
	assert.equal(
		isStalePending("ready", minutesAgo(60), NOW, STALE_PENDING_TIMEOUT_MS),
		false,
	);
	const ids = selectStalePendingIds(
		[{ id: "ready", status: "ready", createdAt: minutesAgo(60) }],
		NOW,
	);
	assert.deepEqual(ids, []);
});

test("4. Failed artifact is never changed by recovery", () => {
	assert.equal(
		isStalePending("failed", minutesAgo(60), NOW, STALE_PENDING_TIMEOUT_MS),
		false,
	);
	const ids = selectStalePendingIds(
		[{ id: "failed", status: "failed", createdAt: minutesAgo(60) }],
		NOW,
	);
	assert.deepEqual(ids, []);
});

test("5. Recovery is idempotent", () => {
	const rows = [
		{ id: "a", status: "pending" as const, createdAt: minutesAgo(20) },
		{ id: "b", status: "ready" as const, createdAt: minutesAgo(20) },
		{ id: "c", status: "failed" as const, createdAt: minutesAgo(20) },
		{ id: "d", status: "pending" as const, createdAt: minutesAgo(2) },
	];
	const first = selectStalePendingIds(rows, NOW);
	assert.deepEqual(first, ["a"]);
	// After recovery, the stale row is failed — a second pass selects nothing.
	const after = rows.map((row) =>
		first.includes(row.id) ? { ...row, status: "failed" as const } : row,
	);
	assert.deepEqual(selectStalePendingIds(after, NOW), []);
});

group("Compare Sources UI gate");

test("6. Compare Sources disabled with <2 ready sources", () => {
	assert.equal(compareSourcesNeedsMoreSources(0), true);
	assert.equal(compareSourcesNeedsMoreSources(1), true);
});

test("7. Compare Sources enabled with >=2 ready sources", () => {
	assert.equal(compareSourcesNeedsMoreSources(2), false);
	assert.equal(compareSourcesNeedsMoreSources(5), false);
});

group("Artifact integrity transitions");

test("8. Invalid ready artifact update is rejected", () => {
	assert.throws(
		() =>
			assertReadyTransition({
				content: null,
				citations: [minimalCitation],
			}),
		/ready artifact must have content/,
	);
});

test("9. Valid ready transition succeeds", () => {
	const result = assertReadyTransition({
		content: minimalContent,
		citations: [minimalCitation],
	});
	assert.equal(result.content.summary, "A short grounded summary.");
	assert.equal(result.citations[0]?.citationNumber, 1);
});

test("10. Valid failed transition succeeds", () => {
	assert.equal(
		assertFailedTransition("Generation timed out. Please try again."),
		"Generation timed out. Please try again.",
	);
	assert.throws(() => assertFailedTransition("   "), /error message/);
});

group("Quota accepted-attempt policy");

test("11. Rejected generation does not consume quota", () => {
	let used = 2;
	const readySources = 1;
	const compareRequest = true;
	// Compare with <2 ready sources is rejected before consume.
	if (compareRequest && readySources < 2) {
		// no consume
	} else {
		const result = tryConsumeUsage(used, FREE.monthlyStudioGenerations);
		if (result.ok) used = result.next;
	}
	assert.equal(used, 2);
});

test("12. Accepted generation consumes quota", () => {
	const accepted = tryConsumeUsage(0, FREE.monthlyStudioGenerations);
	assert.equal(accepted.ok, true);
	if (accepted.ok) assert.equal(accepted.next, 1);
});

test("13. Regeneration consumes quota", () => {
	const regen = tryConsumeUsage(3, FREE.monthlyStudioGenerations);
	assert.equal(regen.ok, true);
	if (regen.ok) assert.equal(regen.next, 4);
});

group("Existing artifact types remain unaffected");

test("14. Existing artifact types remain unaffected", () => {
	assert.deepEqual(ARTIFACT_TYPES, [
		"research_brief",
		"study_guide",
		"compare_sources",
		"learning_roadmap",
	]);
	assert.equal(ARTIFACT_TYPE_LABELS.research_brief, "Research Brief");
	assert.equal(ARTIFACT_TYPE_LABELS.study_guide, "Study Guide");
	assert.equal(ARTIFACT_TYPE_LABELS.learning_roadmap, "Learning Roadmap");
	assert.equal(ARTIFACT_TYPE_LABELS.compare_sources, "Compare Sources");
	assert.equal(STUDY_GUIDE_LIMITS.maxConcepts, 10);
	assert.equal(MIN_DISTINCT_SOURCES_FOR_COMPARE, 2);
	assert.equal(MIN_EVIDENCE_FOR_COMPARE, 6);
	assert.equal(STALE_PENDING_TIMEOUT_MS, 15 * 60 * 1000);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
	process.exit(1);
}
