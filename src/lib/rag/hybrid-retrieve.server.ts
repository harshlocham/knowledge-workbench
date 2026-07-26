import { searchNotebookChunks } from "#/lib/qdrant/points.ts";
import {
  diversifyHitsByTime,
  type ScoredChunkHit,
} from "#/lib/rag/diversify-hits.ts";
import { embedTexts } from "#/lib/rag/embed.ts";
import { searchNotebookChunksLexical } from "#/lib/rag/lexical-search.server.ts";
import { rewriteRetrievalQuery } from "#/lib/rag/rewrite-query.server.ts";

const DENSE_LIMIT_PER_QUERY = 24;
const LEXICAL_LIMIT = 24;
const RRF_K = 60;
const DEFAULT_CANDIDATE_LIMIT = 40;
const DEFAULT_FINAL_LIMIT = 8;
const DEFAULT_MIN_GAP_SECONDS = 90;

/**
 * Reciprocal Rank Fusion across multiple ranked lists.
 * Rank is 1-based within each list.
 */
export function fuseHitsByRrf(
  lists: ScoredChunkHit[][],
  options?: { k?: number; limit?: number },
): ScoredChunkHit[] {
  const k = options?.k ?? RRF_K;
  const limit = options?.limit ?? DEFAULT_CANDIDATE_LIMIT;
  const byId = new Map<string, { hit: ScoredChunkHit; score: number }>();

  for (const list of lists) {
    list.forEach((hit, index) => {
      if (!hit.chunkId) return;
      const contrib = 1 / (k + index + 1);
      const existing = byId.get(hit.chunkId);
      if (existing) {
        existing.score += contrib;
        // Prefer denser/higher original score payload when merging metadata.
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

/**
 * Rewrite → multi-query dense + lexical → RRF → time diversify.
 */
export async function retrieveHybridNotebookChunks(options: {
  notebookId: string;
  ownerId: string;
  question: string;
  finalLimit?: number;
  minGapSeconds?: number;
}): Promise<{
  hits: ScoredChunkHit[];
  rewritten: Awaited<ReturnType<typeof rewriteRetrievalQuery>>;
}> {
  const finalLimit = options.finalLimit ?? DEFAULT_FINAL_LIMIT;
  const minGapSeconds = options.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS;

  const rewritten = await rewriteRetrievalQuery(options.question);
  const embeddingQueries =
    rewritten.embeddingQueries.length > 0
      ? rewritten.embeddingQueries
      : [options.question];

  const vectors = await embedTexts(embeddingQueries);

  const denseLists = await Promise.all(
    vectors.map((vector) =>
      searchNotebookChunks({
        notebookId: options.notebookId,
        ownerId: options.ownerId,
        vector,
        limit: DENSE_LIMIT_PER_QUERY,
      }),
    ),
  );

  let lexicalHits: ScoredChunkHit[] = [];
  try {
    lexicalHits = await searchNotebookChunksLexical({
      notebookId: options.notebookId,
      query: rewritten.lexicalQuery || options.question,
      limit: LEXICAL_LIMIT,
    });
  } catch (error) {
    console.error("[lexical-search]", error);
  }

  const fused = fuseHitsByRrf([...denseLists, lexicalHits], {
    limit: DEFAULT_CANDIDATE_LIMIT,
  });

  const hits = diversifyHitsByTime(fused, {
    finalLimit,
    minGapSeconds,
  });

  return { hits, rewritten };
}
