import type { ChunkLocator } from "#/db/schema/chunks.ts";

export type ScoredChunkHit = {
	score: number;
	chunkId: string;
	sourceId: string;
	sourceType: string;
	chunkIndex: number;
	text: string;
	locator: ChunkLocator;
};

/**
 * Take a large dense-search shortlist and keep a smaller set that is
 * spread across the video timeline (and across sources).
 *
 * Hits without tStart (PDFs/text) compete only by score.
 */
export function diversifyHitsByTime(
	hits: ScoredChunkHit[],
	options?: {
		finalLimit?: number;
		/** Minimum gap between selected timed hits from the same source. */
		minGapSeconds?: number;
	},
): ScoredChunkHit[] {
	const finalLimit = options?.finalLimit ?? 8;
	const minGapSeconds = options?.minGapSeconds ?? 90;

	if (hits.length <= finalLimit) {
		return hits;
	}

	const selected: ScoredChunkHit[] = [];
	const selectedIds = new Set<string>();

	const isTooClose = (hit: ScoredChunkHit) => {
		const tStart = hit.locator?.tStart;
		if (typeof tStart !== "number") return false;

		return selected.some((picked) => {
			if (picked.sourceId !== hit.sourceId) return false;
			const pickedStart = picked.locator?.tStart;
			if (typeof pickedStart !== "number") return false;
			return Math.abs(pickedStart - tStart) < minGapSeconds;
		});
	};

	// Pass 1: greedy by score, enforce time spacing within each source.
	for (const hit of hits) {
		if (selected.length >= finalLimit) break;
		if (!hit.chunkId || selectedIds.has(hit.chunkId)) continue;
		if (isTooClose(hit)) continue;
		selected.push(hit);
		selectedIds.add(hit.chunkId);
	}

	// Pass 2: fill remaining slots with best leftover hits.
	for (const hit of hits) {
		if (selected.length >= finalLimit) break;
		if (!hit.chunkId || selectedIds.has(hit.chunkId)) continue;
		selected.push(hit);
		selectedIds.add(hit.chunkId);
	}

	return selected;
}
