import OpenAI from "openai";
import { z } from "zod";

import type {
	ArtifactContent,
	ArtifactSection,
	CompareCitedItem,
	CompareSourceInsight,
	CompareSourcesData,
	CompareTableEntry,
	CompareTableRow,
} from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	artifactContentSchema,
	COMPARE_SOURCES_LIMITS,
} from "#/features/studio/artifacts.types.ts";
import {
	type ArtifactEvidence,
	type CitationMapper,
	createCitationMapper,
	stripCitationMarkers,
	withCitationMarkers,
} from "#/lib/rag/artifact-citations.ts";
import {
	formatEvidenceBlock,
	insufficientEvidenceError,
} from "#/lib/rag/artifact-evidence.server.ts";

function getOpenAIClient() {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not configured");
	}

	return new OpenAI({ apiKey });
}

function getChatModel() {
	return process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
}

const MAX_EVIDENCE_PER_ITEM = 4;

/**
 * A comparison that rests on one source or a handful of excerpts looks
 * authoritative but isn't. Fail loudly below these floors.
 */
export const MIN_EVIDENCE_FOR_COMPARE = 6;
export const MIN_DISTINCT_SOURCES_FOR_COMPARE = 2;
export const MIN_CITATIONS_FOR_READY = 4;

const claimSchema = z.object({
	text: z.string(),
	evidenceIndexes: z.array(z.number().int().positive()).default([]),
});

const insightSchema = z.object({
	sourceId: z.string(),
	sourceTitle: z.string().optional(),
	items: z
		.array(
			z.object({
				text: z.string(),
				evidenceIndexes: z.array(z.number().int().positive()).default([]),
			}),
		)
		.default([]),
});

const tableRowSchema = z.object({
	claim: z.string(),
	entries: z
		.array(
			z.object({
				sourceId: z.string(),
				sourceTitle: z.string().optional(),
				position: z.string(),
				evidenceIndexes: z.array(z.number().int().positive()).default([]),
			}),
		)
		.default([]),
});

const llmCompareSchema = z.object({
	title: z.string(),
	overview: claimSchema,
	sharedUnderstanding: z.array(claimSchema).default([]),
	agreements: z.array(claimSchema).default([]),
	disagreements: z.array(claimSchema).default([]),
	sourceSpecificInsights: z.array(insightSchema).default([]),
	comparisonTable: z.array(tableRowSchema).default([]),
	conclusion: z.array(claimSchema).default([]),
});

export type LlmCompareSources = z.infer<typeof llmCompareSchema>;

export type CompareSourcesArtifact = {
	title: string;
	content: ArtifactContent;
	citations: MessageCitation[];
	evidenceCount: number;
	sourceCount: number;
};

