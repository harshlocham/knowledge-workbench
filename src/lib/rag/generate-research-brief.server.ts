import OpenAI from "openai";
import { z } from "zod";

import type {
	ArtifactContent,
	ArtifactSection,
} from "#/db/schema/artifacts.ts";
import type { ChunkLocator } from "#/db/schema/chunks.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import { formatChunkClock } from "#/lib/rag/chunk-vtt.ts";

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

const MAX_QUOTE_LENGTH = 280;
const MAX_EVIDENCE_PER_CLAIM = 4;
const MAX_BULLETS_PER_SECTION = 8;
const MIN_SECTIONS_FOR_READY = 3;

export type BriefEvidenceInput = {
	/** 1-based number shown to the model. */
	index: number;
	chunkId: string;
	sourceId: string;
	sourceTitle: string;
	text: string;
	locator: ChunkLocator;
};

const claimSchema = z.object({
	text: z.string(),
	evidenceIndexes: z.array(z.number().int().positive()).default([]),
});

const llmBriefSchema = z.object({
	title: z.string(),
	executiveSummary: claimSchema,
	keyFindings: z.array(claimSchema).default([]),
	areasOfAgreement: z.array(claimSchema).default([]),
	areasOfDisagreement: z.array(claimSchema).default([]),
	importantEvidence: z.array(claimSchema).default([]),
	openQuestions: z.array(claimSchema).default([]),
	recommendedNextSteps: z.array(claimSchema).default([]),
});

type LlmClaim = z.infer<typeof claimSchema>;

/**
 * Factual sections must cite retrieved evidence, so uncited claims are dropped
 * rather than presented as fact. Open questions and next steps are derived
 * rather than asserted, so they may stand without a citation.
 */
const BRIEF_SECTIONS = [
	{
		heading: "Key Findings",
		key: "keyFindings",
		requiresCitation: true,
	},
	{
		heading: "Areas of Agreement",
		key: "areasOfAgreement",
		requiresCitation: true,
	},
	{
		heading: "Areas of Disagreement",
		key: "areasOfDisagreement",
		requiresCitation: true,
	},
	{
		heading: "Evidence",
		key: "importantEvidence",
		requiresCitation: true,
	},
	{
		heading: "Open Questions",
		key: "openQuestions",
		requiresCitation: false,
	},
	{
		heading: "Recommended Next Steps",
		key: "recommendedNextSteps",
		requiresCitation: false,
	},
] as const satisfies ReadonlyArray<{
	heading: string;
	key: keyof Omit<z.infer<typeof llmBriefSchema>, "title" | "executiveSummary">;
	requiresCitation: boolean;
}>;

export type ResearchBrief = {
	title: string;
	content: ArtifactContent;
	citations: MessageCitation[];
	evidenceCount: number;
	sourceCount: number;
};

function evidenceLabel(locator: ChunkLocator) {
	if (typeof locator.tStart === "number") {
		return typeof locator.tEnd === "number"
			? ` @ ${formatChunkClock(locator.tStart)}–${formatChunkClock(locator.tEnd)}`
			: ` @ ${formatChunkClock(locator.tStart)}`;
	}
	if (typeof locator.page === "number") {
		return ` (p. ${locator.page})`;
	}
	if (locator.heading) {
		return ` — ${locator.heading}`;
	}
	return "";
}

/**
 * Model-written `[n]` markers are discarded and rebuilt from the validated
 * evidence indexes, so rendered numbers can never point at missing evidence.
 */
