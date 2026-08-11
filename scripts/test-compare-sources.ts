/**
 * Compare Sources validation tests.
 *
 * Usage:
 *   bun run test:compare
 *
 * Exercises the pure post-processing helpers with synthetic evidence — no LLM,
 * no database. Guards the cross-source rules that make a comparison trustworthy.
 */

import assert from "node:assert/strict";

import type { ArtifactEvidence } from "#/lib/rag/artifact-citations.ts";
import { createCitationMapper } from "#/lib/rag/artifact-citations.ts";
import {
	buildCompareSourcesFromLlm,
	keepComparisonRow,
	keepCrossSourceItem,
	keepSourceSpecificItem,
	MIN_DISTINCT_SOURCES_FOR_COMPARE,
	MIN_EVIDENCE_FOR_COMPARE,
	type LlmCompareSources,
} from "#/lib/rag/generate-compare-sources.server.ts";
import { STUDY_GUIDE_LIMITS } from "#/features/studio/artifacts.types.ts";

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

const SOURCE_A = "11111111-1111-4111-8111-111111111111";
const SOURCE_B = "22222222-2222-4222-8222-222222222222";
const SOURCE_C = "33333333-3333-4333-8333-333333333333";

function evidence(
	index: number,
	sourceId: string,
	sourceTitle: string,
	text = `Excerpt ${index}`,
): ArtifactEvidence {
	return {
		index,
		chunkId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		sourceId,
		sourceTitle,
		text,
		locator: {},
	};
}

/** Six excerpts across two sources — enough to clear the evidence floor. */
function twoSourceEvidence(): ArtifactEvidence[] {
	return [
		evidence(1, SOURCE_A, "Handbook", "Narrow unknown values before use."),
		evidence(2, SOURCE_A, "Handbook", "Prefer discriminated unions."),
		evidence(3, SOURCE_A, "Handbook", "Type predicates refine unions."),
		evidence(4, SOURCE_B, "Course", "Always narrow unknown before use."),
		evidence(5, SOURCE_B, "Course", "Use as assertions sparingly."),
		evidence(6, SOURCE_B, "Course", "Prefer runtime checks over casts."),
	];
}

/**
 * Enough cross-source material that a successful build clears the citation floor
 * (overview + agreements spanning four distinct excerpts).
 */
function richLlm(overrides: Partial<LlmCompareSources> = {}): LlmCompareSources {
	return {
		title: "TypeScript narrowing compared",
		overview: {
			text: "Both sources teach how to narrow unions safely.",
			evidenceIndexes: [1, 4],
		},
		sharedUnderstanding: [
			{
				text: "Unknown values must be narrowed before use.",
				evidenceIndexes: [1, 4],
			},
		],
		agreements: [
			{
				text: "Both warn against careless casts.",
				evidenceIndexes: [2, 5],
			},
		],
		disagreements: [],
		sourceSpecificInsights: [],
		comparisonTable: [],
		conclusion: [
			{
				text: "Narrowing is the shared baseline.",
				evidenceIndexes: [3, 6],
			},
		],
		...overrides,
	};
}

// ---------------------------------------------------------------------------

group("cross-source item filtering");

{
	const items = twoSourceEvidence();
	const mapper = createCitationMapper(items);

	test("two sources → agreement survives", () => {
		const kept = keepCrossSourceItem(mapper, {
			text: "Both recommend narrowing unknown values before use.",
			evidenceIndexes: [1, 4],
		});
		assert.ok(kept);
		assert.deepEqual(kept.indexes, [1, 4]);
	});

	test("two sources → disagreement survives", () => {
		const kept = keepCrossSourceItem(mapper, {
			text: "The Handbook prefers unions; the Course leans on runtime checks.",
			evidenceIndexes: [2, 6],
		});
		assert.ok(kept);
		assert.equal(kept.indexes.length, 2);
	});

	test("agreement citing only one source → dropped", () => {
		const kept = keepCrossSourceItem(mapper, {
			text: "Narrowing is important.",
			evidenceIndexes: [1, 2, 3],
		});
		assert.equal(kept, null);
	});

	test("disagreement citing only one source → dropped", () => {
		const kept = keepCrossSourceItem(mapper, {
			text: "The Course contradicts itself somehow.",
			evidenceIndexes: [4, 5],
		});
		assert.equal(kept, null);
	});

	test("invalid evidence index → dropped", () => {
		const kept = keepCrossSourceItem(mapper, {
			text: "Invented claim.",
			evidenceIndexes: [99, 100],
		});
		assert.equal(kept, null);
	});

	test("keepCrossSourceItem does not commit citations", () => {
		keepCrossSourceItem(mapper, {
			text: "Both recommend narrowing.",
			evidenceIndexes: [1, 4],
		});
		assert.equal(mapper.citations().length, 0);
	});
}

// ---------------------------------------------------------------------------

group("source-specific insights");

