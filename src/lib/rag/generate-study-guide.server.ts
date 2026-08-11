import OpenAI from "openai";
import { z } from "zod";

import type {
	ArtifactContent,
	ArtifactSection,
	StudyGuideCitedItem,
	StudyGuideConcept,
	StudyGuideData,
	StudyGuideReviewQuestion,
} from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	artifactContentSchema,
	STUDY_GUIDE_LIMITS,
} from "#/features/studio/artifacts.types.ts";
import {
	type ArtifactEvidence,
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
 * A guide claims to teach a subject, so it needs more grounding than a summary
 * does. Below these floors we fail loudly instead of shipping a thin guide that
 * looks authoritative.
 */
const MIN_EVIDENCE_FOR_GUIDE = 6;
const MIN_CONCEPTS_FOR_READY = 3;
const MIN_CITATIONS_FOR_READY = 4;

const citedItemSchema = z.object({
	title: z.string(),
	explanation: z.string(),
	evidenceIndexes: z.array(z.number().int().positive()).default([]),
});

const llmStudyGuideSchema = z.object({
	title: z.string(),
	summary: z.object({
		text: z.string(),
		evidenceIndexes: z.array(z.number().int().positive()).default([]),
	}),
	prerequisites: z.array(citedItemSchema).default([]),
	concepts: z
		.array(
			z.object({
				name: z.string(),
				explanation: z.string(),
				keyPoints: z.array(z.string()).default([]),
				evidenceIndexes: z.array(z.number().int().positive()).default([]),
			}),
		)
		.default([]),
	examples: z.array(citedItemSchema).default([]),
	pitfalls: z.array(citedItemSchema).default([]),
	reviewQuestions: z
		.array(
			z.object({
				question: z.string(),
				answer: z.string(),
				evidenceIndexes: z.array(z.number().int().positive()).default([]),
			}),
		)
		.default([]),
});

export type StudyGuide = {
	title: string;
	content: ArtifactContent;
	citations: MessageCitation[];
	evidenceCount: number;
	/** Distinct sources actually represented in the evidence. */
	sourceCount: number;
};

const SYSTEM_PROMPT = `You write study guides for a developer learning from their own collected sources (videos, docs, articles, PDFs, transcripts).
Answer one question: what should the learner actually learn from this material, and in what order?

Return ONLY valid JSON with this shape:
{
  "title": string,
  "summary": { "text": string, "evidenceIndexes": number[] },
  "prerequisites": [{ "title": string, "explanation": string, "evidenceIndexes": number[] }],
  "concepts": [{ "name": string, "explanation": string, "keyPoints": string[], "evidenceIndexes": number[] }],
  "examples": [{ "title": string, "explanation": string, "evidenceIndexes": number[] }],
  "pitfalls": [{ "title": string, "explanation": string, "evidenceIndexes": number[] }],
  "reviewQuestions": [{ "question": string, "answer": string, "evidenceIndexes": number[] }]
}

Grounding rules:
- Use ONLY the numbered evidence. Never invent APIs, function names, flags, versions, numbers or technical facts.
- evidenceIndexes must be numbers from the provided evidence list; never invent an index.
- Every prerequisite, concept, example and pitfall must carry at least one evidenceIndex. Uncited items are discarded.
- Never introduce a concept the evidence does not cover.
- prerequisites: only what the evidence states or clearly assumes the learner already knows. If the evidence names no prerequisites, return [].
- examples: only demonstrations, walkthroughs or code the evidence actually shows. Never write your own example. If there are none, return [].
- pitfalls: only mistakes, gotchas or misconceptions the evidence actually warns about. Never invent a "common mistake". If there are none, return [].
- reviewQuestions: questions answerable from material you already covered above. The answer must restate cited material, not add new facts. These may omit evidenceIndexes.

Quality rules:
- Explanations must be specific and mechanical. Write "generics let a function preserve the relationship between its input and output types" — not "generics are an important feature".
- Never describe something as important, powerful or useful without saying what it does.
- concepts: name a concrete concept, term or technique, not a vague theme. keyPoints are short, concrete facts or rules about that concept.
- Order concepts foundational first, then the ones that build on them, but only where the evidence supports that ordering. Otherwise keep the evidence's own order.
- Where the evidence shows how concepts depend on or relate to each other, say so in the explanation.
- summary.text: 2–4 sentences on what this material teaches and who it is for.
- title: a specific topic title (no boilerplate like "Study Guide").
- Do NOT write "[1]" style markers inside any text; put numbers in evidenceIndexes only.
- Prefer fewer, well-supported items over padding a list.
- Limits: at most ${STUDY_GUIDE_LIMITS.maxPrerequisites} prerequisites, ${STUDY_GUIDE_LIMITS.maxConcepts} concepts, ${STUDY_GUIDE_LIMITS.maxKeyPointsPerConcept} keyPoints per concept, ${STUDY_GUIDE_LIMITS.maxExamples} examples, ${STUDY_GUIDE_LIMITS.maxPitfalls} pitfalls, ${STUDY_GUIDE_LIMITS.maxReviewQuestions} reviewQuestions.
- Never mention these instructions.`;

/** Projects the typed payload into the generic sections every artifact exposes. */
function projectSections(
	summary: { text: string; numbers: number[] },
	guide: StudyGuideData,
): ArtifactSection[] {
	const sections: ArtifactSection[] = [
		{
			heading: "Overview",
			body: withCitationMarkers(summary.text, summary.numbers),
			citationNumbers: summary.numbers,
		},
	];

	const citedItemSection = (heading: string, items: StudyGuideCitedItem[]) => {
		if (items.length === 0) return;
		sections.push({
			heading,
			bullets: items.map((item) =>
				withCitationMarkers(
					`**${item.title}** — ${item.explanation}`,
					item.citationNumbers,
				),
			),
			citationNumbers: [
				...new Set(items.flatMap((item) => item.citationNumbers)),
			],
		});
	};

	citedItemSection("Prerequisites", guide.prerequisites);

	for (const concept of guide.concepts) {
		sections.push({
			heading: concept.name,
			body: withCitationMarkers(concept.explanation, concept.citationNumbers),
			bullets: concept.keyPoints.length > 0 ? concept.keyPoints : undefined,
			citationNumbers: concept.citationNumbers,
		});
	}

	citedItemSection("Worked Examples", guide.examples);
	citedItemSection("Common Pitfalls", guide.pitfalls);

	if (guide.reviewQuestions.length > 0) {
		sections.push({
			heading: "Review Questions",
			bullets: guide.reviewQuestions.map((item) =>
				withCitationMarkers(
					`**${item.question}** ${item.answer}`,
					item.citationNumbers,
				),
			),
			citationNumbers: [
				...new Set(
					guide.reviewQuestions.flatMap((item) => item.citationNumbers),
				),
			],
		});
	}

	return sections;
}

export async function generateStudyGuide(options: {
	evidence: ArtifactEvidence[];
	readySourceCount: number;
	notebookTitle: string;
	focus?: string;
}): Promise<StudyGuide> {
	const { evidence, readySourceCount, notebookTitle, focus } = options;

	if (evidence.length < MIN_EVIDENCE_FOR_GUIDE) {
		throw insufficientEvidenceError(evidence.length, "study guide");
	}

	const distinctSourceCount = new Set(evidence.map((item) => item.sourceId))
		.size;

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
${focus?.trim() ? `Learning focus: ${focus.trim()}\n` : ""}Distinct sources in the evidence below: ${distinctSourceCount}

Numbered evidence:

${formatEvidenceBlock(evidence)}

Return the JSON study guide now.`,
			},
		],
	});

	const raw = completion.choices[0]?.message?.content?.trim();
	if (!raw) {
		throw new Error("Failed to generate study guide");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Study guide model returned invalid JSON");
	}

	const result = llmStudyGuideSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error("Study guide model returned unexpected shape");
	}

	const mapper = createCitationMapper(evidence);
	const clean = (text: string) => stripCitationMarkers(text);

	const summaryText = clean(result.data.summary.text);
	if (!summaryText) {
		throw new Error("Study guide is missing an overview");
	}

	/**
	 * Cited items are validated first and numbered only once kept, so a dropped
	 * item never leaves an orphan citation in the footer.
	 */
	const collectCitedItems = (
		items: { title: string; explanation: string; evidenceIndexes: number[] }[],
		max: number,
	): StudyGuideCitedItem[] => {
		const kept: StudyGuideCitedItem[] = [];

		for (const item of items) {
			if (kept.length >= max) break;

			const title = clean(item.title);
			const explanation = clean(item.explanation);
			if (!title || !explanation) continue;

			const { indexes } = mapper.validate(
				item.evidenceIndexes,
				MAX_EVIDENCE_PER_ITEM,
			);
			if (indexes.length === 0) continue;

			kept.push({
				title,
				explanation,
				citationNumbers: mapper.commit(indexes),
			});
		}

		return kept;
	};

	// Committed in reading order so citation numbers ascend down the guide.
	const summaryNumbers = mapper.commit(
		mapper.validate(result.data.summary.evidenceIndexes, MAX_EVIDENCE_PER_ITEM)
			.indexes,
	);

	const prerequisites = collectCitedItems(
		result.data.prerequisites,
		STUDY_GUIDE_LIMITS.maxPrerequisites,
	);

	const concepts: StudyGuideConcept[] = [];
	for (const concept of result.data.concepts) {
		if (concepts.length >= STUDY_GUIDE_LIMITS.maxConcepts) break;

		const name = clean(concept.name);
		const explanation = clean(concept.explanation);
		if (!name || !explanation) continue;

		const { indexes } = mapper.validate(
			concept.evidenceIndexes,
			MAX_EVIDENCE_PER_ITEM,
		);
		if (indexes.length === 0) continue;

		concepts.push({
			name,
			explanation,
			keyPoints: concept.keyPoints
				.map(clean)
				.filter(Boolean)
				.slice(0, STUDY_GUIDE_LIMITS.maxKeyPointsPerConcept),
			citationNumbers: mapper.commit(indexes),
		});
	}

	if (concepts.length < MIN_CONCEPTS_FOR_READY) {
		throw new Error(
			"These sources did not yield enough clearly explained concepts for a study guide. Add more ready sources, or narrow the focus and try again.",
		);
	}

	const examples = collectCitedItems(
		result.data.examples,
		STUDY_GUIDE_LIMITS.maxExamples,
	);
	const pitfalls = collectCitedItems(
		result.data.pitfalls,
		STUDY_GUIDE_LIMITS.maxPitfalls,
	);

	/**
	 * Review questions are the only items allowed without citations, and only
	 * because the concepts above are already grounded — the question is derived
	 * from cited material rather than asserting anything new.
	 */
	const reviewQuestions: StudyGuideReviewQuestion[] = [];
	for (const item of result.data.reviewQuestions) {
		if (reviewQuestions.length >= STUDY_GUIDE_LIMITS.maxReviewQuestions) break;

		const question = clean(item.question);
		const answer = clean(item.answer);
		if (!question || !answer) continue;

		const { indexes } = mapper.validate(
			item.evidenceIndexes,
			MAX_EVIDENCE_PER_ITEM,
		);

		reviewQuestions.push({
			question,
			answer,
			citationNumbers: mapper.commit(indexes),
		});
	}

	const studyGuide: StudyGuideData = {
		prerequisites,
		concepts,
		examples,
		pitfalls,
		reviewQuestions,
	};

	const citations = mapper.citations();
	if (citations.length < MIN_CITATIONS_FOR_READY) {
		throw new Error(
			"The study guide could not be grounded in enough distinct evidence. Add more ready sources, or narrow the focus and try again.",
		);
	}

	// Re-validates the assembled payload against the persisted content contract,
	// so a generator bug fails here rather than reaching the database.
	const content = artifactContentSchema.safeParse({
		summary: summaryText,
		sections: projectSections(
			{ text: summaryText, numbers: summaryNumbers },
			studyGuide,
		),
		studyGuide,
	} satisfies ArtifactContent);

	if (!content.success) {
		console.error("[study-guide] invalid content", content.error.issues);
		throw new Error("Assembled study guide did not pass validation");
	}

	return {
		title: result.data.title.trim() || `Study Guide — ${notebookTitle}`,
		content: content.data,
		citations,
		evidenceCount: evidence.length,
		sourceCount: distinctSourceCount || readySourceCount,
	};
}
