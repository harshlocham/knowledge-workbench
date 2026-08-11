import type { ScoredChunkHit } from "#/lib/rag/diversify-hits.ts";

/**
 * Merge several ranked hit lists into one evidence set that spans sources.
 *
 * `diversifyHitsByTime` spreads hits along a single source's timeline; this
 * spreads them *across* sources so a multi-source artifact cannot be written
 * from one dominant document. Round-robin by source preserves per-source rank
 * while giving every source a turn.
 */
export function spreadHitsAcrossSources(
	lists: ScoredChunkHit[][],
	options?: { maxPerSource?: number; maxTotal?: number },
): ScoredChunkHit[] {
	const maxPerSource = options?.maxPerSource ?? 6;
	const maxTotal = options?.maxTotal ?? 32;

	const bestByChunk = new Map<string, ScoredChunkHit>();
	for (const list of lists) {
		for (const hit of list) {
			if (!hit.chunkId || !hit.text) continue;
			const existing = bestByChunk.get(hit.chunkId);
			if (!existing || hit.score > existing.score) {
				bestByChunk.set(hit.chunkId, hit);
			}
		}
	}

	const bySource = new Map<string, ScoredChunkHit[]>();
	for (const hit of bestByChunk.values()) {
		const list = bySource.get(hit.sourceId) ?? [];
		list.push(hit);
		bySource.set(hit.sourceId, list);
	}

	for (const list of bySource.values()) {
		list.sort((a, b) => b.score - a.score);
	}

	// Stable source order (highest-scoring source first) keeps output deterministic.
	const queues = [...bySource.values()].sort(
		(a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0),
	);

	const selected: ScoredChunkHit[] = [];
	for (let round = 0; round < maxPerSource; round++) {
		for (const queue of queues) {
			const hit = queue[round];
			if (!hit) continue;
			selected.push(hit);
			if (selected.length >= maxTotal) {
				return selected;
			}
		}
	}

	return selected;
}