{
	const items = twoSourceEvidence();
	const mapper = createCitationMapper(items);
	const byIndex = new Map(items.map((item) => [item.index, item]));

	test("source-specific item may use one source", () => {
		const kept = keepSourceSpecificItem(mapper, byIndex, SOURCE_A, {
			text: "The Handbook uniquely covers type predicates.",
			evidenceIndexes: [3],
		});
		assert.ok(kept);
		assert.deepEqual(kept.indexes, [3]);
	});

	test("source-specific item drops indexes from other sources", () => {
		const kept = keepSourceSpecificItem(mapper, byIndex, SOURCE_A, {
			text: "Mixed indexes should not leak.",
			evidenceIndexes: [3, 4],
		});
		assert.ok(kept);
		assert.deepEqual(kept.indexes, [3]);
	});

	test("source-specific item with only foreign indexes is dropped", () => {
		const kept = keepSourceSpecificItem(mapper, byIndex, SOURCE_A, {
			text: "Wrong source entirely.",
			evidenceIndexes: [4, 5],
		});
		assert.equal(kept, null);
	});
}

// ---------------------------------------------------------------------------

group("comparison table");

{
	const items = twoSourceEvidence();
	const mapper = createCitationMapper(items);
	const byIndex = new Map(items.map((item) => [item.index, item]));
	const titles = new Map(items.map((item) => [item.sourceId, item.sourceTitle]));

	test("table row with two valid entries survives", () => {
		const kept = keepComparisonRow(mapper, byIndex, titles, {
			claim: "How to narrow unknown",
			entries: [
				{
					sourceId: SOURCE_A,
					position: "Use typeof and type predicates.",
					evidenceIndexes: [1],
				},
				{
					sourceId: SOURCE_B,
					position: "Prefer runtime checks.",
					evidenceIndexes: [6],
				},
			],
		});
		assert.ok(kept);
		assert.equal(kept.entries.length, 2);
		assert.equal(kept.entries[0]?.sourceTitle, "Handbook");
		assert.equal(kept.entries[1]?.sourceTitle, "Course");
	});

	test("table row with one valid entry is dropped", () => {
		const kept = keepComparisonRow(mapper, byIndex, titles, {
			claim: "Incomplete row",
			entries: [
				{
					sourceId: SOURCE_A,
					position: "Only one side.",
					evidenceIndexes: [1],
				},
				{
					sourceId: SOURCE_B,
					position: "Bad indexes.",
					evidenceIndexes: [99],
				},
			],
		});
		assert.equal(kept, null);
	});

	test("table entry with mismatched sourceId is dropped", () => {
		const kept = keepComparisonRow(mapper, byIndex, titles, {
			claim: "Mismatched",
			entries: [
				{
					sourceId: SOURCE_A,
					position: "Claims A but cites B.",
					evidenceIndexes: [4],
				},
				{
					sourceId: SOURCE_B,
					position: "Course position.",
					evidenceIndexes: [5],
				},
			],
		});
		// First entry dies (indexes belong to B), leaving only one — whole row drops.
		assert.equal(kept, null);
	});
}

// ---------------------------------------------------------------------------

group("buildCompareSourcesFromLlm");

