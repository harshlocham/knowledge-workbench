import OpenAI from "openai";
import { z } from "zod";

import type { ChunkLocator } from "#/db/schema/chunks.ts";

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

export type RoadmapClipInput = {
	index: number;
	chunkId: string;
	sourceId: string;
	sourceTitle: string;
	text: string;
	locator: ChunkLocator;
};

const llmRoadmapSchema = z.object({
	topic: z.string(),
	overview: z.string(),
	steps: z.array(
		z.object({
			title: z.string(),
			summary: z.string(),
			clipIndexes: z.array(z.number().int().positive()),
		}),
	),
});

export type LearningRoadmap = {
	topic: string;
	overview: string;
	steps: Array<{
		order: number;
		title: string;
		summary: string;
		clips: Array<{
			chunkId: string;
			sourceId: string;
			sourceTitle: string;
			quote: string;
			locator: ChunkLocator;
			citationNumber: number;
		}>;
	}>;
	sourceCount: number;
	clipCount: number;
};

/** Evenly sample chunks so long videos do not blow the context window. */
export function sampleClipsForRoadmap(
	clips: RoadmapClipInput[],
	maxTotal = 48,
	maxPerSource = 12,
): RoadmapClipInput[] {
	const bySource = new Map<string, RoadmapClipInput[]>();
	for (const clip of clips) {
		const list = bySource.get(clip.sourceId) ?? [];
		list.push(clip);
		bySource.set(clip.sourceId, list);
	}

	const sampled: RoadmapClipInput[] = [];

	for (const list of bySource.values()) {
		const sorted = [...list].sort(
			(a, b) => (a.locator.tStart ?? 0) - (b.locator.tStart ?? 0),
		);
		if (sorted.length <= maxPerSource) {
			sampled.push(...sorted);
			continue;
		}

		const step = (sorted.length - 1) / (maxPerSource - 1);
		for (let i = 0; i < maxPerSource; i++) {
			sampled.push(sorted[Math.round(i * step)]!);
		}
	}

	sampled.sort((a, b) => {
		const titleCmp = a.sourceTitle.localeCompare(b.sourceTitle);
		if (titleCmp !== 0) return titleCmp;
		return (a.locator.tStart ?? 0) - (b.locator.tStart ?? 0);
	});

	const capped =
		sampled.length <= maxTotal
			? sampled
			: (() => {
					const step = (sampled.length - 1) / (maxTotal - 1);
					return Array.from(
						{ length: maxTotal },
						(_, i) => sampled[Math.round(i * step)]!,
					);
				})();

	return capped.map((clip, i) => ({ ...clip, index: i + 1 }));
}

export async function generateLearningRoadmap(options: {
	clips: RoadmapClipInput[];
	sourceCount: number;
	focus?: string;
}): Promise<LearningRoadmap> {
	const { clips, sourceCount, focus } = options;

	if (clips.length === 0) {
		throw new Error(
			"Add at least one ready YouTube source (with captions) to build a learning roadmap.",
		);
	}

	const clipBlock = clips
		.map((clip) => {
			const start =
				clip.locator.tStart != null
					? `${Math.floor(clip.locator.tStart / 60)}:${String(
							Math.floor(clip.locator.tStart % 60),
						).padStart(2, "0")}`
					: "?";
			return `[${clip.index}] "${clip.sourceTitle}" @ ${start}\n${clip.text}`;
		})
		.join("\n\n");

	const client = getOpenAIClient();
	const completion = await client.chat.completions.create({
		model: getChatModel(),
		temperature: 0.3,
		response_format: { type: "json_object" },
		messages: [
			{
				role: "system",
				content: `You build personalized learning roadmaps from YouTube transcript clips.
Return ONLY valid JSON with this shape:
{
  "topic": string,
  "overview": string,
  "steps": [
    {
      "title": string,
      "summary": string,
      "clipIndexes": number[]
    }
  ]
}
Rules:
- Order steps from foundational → advanced based ONLY on the provided clips.
- Personalize to what these sources actually teach; do not invent topics absent from clips.
- Each step must cite 1–3 clipIndexes that best teach that concept.
- Prefer 4–8 steps. Keep titles short and summaries to 1–2 sentences.
- clipIndexes must match the numbered clips exactly.`,
			},
			{
				role: "user",
				content: `${
					focus?.trim() ? `Learner focus: ${focus.trim()}\n\n` : ""
				}Clips:\n\n${clipBlock}\n\nBuild a personalized roadmap for mastering what these sources teach.`,
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

	const byIndex = new Map(clips.map((clip) => [clip.index, clip]));

	const steps = result.data.steps
		.map((step, order) => {
			const uniqueIndexes = [...new Set(step.clipIndexes)].filter((n) =>
				byIndex.has(n),
			);
			const stepClips = uniqueIndexes.slice(0, 3).map((n) => {
				const clip = byIndex.get(n)!;
				return {
					chunkId: clip.chunkId,
					sourceId: clip.sourceId,
					sourceTitle: clip.sourceTitle,
					quote: clip.text.slice(0, 280),
					locator: clip.locator,
					citationNumber: clip.index,
				};
			});

			return {
				order: order + 1,
				title: step.title.trim(),
				summary: step.summary.trim(),
				clips: stepClips,
			};
		})
		.filter((step) => step.title && step.clips.length > 0);

	if (steps.length === 0) {
		throw new Error("Could not derive roadmap steps from these sources");
	}

	return {
		topic: result.data.topic.trim() || "Learning roadmap",
		overview:
			result.data.overview.trim() ||
			"A personalized path through your YouTube sources.",
		steps,
		sourceCount,
		clipCount: clips.length,
	};
}
