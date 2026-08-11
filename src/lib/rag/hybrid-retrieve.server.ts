import { searchNotebookChunks } from "#/lib/qdrant/points.ts";
import {
	diversifyHitsByTime,
	type ScoredChunkHit,
} from "#/lib/rag/diversify-hits.ts";
import { embedTexts } from "#/lib/rag/embed.ts";
import { searchNotebookChunksLexical } from "#/lib/rag/lexical-search.server.ts";
import { rerankHitsForQuestion } from "#/lib/rag/rerank-hits.server.ts";
import { rewriteRetrievalQuery } from "#/lib/rag/rewrite-query.server.ts";

const DENSE_LIMIT_PER_QUERY = 20;
const LEXICAL_LIMIT = 20;
const RRF_K = 60;
const FUSED_CANDIDATE_LIMIT = 28;
const DIVERSIFY_LIMIT = 14;
const DEFAULT_FINAL_LIMIT = 8;
const DEFAULT_MIN_GAP_SECONDS = 90;
/** Keep rewrite+embed light: original + at most one paraphrase. */
const MAX_EMBED_QUERIES = 2;

/**
 * Reciprocal Rank Fusion across multiple ranked lists.
 * Rank is 1-based within each list.
 */
export function fuseHitsByRrf(
	lists: ScoredChunkHit[][],
	options?: { k?: number; limit?: number },
): ScoredChunkHit[] {
	const k = options?.k ?? RRF_K;
	const limit = options?.limit ?? FUSED_CANDIDATE_LIMIT;
	const byId = new Map<string, { hit: ScoredChunkHit; score: number }>();

	for (const list of lists) {
		list.forEach((hit, index) => {
			if (!hit.chunkId) return;
			const contrib = 1 / (k + index + 1);
			const existing = byId.get(hit.chunkId);
			if (existing) {
				existing.score += contrib;
				if (hit.score > existing.hit.score) {
					existing.hit = hit;
				}
			} else {
				byId.set(hit.chunkId, { hit, score: contrib });
			}
		});
	}

	return [...byId.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ hit, score }) => ({ ...hit, score }));
}

export type RetrievalPhase = "rewriting" | "searching" | "reranking";

/**
 * Rewrite → multi-query dense + lexical → RRF → time diversify → rerank.
 */
export async function retrieveHybridNotebookChunks(options: {
	notebookId: string;
	ownerId: string;
	question: string;
	/** Recent chat turns for follow-up-aware rewrite/rerank. */
	historySummary?: string;
	finalLimit?: number;
	minGapSeconds?: number;
	onPhase?: (phase: RetrievalPhase) => void;
}): Promise<{
	hits: ScoredChunkHit[];
	rewritten: Awaited<ReturnType<typeof rewriteRetrievalQuery>>;
}> {
	const finalLimit = options.finalLimit ?? DEFAULT_FINAL_LIMIT;
	const minGapSeconds = options.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS;

	options.onPhase?.("rewriting");
	const rewritten = await rewriteRetrievalQuery(options.question, {
		historySummary: options.historySummary,
	});

	const embeddingQueries = (
		rewritten.embeddingQueries.length > 0
			? rewritten.embeddingQueries
			: [options.question]
	).slice(0, MAX_EMBED_QUERIES);

	options.onPhase?.("searching");
	const vectors = await embedTexts(embeddingQueries);

	const [denseLists, lexicalHits] = await Promise.all([
		Promise.all(
			vectors.map((vector) =>
				searchNotebookChunks({
					notebookId: options.notebookId,
					ownerId: options.ownerId,
					vector,
					limit: DENSE_LIMIT_PER_QUERY,
				}),
			),
		),
		searchNotebookChunksLexical({
			notebookId: options.notebookId,
			query: rewritten.lexicalQuery || options.question,
			limit: LEXICAL_LIMIT,
		}).catch((error) => {
			console.error("[lexical-search]", error);
			return [] as ScoredChunkHit[];
		}),
	]);

	const fused = fuseHitsByRrf([...denseLists, lexicalHits], {
		limit: FUSED_CANDIDATE_LIMIT,
	});

	const diversified = diversifyHitsByTime(fused, {
		finalLimit: Math.max(finalLimit, DIVERSIFY_LIMIT),
		minGapSeconds,
	});

	options.onPhase?.("reranking");
	const hits = await rerankHitsForQuestion({
		question: options.question,
		hits: diversified,
		finalLimit,
		historySummary: options.historySummary,
	});

	return { hits, rewritten };
}