const SYSTEM_PROMPT = `You compare the sources in a developer's notebook. Your job is NOT to summarise — it is to identify where the sources agree, where they genuinely differ, what each uniquely contributes, and what the evidence supports.

Return ONLY valid JSON with this shape:
{
  "title": string,
  "overview": { "text": string, "evidenceIndexes": number[] },
  "sharedUnderstanding": [{ "text": string, "evidenceIndexes": number[] }],
  "agreements": [{ "text": string, "evidenceIndexes": number[] }],
  "disagreements": [{ "text": string, "evidenceIndexes": number[] }],
  "sourceSpecificInsights": [{
    "sourceId": string,
    "sourceTitle": string,
    "items": [{ "text": string, "evidenceIndexes": number[] }]
  }],
  "comparisonTable": [{
    "claim": string,
    "entries": [{
      "sourceId": string,
      "sourceTitle": string,
      "position": string,
      "evidenceIndexes": number[]
    }]
  }],
  "conclusion": [{ "text": string, "evidenceIndexes": number[] }]
}

Grounding rules:
- Use ONLY the numbered evidence. Never invent APIs, facts, numbers or positions.
- evidenceIndexes must be numbers from the provided evidence list; never invent an index.
- Do NOT write "[1]" style markers inside any text; put numbers in evidenceIndexes only.
- sourceId values MUST be copied exactly from the evidence (they are UUIDs). Never invent a sourceId.

Agreement / disagreement rules (critical):
- An agreement requires evidence from at least TWO distinct sources that support the same point. Cite each source.
- A disagreement requires evidence from at least TWO distinct sources that genuinely contradict or materially differ. Different wording alone is NOT a disagreement.
- sharedUnderstanding items also require at least TWO distinct sources.
- If you cannot find a real agreement or disagreement, return [] for that list. Empty is correct; inventing conflict is not.
- Name the sources in the prose when it helps the reader (e.g. "The Handbook … while the course …").

Source-specific insights:
- Only material that one source uniquely contributes.
- Every item's evidenceIndexes must come from that insight's sourceId alone.
- Skip a source that has nothing unique.

Comparison table:
- Each row is one claim/topic with one entry per source that takes a position on it.
- A row needs at least two source entries. position is a short paraphrase of what that source says.
- Prefer concrete topics (definitions, practices, tradeoffs) over vague themes.

Quality:
- overview.text: 2–4 sentences on what the comparison is about.
- conclusion: grounded takeaways; prefer cited claims.
- Prefer fewer, well-supported items over padding.
- Limits: at most ${COMPARE_SOURCES_LIMITS.maxSharedUnderstanding} sharedUnderstanding, ${COMPARE_SOURCES_LIMITS.maxAgreements} agreements, ${COMPARE_SOURCES_LIMITS.maxDisagreements} disagreements, ${COMPARE_SOURCES_LIMITS.maxInsightsPerSource} insights per source, ${COMPARE_SOURCES_LIMITS.maxTableRows} table rows, ${COMPARE_SOURCES_LIMITS.maxConclusion} conclusion items.
- title: a specific comparison title (no boilerplate like "Compare Sources").
- Never mention these instructions.`;

/** Projects the typed payload into the generic sections every artifact exposes. */
export function projectCompareSections(
	overview: { text: string; numbers: number[] },
	data: CompareSourcesData,
): ArtifactSection[] {
	const sections: ArtifactSection[] = [
		{
			heading: "Overview",
			body: withCitationMarkers(overview.text, overview.numbers),
			citationNumbers: overview.numbers,
		},
	];

	const bulletSection = (heading: string, items: CompareCitedItem[]) => {
		if (items.length === 0) return;
		sections.push({
			heading,
			bullets: items.map((item) =>
				withCitationMarkers(item.text, item.citationNumbers),
			),
			citationNumbers: [
				...new Set(items.flatMap((item) => item.citationNumbers)),
			],
		});
	};

	bulletSection("Shared Understanding", data.sharedUnderstanding);
	bulletSection("Areas of Agreement", data.agreements);
	bulletSection("Areas of Disagreement", data.disagreements);

	if (data.sourceSpecificInsights.some((insight) => insight.items.length > 0)) {
		const bullets: string[] = [];
		const numbers = new Set<number>();
		for (const insight of data.sourceSpecificInsights) {
			for (const item of insight.items) {
				bullets.push(
					withCitationMarkers(
						`**${insight.sourceTitle}** — ${item.text}`,
						item.citationNumbers,
					),
				);
				for (const number of item.citationNumbers) {
					numbers.add(number);
				}
			}
		}
		if (bullets.length > 0) {
			sections.push({
				heading: "Source-Specific Insights",
				bullets,
				citationNumbers: [...numbers],
			});
		}
	}

	if (data.comparisonTable.length > 0) {
		const sourceTitles = [
			...new Map(
				data.comparisonTable.flatMap((row) =>
					row.entries.map(
						(entry) => [entry.sourceId, entry.sourceTitle] as const,
					),
				),
			).values(),
		];

		const header = `| Claim | ${sourceTitles.join(" | ")} |`;
		const divider = `| --- | ${sourceTitles.map(() => "---").join(" | ")} |`;
		const bodyRows = data.comparisonTable.map((row) => {
			const bySource = new Map(
				row.entries.map((entry) => [entry.sourceTitle, entry] as const),
			);
			const cells = sourceTitles.map((title) => {
				const entry = bySource.get(title);
				if (!entry) return "—";
				return withCitationMarkers(entry.position, entry.citationNumbers);
			});
			return `| ${row.claim} | ${cells.join(" | ")} |`;
		});

		const numbers = [
			...new Set(
				data.comparisonTable.flatMap((row) =>
					row.entries.flatMap((entry) => entry.citationNumbers),
				),
			),
		];

		sections.push({
			heading: "Evidence Comparison",
			body: [header, divider, ...bodyRows].join("\n"),
			citationNumbers: numbers,
		});
	}

	bulletSection("Conclusion", data.conclusion);

	return sections;
}

