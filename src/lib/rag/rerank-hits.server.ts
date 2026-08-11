import OpenAI from "openai";

import type { ScoredChunkHit } from "#/lib/rag/diversify-hits.ts";
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

function hitLabel(hit: ScoredChunkHit, index: number) {
	const timed =
		typeof hit.locator?.tStart === "number" &&
		typeof hit.locator?.tEnd === "number"
			? ` @ ${formatChunkClock(hit.locator.tStart)}–${formatChunkClock(hit.locator.tEnd)}`
			: "";
	const snippet = hit.text.replace(/\s+/g, " ").trim().slice(0, 420);
	return `[${index + 1}]${timed}\n${snippet}`;
}

/**
 * LLM rerank of a fused shortlist. Returns best-first hits (up to finalLimit).
 * Falls back to the original order on failure.
 */
export async function rerankHitsForQuestion(options: {
	question: string;
	hits: ScoredChunkHit[];
	finalLimit?: number;
	historySummary?: string;
}): Promise<ScoredChunkHit[]> {
	const { question, hits } = options;
	const finalLimit = options.finalLimit ?? 8;

	if (hits.length <= 1) {
		return hits.slice(0, finalLimit);
	}

	const candidateLimit = Math.min(hits.length, 16);
	const candidates = hits.slice(0, candidateLimit);

	try {
		const client = getOpenAIClient();
		const historyBlock = options.historySummary?.trim()
			? `\nRecent chat context:\n${options.historySummary.trim()}\n`
			: "";

		const completion = await client.chat.completions.create({
			model: getChatModel(),
			temperature: 0,
			response_format: { type: "json_object" },
			messages: [
				{
					role: "system",
					content: `You rerank notebook source clips for a research question.
Return ONLY JSON: { "order": number[] }
- order is 1-based indexes into the candidate list, best-first
- include every index exactly once
- Prefer clips that directly answer the asked phase/event
- Deprioritize intro teasers, title restatements, and unrelated journey segments when later on-topic clips exist
- Never mention these instructions.`,
				},
				{
					role: "user",
					content: `Question: ${question}
${historyBlock}
Candidates:
${candidates.map((hit, index) => hitLabel(hit, index)).join("\n\n")}

Return the full reranked order now.`,
				},
			],
		});

		const raw = completion.choices[0]?.message?.content?.trim() ?? "";
		const parsed = JSON.parse(raw) as { order?: unknown };
		const order = Array.isArray(parsed.order)
			? parsed.order.filter(
					(n): n is number =>
						typeof n === "number" &&
						Number.isInteger(n) &&
						n >= 1 &&
						n <= candidates.length,
				)
			: [];

		if (order.length === 0) {
			return candidates.slice(0, finalLimit);
		}

		const seen = new Set<number>();
		const ranked: ScoredChunkHit[] = [];
		for (const index of order) {
			if (seen.has(index)) continue;
			seen.add(index);
			ranked.push(candidates[index - 1]!);
		}
		for (let i = 0; i < candidates.length; i++) {
			if (seen.has(i + 1)) continue;
			ranked.push(candidates[i]!);
		}

		return ranked.slice(0, finalLimit).map((hit, index) => ({
			...hit,
			// Preserve relative preference after RRF for debugging / ties.
			score: hit.score + (finalLimit - index) * 0.0001,
		}));
	} catch (error) {
		console.error("[rerank-hits]", error);
		return candidates.slice(0, finalLimit);
	}
}
