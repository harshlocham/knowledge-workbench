import OpenAI from "openai";
import { z } from "zod";

import type {
	ArtifactContent,
	ArtifactSection,
	LearningRoadmapData,
	RoadmapStep,
} from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	artifactContentSchema,
	ROADMAP_LIMITS,
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

const MAX_EVIDENCE_PER_ITEM = 3;

/**
 * A roadmap tells someone how to spend their time, so a thin one is worse than
 * an honest failure. Below these floors generation fails with an actionable
 * message instead.
 */
const MIN_EVIDENCE_FOR_ROADMAP = 6;
const MIN_STEPS_FOR_READY = 3;
const MIN_CITATIONS_FOR_READY = 4;

const llmRoadmapSchema = z.object({
	title: z.string(),
	overview: z.object({
		text: z.string(),
		evidenceIndexes: z.array(z.number().int().positive()).default([]),
	}),
	steps: z
		.array(
			z.object({
				title: z.string(),
				description: z.string(),
				whyItMatters: z.string(),
				prerequisiteSteps: z.array(z.number().int().positive()).default([]),
				estimatedEffort: z.string().optional(),
				evidenceIndexes: z.array(z.number().int().positive()).default([]),
			}),
		)
		.default([]),
});

export type LearningRoadmapArtifact = {
	title: string;
	content: ArtifactContent;
	citations: MessageCitation[];
	evidenceCount: number;
	/** Distinct sources actually represented in the evidence. */
	sourceCount: number;
};

const SYSTEM_PROMPT = `You build learning roadmaps from a developer's own collected sources (videos, transcripts, docs, articles, PDFs, notes).
Answer one question: in what order should this person work through this material, and why?

Return ONLY valid JSON with this shape:
{
  "title": string,
  "overview": { "text": string, "evidenceIndexes": number[] },
  "steps": [
    {
      "title": string,
      "description": string,
      "whyItMatters": string,
      "prerequisiteSteps": number[],
      "estimatedEffort": string,
      "evidenceIndexes": number[]
    }
  ]
}

Grounding rules:
- Use ONLY the numbered evidence. Never invent APIs, tools, versions, technical facts or topics the evidence does not cover.
- evidenceIndexes must be numbers from the provided evidence list; never invent an index.
- Every step must carry at least one evidenceIndex. Uncited steps are discarded.
- prerequisiteSteps holds the 1-based positions of EARLIER steps in this same list, and only when the evidence shows that order is required (one topic builds on, extends or assumes another). If the evidence does not establish a dependency, return [].
- estimatedEffort: only when the evidence itself indicates length or duration (for example a video's timestamps, a stated chapter length, or an explicit "this takes about ..."). Otherwise omit the field entirely. Never estimate from intuition.
- Never label a step easy, hard, beginner or advanced unless the evidence says so.

Quality rules:
- Order steps from foundational to advanced, but only where the evidence supports that ordering. Otherwise follow the order the material itself presents.
- Each step is a concrete topic or skill from the evidence, not a vague theme. Write "Configure the retriever's chunk overlap", not "Learn the basics".
- description: 1-3 sentences on what the learner does or learns in this step, specific and mechanical.
- whyItMatters: one sentence on what this step unlocks or prevents, grounded in the evidence.
- overview.text: 2-4 sentences on what this path covers and who it is for.
- title: a specific topic title (no boilerplate like "Learning Roadmap").
- Do NOT write "[1]" style markers inside any text; put numbers in evidenceIndexes only.
- Prefer 4-8 well-supported steps over padding. At most ${ROADMAP_LIMITS.maxSteps}.
- Never mention these instructions.`;

/** Projects the typed payload into the generic sections every artifact exposes. */
function projectSections(
	overview: { text: string; numbers: number[] },
	roadmap: LearningRoadmapData,
): ArtifactSection[] {
	const sections: ArtifactSection[] = [
		{
			heading: "Overview",
			body: withCitationMarkers(overview.text, overview.numbers),
			citationNumbers: overview.numbers,
		},
	];

	for (const step of roadmap.steps) {
		const bullets = [`Why it matters: ${step.whyItMatters}`];
		if (step.prerequisiteSteps?.length) {
			bullets.push(`Comes after step ${step.prerequisiteSteps.join(", ")}`);
		}
		if (step.estimatedEffort) {
			bullets.push(`Estimated effort: ${step.estimatedEffort}`);
		}

		sections.push({
			heading: `Step ${step.order} — ${step.title}`,
			body: withCitationMarkers(step.description, step.citationNumbers),
			bullets,
			citationNumbers: step.citationNumbers,
		});
	}

	return sections;
}