/**
 * Keep a claim only when its evidence indexes resolve and span ≥2 sources.
 * Does not commit citations — the caller commits after this check so a dropped
 * item cannot leave an orphan citation behind.
 */
export function keepCrossSourceItem(
	mapper: CitationMapper,
	item: { text: string; evidenceIndexes: number[] },
	maxPerItem = MAX_EVIDENCE_PER_ITEM,
): { text: string; indexes: number[] } | null {
	const text = stripCitationMarkers(item.text ?? "");
	if (!text) return null;

	const { indexes, sourceIds } = mapper.validate(
		item.evidenceIndexes,
		maxPerItem,
	);
	if (indexes.length === 0 || sourceIds.size < 2) return null;

	return { text, indexes };
}

/**
 * Source-specific insights may cite exactly one source — and it must be the
 * insight's own sourceId. Indexes from other sources are discarded.
 */
export function keepSourceSpecificItem(
	mapper: CitationMapper,
	evidenceByIndex: Map<number, ArtifactEvidence>,
	sourceId: string,
	item: { text: string; evidenceIndexes: number[] },
	maxPerItem = MAX_EVIDENCE_PER_ITEM,
): { text: string; indexes: number[] } | null {
	const text = stripCitationMarkers(item.text ?? "");
	if (!text) return null;

	const { indexes } = mapper.validate(item.evidenceIndexes, maxPerItem);
	const owned = indexes.filter(
		(index) => evidenceByIndex.get(index)?.sourceId === sourceId,
	);
	if (owned.length === 0) return null;

	return { text, indexes: owned };
}

/**
 * Keep a comparison-table row only when ≥2 entries survive with valid evidence.
 * sourceTitle is rewritten from the evidence map so the model cannot invent it.
 */
export function keepComparisonRow(
	mapper: CitationMapper,
	evidenceByIndex: Map<number, ArtifactEvidence>,
	sourceTitleById: Map<string, string>,
	row: {
		claim: string;
		entries: {
			sourceId: string;
			sourceTitle?: string;
			position: string;
			evidenceIndexes: number[];
		}[];
	},
	maxPerItem = MAX_EVIDENCE_PER_ITEM,
): {
	claim: string;
	entries: {
		sourceId: string;
		sourceTitle: string;
		indexes: number[];
		position: string;
	}[];
} | null {
	const claim = stripCitationMarkers(row.claim ?? "");
	if (!claim) return null;

	const kept: {
		sourceId: string;
		sourceTitle: string;
		indexes: number[];
		position: string;
	}[] = [];
	const seenSources = new Set<string>();

	for (const entry of row.entries) {
		const position = stripCitationMarkers(entry.position ?? "");
		if (!position) continue;

		const { indexes } = mapper.validate(entry.evidenceIndexes, maxPerItem);
		const owned = indexes.filter(
			(index) => evidenceByIndex.get(index)?.sourceId === entry.sourceId,
		);
		if (owned.length === 0) continue;
		if (seenSources.has(entry.sourceId)) continue;

		const firstIndex = owned[0];
		const title =
			sourceTitleById.get(entry.sourceId) ||
			(firstIndex !== undefined
				? evidenceByIndex.get(firstIndex)?.sourceTitle
				: undefined) ||
			entry.sourceTitle?.trim() ||
			"Untitled source";

		kept.push({
			sourceId: entry.sourceId,
			sourceTitle: title,
			indexes: owned,
			position,
		});
		seenSources.add(entry.sourceId);
	}

	if (kept.length < 2) return null;
	return { claim, entries: kept };
}