{
	test("two-source agreement is committed with citation numbers", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm(),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		assert.ok(
			(artifact.content.compareSources?.agreements.length ?? 0) >= 1 ||
				(artifact.content.compareSources?.sharedUnderstanding.length ?? 0) >= 1,
		);
		assert.ok(artifact.citations.length >= 4);
		assert.ok(
			artifact.citations.every((citation) => citation.citationNumber != null),
		);
	});

	test("single-source agreement is dropped and leaves no orphan citation", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm({
				agreements: [
					{
						text: "Only Handbook says this.",
						evidenceIndexes: [1, 2],
					},
					{
						text: "Both warn against careless casts.",
						evidenceIndexes: [2, 5],
					},
				],
			}),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		const texts =
			artifact.content.compareSources?.agreements.map((item) => item.text) ??
			[];
		assert.ok(!texts.some((text) => text.includes("Only Handbook")));
		assert.ok(texts.some((text) => text.includes("careless casts")));
		const numbers = new Set(
			artifact.citations.map((citation) => citation.citationNumber),
		);
		for (const item of [
			...(artifact.content.compareSources?.sharedUnderstanding ?? []),
			...(artifact.content.compareSources?.agreements ?? []),
			...(artifact.content.compareSources?.conclusion ?? []),
		]) {
			for (const number of item.citationNumbers) {
				assert.ok(numbers.has(number));
			}
		}
	});

	test("empty comparison after filtering is rejected", () => {
		assert.throws(
			() =>
				buildCompareSourcesFromLlm({
					llm: richLlm({
						sharedUnderstanding: [],
						agreements: [
							{
								text: "Single source only.",
								evidenceIndexes: [1, 2],
							},
						],
						disagreements: [
							{
								text: "Also single source.",
								evidenceIndexes: [4],
							},
						],
						comparisonTable: [],
						conclusion: [],
					}),
					evidence: twoSourceEvidence(),
					notebookTitle: "TS Notes",
				}),
			/did not yield any grounded/,
		);
	});

	test("distinct-source floor rejects one-source evidence", () => {
		const oneSource = [
			evidence(1, SOURCE_A, "Handbook"),
			evidence(2, SOURCE_A, "Handbook"),
			evidence(3, SOURCE_A, "Handbook"),
			evidence(4, SOURCE_A, "Handbook"),
			evidence(5, SOURCE_A, "Handbook"),
			evidence(6, SOURCE_A, "Handbook"),
		];

		assert.throws(
			() =>
				buildCompareSourcesFromLlm({
					llm: richLlm(),
					evidence: oneSource,
					notebookTitle: "TS Notes",
				}),
			/at least two distinct sources/,
		);
	});

	test("insufficient evidence count is rejected", () => {
		assert.throws(
			() =>
				buildCompareSourcesFromLlm({
					llm: richLlm(),
					evidence: [
						evidence(1, SOURCE_A, "Handbook"),
						evidence(2, SOURCE_B, "Course"),
					],
					notebookTitle: "TS Notes",
				}),
			/not enough|usable excerpt/i,
		);
	});

	test("citation numbers are assigned only after validation", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm({
				agreements: [
					{
						text: "Dropped — one source.",
						evidenceIndexes: [1, 2],
					},
					{
						text: "Kept — two sources.",
						evidenceIndexes: [2, 5],
					},
				],
			}),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		const agreements = artifact.content.compareSources?.agreements ?? [];
		assert.ok(agreements.every((item) => !item.text.includes("Dropped")));
		assert.ok(agreements.some((item) => item.text.includes("Kept")));
		assert.ok(artifact.citations.length >= 4);
		assert.deepEqual(
			artifact.citations.map((citation) => citation.citationNumber),
			artifact.citations.map((_, i) => i + 1),
		);
	});

	test("comparison table entries resolve to real evidence and titles", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm({
				comparisonTable: [
					{
						claim: "Preferred narrowing style",
						entries: [
							{
								sourceId: SOURCE_A,
								sourceTitle: "WRONG TITLE",
								position: "Discriminated unions.",
								evidenceIndexes: [2],
							},
							{
								sourceId: SOURCE_B,
								sourceTitle: "ALSO WRONG",
								position: "Runtime checks.",
								evidenceIndexes: [6],
							},
						],
					},
				],
			}),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		const row = artifact.content.compareSources?.comparisonTable[0];
		assert.ok(row);
		assert.equal(row.entries.length, 2);
		assert.equal(row.entries[0]?.sourceTitle, "Handbook");
		assert.equal(row.entries[1]?.sourceTitle, "Course");
		assert.ok(row.entries[0]!.citationNumbers.length > 0);
		assert.ok(row.entries[1]!.citationNumbers.length > 0);
	});

	test("source-specific insight survives with one source", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm({
				sourceSpecificInsights: [
					{
						sourceId: SOURCE_A,
						sourceTitle: "Ignored",
						items: [
							{
								text: "Type predicates are Handbook-only here.",
								evidenceIndexes: [3],
							},
						],
					},
				],
			}),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		assert.equal(
			artifact.content.compareSources?.sourceSpecificInsights.length,
			1,
		);
		assert.equal(
			artifact.content.compareSources?.sourceSpecificInsights[0]?.sourceTitle,
			"Handbook",
		);
	});

	test("unknown sourceId in insights is ignored", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm({
				sourceSpecificInsights: [
					{
						sourceId: SOURCE_C,
						sourceTitle: "Ghost",
						items: [
							{
								text: "Should vanish.",
								evidenceIndexes: [1],
							},
						],
					},
				],
			}),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		assert.equal(
			artifact.content.compareSources?.sourceSpecificInsights.length,
			0,
		);
	});

	test("empty sections are omitted from the generic projection", () => {
		const artifact = buildCompareSourcesFromLlm({
			llm: richLlm({
				disagreements: [],
				comparisonTable: [],
			}),
			evidence: twoSourceEvidence(),
			notebookTitle: "TS Notes",
		});

		const headings = artifact.content.sections.map((section) => section.heading);
		assert.ok(headings.includes("Overview"));
		assert.ok(headings.includes("Areas of Agreement"));
		assert.ok(!headings.includes("Areas of Disagreement"));
		assert.ok(!headings.includes("Evidence Comparison"));
	});
}

// ---------------------------------------------------------------------------

group("existing artifact types remain unaffected");

{
	test("Study Guide limits constant is unchanged", () => {
		assert.equal(STUDY_GUIDE_LIMITS.maxConcepts, 10);
		assert.equal(STUDY_GUIDE_LIMITS.maxPrerequisites, 6);
	});

	test("compare floors stay at the planned values", () => {
		assert.equal(MIN_EVIDENCE_FOR_COMPARE, 6);
		assert.equal(MIN_DISTINCT_SOURCES_FOR_COMPARE, 2);
	});
}

// ---------------------------------------------------------------------------

console.log(
	`\n${passed} passed, ${failures.length} failed${
		failures.length > 0 ? `\n  - ${failures.join("\n  - ")}` : ""
	}`,
);

process.exit(failures.length > 0 ? 1 : 0);