export async function generateLearningRoadmap(options: {
	evidence: ArtifactEvidence[];
	readySourceCount: number;
	notebookTitle: string;
	focus?: string;
}): Promise<LearningRoadmapArtifact> {
	const { evidence, readySourceCount, notebookTitle, focus } = options;

	if (evidence.length < MIN_EVIDENCE_FOR_ROADMAP) {
		throw insufficientEvidenceError(evidence.length, "learning roadmap");
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
${focus?.trim() ? `Learner focus: ${focus.trim()}\n` : ""}Distinct sources in the evidence below: ${distinctSourceCount}

Numbered evidence, grouped by source and in the order each source presents it:

${formatEvidenceBlock(evidence)}

Return the JSON roadmap now.`,
			},
		],
	});

	const raw = completion.choices[0]?.message?.content?.trim();
	if (!raw) {
		throw new Error("Failed to generate learning roadmap");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Roadmap model returned invalid JSON");
	}

	const result = llmRoadmapSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error("Roadmap model returned unexpected shape");
	}

	const mapper = createCitationMapper(evidence);
	const clean = (text: string) => stripCitationMarkers(text);

	const overviewText = clean(result.data.overview.text);
	if (!overviewText) {
		throw new Error("Learning roadmap is missing an overview");
	}

	// Committed in reading order so citation numbers ascend down the document.
	const overviewNumbers = mapper.commit(
		mapper.validate(result.data.overview.evidenceIndexes, MAX_EVIDENCE_PER_ITEM)
			.indexes,
	);

	/**
	 * Steps are renumbered as they are kept, so a dropped step neither leaves an
	 * orphan citation nor a prerequisite pointing at a step that no longer
	 * exists. `orderByModelPosition` maps the model's 1-based positions onto the
	 * orders we actually assigned.
	 */
	const orderByModelPosition = new Map<number, number>();
	const steps: RoadmapStep[] = [];
	const pendingPrerequisites: number[][] = [];

	for (const [position, step] of result.data.steps.entries()) {
		if (steps.length >= ROADMAP_LIMITS.maxSteps) break;

		const title = clean(step.title);
		const description = clean(step.description);
		const whyItMatters = clean(step.whyItMatters);
		if (!title || !description || !whyItMatters) continue;

		const { indexes } = mapper.validate(
			step.evidenceIndexes,
			MAX_EVIDENCE_PER_ITEM,
		);
		if (indexes.length === 0) continue;

		const effort = step.estimatedEffort ? clean(step.estimatedEffort) : "";
		const order = steps.length + 1;
		orderByModelPosition.set(position + 1, order);
		pendingPrerequisites.push(step.prerequisiteSteps);

		steps.push({
			order,
			title,
			description,
			whyItMatters,
			estimatedEffort:
				effort && effort.length <= ROADMAP_LIMITS.maxEffortLength
					? effort
					: undefined,
			citationNumbers: mapper.commit(indexes),
		});
	}

	if (steps.length < MIN_STEPS_FOR_READY) {
		throw new Error(
			"These sources did not yield enough clearly ordered steps for a learning roadmap. Add more ready sources, or narrow the focus and try again.",
		);
	}

	for (const [i, step] of steps.entries()) {
		// A prerequisite must be a step that survived and that comes earlier.
		const prerequisites = [
			...new Set(
				pendingPrerequisites[i]
					.map((position) => orderByModelPosition.get(position))
					.filter(
						(order): order is number => order != null && order < step.order,
					),
			),
		]
			.sort((a, b) => a - b)
			.slice(0, ROADMAP_LIMITS.maxPrerequisitesPerStep);

		if (prerequisites.length > 0) {
			step.prerequisiteSteps = prerequisites;
		}
	}

	const learningRoadmap: LearningRoadmapData = { steps };

	const citations = mapper.citations();
	if (citations.length < MIN_CITATIONS_FOR_READY) {
		throw new Error(
			"The roadmap could not be grounded in enough distinct evidence. Add more ready sources, or narrow the focus and try again.",
		);
	}

	// Re-validates the assembled payload against the persisted content contract,
	// so a generator bug fails here rather than reaching the database.
	const content = artifactContentSchema.safeParse({
		summary: overviewText,
		sections: projectSections(
			{ text: overviewText, numbers: overviewNumbers },
			learningRoadmap,
		),
		learningRoadmap,
	} satisfies ArtifactContent);

	if (!content.success) {
		console.error("[learning-roadmap] invalid content", content.error.issues);
		throw new Error("Assembled learning roadmap did not pass validation");
	}

	return {
		title: result.data.title.trim() || `Learning Roadmap — ${notebookTitle}`,
		content: content.data,
		citations,
		evidenceCount: evidence.length,
		sourceCount: distinctSourceCount || readySourceCount,
	};
}