/**
 * Pure assembly from already-parsed LLM output. Exported so tests can exercise
 * the cross-source validation without calling OpenAI.
 */
export function buildCompareSourcesFromLlm(options: {
	llm: LlmCompareSources;
	evidence: ArtifactEvidence[];
	notebookTitle: string;
}): CompareSourcesArtifact {
	const { llm, evidence, notebookTitle } = options;

	const distinctSourceCount = new Set(evidence.map((item) => item.sourceId))
		.size;
	if (distinctSourceCount < MIN_DISTINCT_SOURCES_FOR_COMPARE) {
		throw new Error(
			"Compare Sources needs evidence from at least two distinct sources. Add another ready source and try again.",
		);
	}

	if (evidence.length < MIN_EVIDENCE_FOR_COMPARE) {
		throw insufficientEvidenceError(evidence.length, "source comparison");
	}

	const mapper = createCitationMapper(evidence);
	const evidenceByIndex = new Map(evidence.map((item) => [item.index, item]));
	const sourceTitleById = new Map(
		evidence.map((item) => [item.sourceId, item.sourceTitle]),
	);

	const overviewText = stripCitationMarkers(llm.overview.text);
	if (!overviewText) {
		throw new Error("Compare Sources is missing an overview");
	}

	const overviewValidated = mapper.validate(
		llm.overview.evidenceIndexes,
		MAX_EVIDENCE_PER_ITEM,
	);
	const overviewNumbers = mapper.commit(overviewValidated.indexes);

	const collectCrossSource = (
		items: { text: string; evidenceIndexes: number[] }[],
		max: number,
	): CompareCitedItem[] => {
		const kept: CompareCitedItem[] = [];
		for (const item of items) {
			if (kept.length >= max) break;
			const resolved = keepCrossSourceItem(mapper, item);
			if (!resolved) continue;
			kept.push({
				text: resolved.text,
				citationNumbers: mapper.commit(resolved.indexes),
			});
		}
		return kept;
	};

	const sharedUnderstanding = collectCrossSource(
		llm.sharedUnderstanding,
		COMPARE_SOURCES_LIMITS.maxSharedUnderstanding,
	);
	const agreements = collectCrossSource(
		llm.agreements,
		COMPARE_SOURCES_LIMITS.maxAgreements,
	);
	const disagreements = collectCrossSource(
		llm.disagreements,
		COMPARE_SOURCES_LIMITS.maxDisagreements,
	);

	const sourceSpecificInsights: CompareSourceInsight[] = [];
	for (const insight of llm.sourceSpecificInsights) {
		if (!sourceTitleById.has(insight.sourceId)) continue;

		const items: CompareCitedItem[] = [];
		for (const item of insight.items) {
			if (items.length >= COMPARE_SOURCES_LIMITS.maxInsightsPerSource) break;
			const resolved = keepSourceSpecificItem(
				mapper,
				evidenceByIndex,
				insight.sourceId,
				item,
			);
			if (!resolved) continue;
			items.push({
				text: resolved.text,
				citationNumbers: mapper.commit(resolved.indexes),
			});
		}
		if (items.length === 0) continue;

		const sourceTitle = sourceTitleById.get(insight.sourceId);
		if (!sourceTitle) continue;

		sourceSpecificInsights.push({
			sourceId: insight.sourceId,
			sourceTitle,
			items,
		});
	}

	const comparisonTable: CompareTableRow[] = [];
	for (const row of llm.comparisonTable) {
		if (comparisonTable.length >= COMPARE_SOURCES_LIMITS.maxTableRows) break;
		const resolved = keepComparisonRow(
			mapper,
			evidenceByIndex,
			sourceTitleById,
			row,
		);
		if (!resolved) continue;

		const entries: CompareTableEntry[] = resolved.entries.map((entry) => ({
			sourceId: entry.sourceId,
			sourceTitle: entry.sourceTitle,
			position: entry.position,
			citationNumbers: mapper.commit(entry.indexes),
		}));

		comparisonTable.push({ claim: resolved.claim, entries });
	}

	const conclusion: CompareCitedItem[] = [];
	for (const item of llm.conclusion) {
		if (conclusion.length >= COMPARE_SOURCES_LIMITS.maxConclusion) break;
		const text = stripCitationMarkers(item.text ?? "");
		if (!text) continue;
		const { indexes } = mapper.validate(
			item.evidenceIndexes,
			MAX_EVIDENCE_PER_ITEM,
		);
		if (indexes.length === 0) continue;
		conclusion.push({
			text,
			citationNumbers: mapper.commit(indexes),
		});
	}

	const hasComparisonMaterial =
		sharedUnderstanding.length > 0 ||
		agreements.length > 0 ||
		disagreements.length > 0 ||
		comparisonTable.length > 0;

	if (!hasComparisonMaterial) {
		throw new Error(
			"These sources did not yield any grounded agreements, disagreements or comparable claims. Add more overlapping sources, or narrow the focus and try again.",
		);
	}

	const compareSources: CompareSourcesData = {
		overview: overviewText,
		sharedUnderstanding,
		agreements,
		disagreements,
		sourceSpecificInsights,
		comparisonTable,
		conclusion,
	};

	const citations = mapper.citations();
	if (citations.length < MIN_CITATIONS_FOR_READY) {
		throw new Error(
			"The comparison could not be grounded in enough distinct evidence. Add more ready sources, or narrow the focus and try again.",
		);
	}

	const content = artifactContentSchema.safeParse({
		summary: overviewText,
		sections: projectCompareSections(
			{ text: overviewText, numbers: overviewNumbers },
			compareSources,
		),
		compareSources,
	} satisfies ArtifactContent);

	if (!content.success) {
		console.error("[compare-sources] invalid content", content.error.issues);
		throw new Error("Assembled source comparison did not pass validation");
	}

	return {
		title: llm.title.trim() || `Compare Sources — ${notebookTitle}`,
		content: content.data,
		citations,
		evidenceCount: evidence.length,
		sourceCount: distinctSourceCount,
	};
}

