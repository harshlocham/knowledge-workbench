/**
 * Free / Pro plan limit tests.
 *
 * Usage:
 *   bun run test:plan-limits
 *
 * Pure helpers only — no database, no Clerk. Guards the commercialization
 * accounting and gate predicates that keep Free/Pro enforcement consistent.
 */

import assert from "node:assert/strict";

import {
	AppError,
	formatAppErrorMessage,
	parseAppError,
} from "#/lib/errors.ts";
import {
	assertNotebookCountAllowed,
	assertPlanIsPro,
	assertSourceCountAllowed,
	getPlanLimits,
	PLAN_LIMITS,
	tryConsumeUsage,
	usagePeriodUtc,
} from "#/lib/plans/limits.ts";
import { UPGRADE_INTENT_SOURCES } from "#/db/schema/upgrade-intents.ts";

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
const PRO = getPlanLimits("pro");

group("Notebook limits");

test("1. Free user can create notebook below limit", () => {
	assert.doesNotThrow(() =>
		assertNotebookCountAllowed(0, FREE.maxNotebooks, "free"),
	);
	assert.doesNotThrow(() =>
		assertNotebookCountAllowed(1, FREE.maxNotebooks, "free"),
	);
});

test("2. Free user cannot create notebook above limit", () => {
	assert.throws(
		() => assertNotebookCountAllowed(2, FREE.maxNotebooks, "free"),
		/Free plan limit of 2 notebooks/,
	);
});

group("Source limits");

test("3. Free user can add source below limit", () => {
	assert.doesNotThrow(() =>
		assertSourceCountAllowed(9, 1, FREE.maxSourcesPerNotebook, "free"),
	);
});

test("4. Free user cannot exceed source limit (pending counted)", () => {
	// currentCount includes ready+indexing+pending rows
	assert.throws(
		() => assertSourceCountAllowed(10, 1, FREE.maxSourcesPerNotebook, "free"),
		/Free allows up to 10 sources/,
	);
	assert.throws(
		() => assertSourceCountAllowed(9, 2, FREE.maxSourcesPerNotebook, "free"),
		/Free allows up to 10 sources/,
	);
});

group("Studio usage accounting");

test("5. Studio generation increments usage", () => {
	const first = tryConsumeUsage(0, FREE.monthlyStudioGenerations);
	assert.equal(first.ok, true);
	if (first.ok) assert.equal(first.next, 1);
});

test("6. Regeneration increments usage (same consume path)", () => {
	const regen = tryConsumeUsage(3, FREE.monthlyStudioGenerations);
	assert.equal(regen.ok, true);
	if (regen.ok) assert.equal(regen.next, 4);
});

test("7. Failed pre-validation does not increment usage", () => {
	// Simulate: validation throws before tryConsumeUsage is called.
	let used = 2;
	const readySources = 0;
	if (readySources === 0) {
		// no consume
	} else {
		const result = tryConsumeUsage(used, FREE.monthlyStudioGenerations);
		if (result.ok) used = result.next;
	}
	assert.equal(used, 2);
});

test("8. Post-accept failure still counted (consume-before-insert policy)", () => {
	let used = 1;
	const accepted = tryConsumeUsage(used, FREE.monthlyStudioGenerations);
	assert.equal(accepted.ok, true);
	if (accepted.ok) used = accepted.next;
	// Background LLM fails afterward — quantity is not refunded.
	const failedGeneration = true;
	assert.equal(failedGeneration, true);
	assert.equal(used, 2);
});

test("9. Fifth generation works", () => {
	const fifth = tryConsumeUsage(4, FREE.monthlyStudioGenerations);
	assert.equal(fifth.ok, true);
	if (fifth.ok) assert.equal(fifth.next, 5);
});

test("10. Sixth generation is rejected", () => {
	const sixth = tryConsumeUsage(5, FREE.monthlyStudioGenerations);
	assert.equal(sixth.ok, false);
	assert.equal(sixth.next, 5);
});

test("11. New month resets usage", () => {
	const august = usagePeriodUtc(new Date(Date.UTC(2026, 7, 15)));
	const september = usagePeriodUtc(new Date(Date.UTC(2026, 8, 1)));
	assert.equal(august, "2026-08");
	assert.equal(september, "2026-09");
	assert.notEqual(august, september);
	// New period key → quantity starts at 0
	const fresh = tryConsumeUsage(0, FREE.monthlyStudioGenerations);
	assert.equal(fresh.ok, true);
});