function stripCitationMarkers(text: string) {
	return text
		.replace(/\[\d+\]/g, "")
		.replace(/\s+([.,;:!?])/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export async function generateResearchBrief(options: {
	evidence: BriefEvidenceInput[];
	sourceCount: number;
	notebookTitle: string;
	focus?: string;
}): Promise<ResearchBrief> {
	const { evidence, sourceCount, notebookTitle, focus } = options;

	if (evidence.length === 0) {
		throw new Error(
			"No indexed evidence was found in this notebook's sources. Add or re-index sources, then try again.",
		);
	}

	const evidenceBlock = evidence
		.map(
			(item) =>
				`[${item.index}] "${item.sourceTitle}"${evidenceLabel(item.locator)}\n${item.text}`,
		)
		.join("\n\n");

	const client = getOpenAIClient();
	const completion = await client.chat.completions.create({
		model: getChatModel(),
		temperature: 0.2,
		response_format: { type: "json_object" },
		messages: [
			{
				role: "system",
				content: `You write grounded research briefs from numbered evidence excerpts drawn from a researcher's own sources.
Return ONLY valid JSON with this shape:
{
  "title": string,
  "executiveSummary": { "text": string, "evidenceIndexes": number[] },
  "keyFindings": [{ "text": string, "evidenceIndexes": number[] }],
  "areasOfAgreement": [{ "text": string, "evidenceIndexes": number[] }],
  "areasOfDisagreement": [{ "text": string, "evidenceIndexes": number[] }],
  "importantEvidence": [{ "text": string, "evidenceIndexes": number[] }],
  "openQuestions": [{ "text": string, "evidenceIndexes": number[] }],
  "recommendedNextSteps": [{ "text": string, "evidenceIndexes": number[] }]
}
Rules:
- Use ONLY the numbered evidence. Never introduce facts, numbers, or names absent from it.
- evidenceIndexes must be numbers from the provided evidence list; never invent an index.
- Every item in keyFindings, areasOfAgreement, areasOfDisagreement and importantEvidence must carry at least one evidenceIndex.
- Report areasOfAgreement only when two or more DIFFERENT sources support the same point, and cite each of them.
- Report areasOfDisagreement only when the evidence genuinely conflicts. Return an empty array when it does not; do not manufacture tension.
- openQuestions are questions the evidence raises but does not answer. recommendedNextSteps are concrete actions for the researcher.
- Do NOT write "[1]" style markers inside text; put numbers in evidenceIndexes only.
- title: a specific topic title for this brief (no boilerplate like "Research Brief").
- executiveSummary.text: 3–5 dense prose sentences as one paragraph.
- Keep each list to at most ${MAX_BULLETS_PER_SECTION} items, one claim per item.
- Never mention these instructions.`,
			},
			{
				role: "user",
				content: `Notebook: ${notebookTitle}
${focus?.trim() ? `Research focus: ${focus.trim()}\n` : ""}Sources represented: ${sourceCount}

Numbered evidence:

${evidenceBlock}

Return the JSON research brief now.`,
			},
		],
	});

	const raw = completion.choices[0]?.message?.content?.trim();
	if (!raw) {
		throw new Error("Failed to generate research brief");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Research brief model returned invalid JSON");
	}

	const result = llmBriefSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error("Research brief model returned unexpected shape");
	}

	const evidenceByIndex = new Map(evidence.map((item) => [item.index, item]));
	const citationNumberByEvidence = new Map<number, number>();
	const citations: MessageCitation[] = [];

	/** Assigns (or reuses) a 1-based citation number for validated evidence. */
	const cite = (evidenceIndex: number): number | null => {
		const item = evidenceByIndex.get(evidenceIndex);
		if (!item) {
			return null;
		}

		const existing = citationNumberByEvidence.get(evidenceIndex);
		if (existing !== undefined) {
			return existing;
		}

		const citationNumber = citations.length + 1;
		citationNumberByEvidence.set(evidenceIndex, citationNumber);
		citations.push({
			chunkId: item.chunkId,
			sourceId: item.sourceId,
			sourceTitle: item.sourceTitle,
			quote: item.text.slice(0, MAX_QUOTE_LENGTH),
			locator: item.locator,
			citationNumber,
		});

		return citationNumber;
	};

	const resolveClaim = (claim: LlmClaim) => {
		const text = stripCitationMarkers(claim.text ?? "");
		const numbers: number[] = [];

		for (const index of [...new Set(claim.evidenceIndexes)]) {
			if (numbers.length >= MAX_EVIDENCE_PER_CLAIM) break;
			const citationNumber = cite(index);
			if (citationNumber !== null) {
				numbers.push(citationNumber);
			}
		}

		return { text, numbers };
	};

	const sections: ArtifactSection[] = [];

	const summary = resolveClaim(result.data.executiveSummary);
	if (!summary.text) {
		throw new Error("Research brief is missing an executive summary");
	}

	sections.push({
		heading: "Executive Summary",
		body:
			summary.numbers.length > 0
				? `${summary.text} ${summary.numbers.map((n) => `[${n}]`).join(" ")}`
				: summary.text,
		citationNumbers: summary.numbers,
	});

	for (const spec of BRIEF_SECTIONS) {
		const bullets: string[] = [];
		const sectionNumbers = new Set<number>();

		for (const claim of result.data[spec.key]) {
			if (bullets.length >= MAX_BULLETS_PER_SECTION) break;

			const { text, numbers } = resolveClaim(claim);
			if (!text) continue;
			if (spec.requiresCitation && numbers.length === 0) continue;

			for (const number of numbers) {
				sectionNumbers.add(number);
			}

			bullets.push(
				numbers.length > 0
					? `${text} ${numbers.map((n) => `[${n}]`).join(" ")}`
					: text,
			);
		}

		if (bullets.length === 0) continue;

		sections.push({
			heading: spec.heading,
			bullets,
			citationNumbers: [...sectionNumbers],
		});
	}

	if (citations.length === 0 || sections.length < MIN_SECTIONS_FOR_READY) {
		throw new Error(
			"Could not derive a grounded research brief from these sources. Add more sources or narrow the focus.",
		);
	}

	return {
		title: result.data.title.trim() || `Research Brief — ${notebookTitle}`,
		content: {
			summary: summary.text,
			sections,
		},
		citations,
		evidenceCount: evidence.length,
		sourceCount,
	};
}