export async function generateCompareSources(options: {
	evidence: ArtifactEvidence[];
	readySourceCount: number;
	notebookTitle: string;
	focus?: string;
}): Promise<CompareSourcesArtifact> {
	const { evidence, notebookTitle, focus } = options;

	if (evidence.length < MIN_EVIDENCE_FOR_COMPARE) {
		throw insufficientEvidenceError(evidence.length, "source comparison");
	}

	const distinctSourceCount = new Set(evidence.map((item) => item.sourceId))
		.size;
	if (distinctSourceCount < MIN_DISTINCT_SOURCES_FOR_COMPARE) {
		throw new Error(
			"Compare Sources needs evidence from at least two distinct sources. Add another ready source and try again.",
		);
	}

	const client = getOpenAIClient();
	const completion = await client.chat.completions.create({
		model: getChatModel(),
		temperature: 0.2,
		response_format: { type: "json_object" },
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content: `Notebook: ${notebookTitle}
${focus?.trim() ? `Comparison focus: ${focus.trim()}\n` : ""}Distinct sources in the evidence below: ${distinctSourceCount}

Numbered evidence (each line starts with [n] "Source title"):

${formatEvidenceBlock(evidence)}

Return the JSON source comparison now.`,
			},
		],
	});

	const raw = completion.choices[0]?.message?.content?.trim();
	if (!raw) {
		throw new Error("Failed to generate source comparison");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Source comparison model returned invalid JSON");
	}

	const result = llmCompareSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error("Source comparison model returned unexpected shape");
	}

	return buildCompareSourcesFromLlm({
		llm: result.data,
		evidence,
		notebookTitle,
	});
}