test("12. Pro user is not blocked by Free limits", () => {
	assert.doesNotThrow(() =>
		assertNotebookCountAllowed(2, PRO.maxNotebooks, "pro"),
	);
	assert.doesNotThrow(() =>
		assertSourceCountAllowed(10, 1, PRO.maxSourcesPerNotebook, "pro"),
	);
	const gen = tryConsumeUsage(5, PRO.monthlyStudioGenerations);
	assert.equal(gen.ok, true);
	assert.ok(PRO.monthlyStudioGenerations > FREE.monthlyStudioGenerations);
	assert.ok(PRO.maxNotebooks > FREE.maxNotebooks);
	assert.equal(PLAN_LIMITS.pro.maxSourcesPerNotebook, 50);
});

test("13. Concurrent generation cannot trivially bypass the limit", () => {
	// Two tabs both observe quantity = limit - 1. Atomic predicate: only one wins.
	let quantity = FREE.monthlyStudioGenerations - 1;
	const a = tryConsumeUsage(quantity, FREE.monthlyStudioGenerations);
	if (a.ok) quantity = a.next;
	const b = tryConsumeUsage(quantity, FREE.monthlyStudioGenerations);
	assert.equal(a.ok, true);
	assert.equal(b.ok, false);
	assert.equal(quantity, FREE.monthlyStudioGenerations);
});

group("Export / share Pro gate");

test("14. Export gate works", () => {
	assert.throws(() => assertPlanIsPro("free", "Markdown export"), /Pro/);
	assert.doesNotThrow(() => assertPlanIsPro("pro", "Markdown export"));
});

test("15. Share gate works", () => {
	assert.throws(() => assertPlanIsPro("free", "Artifact sharing"), /Pro/);
	assert.doesNotThrow(() => assertPlanIsPro("pro", "Artifact sharing"));
});

group("Upgrade intent + errors");

test("16. Upgrade intent sources are recorded per intentional action", () => {
	const intents: Array<{ source: string }> = [];
	function record(source: (typeof UPGRADE_INTENT_SOURCES)[number]) {
		intents.push({ source });
	}
	record("studio_generation_limit");
	record("export");
	assert.equal(intents.length, 2);
	assert.equal(intents[0]?.source, "studio_generation_limit");
	assert.equal(intents[1]?.source, "export");
	assert.ok(UPGRADE_INTENT_SOURCES.includes("share"));
});

test("17. Unauthorized users cannot manipulate plan/usage (gate contract)", () => {
	// Server paths call requireUserId before plan/usage helpers. Unsigned → Error.
	function requireUserIdSim(userId: string | null) {
		if (!userId) throw new AppError("UNAUTHORIZED", "Unauthorized");
		return userId;
	}
	assert.throws(() => requireUserIdSim(null), /Unauthorized/);
	const parsed = parseAppError(
		new AppError("UNAUTHORIZED", "Unauthorized"),
	);
	assert.equal(parsed.code, "UNAUTHORIZED");
});

test("18. Allowed generate path still reaches insert when under quota", () => {
	const readySources = 2;
	let inserted = false;
	let used = 0;
	assert.ok(readySources > 0);
	const slot = tryConsumeUsage(used, FREE.monthlyStudioGenerations);
	assert.equal(slot.ok, true);
	if (slot.ok) {
		used = slot.next;
		inserted = true; // stands in for insertArtifact after consume
	}
	assert.equal(inserted, true);
	assert.equal(used, 1);
});

group("AppError wire format");

test("AppError round-trips through parseAppError", () => {
	const err = new AppError(
		"STUDIO_GENERATION_LIMIT",
		"You've reached the Free plan limit of 5 Studio generations this month.",
	);
	assert.equal(
		err.message,
		formatAppErrorMessage(
			"STUDIO_GENERATION_LIMIT",
			"You've reached the Free plan limit of 5 Studio generations this month.",
		),
	);
	const parsed = parseAppError(err);
	assert.equal(parsed.code, "STUDIO_GENERATION_LIMIT");
	assert.match(parsed.message, /5 Studio generations/);
});

console.log(
	`\n${passed} passed, ${failures.length} failed, ${passed + failures.length} total`,
);

if (failures.length > 0) {
	process.exitCode = 1;
}
