import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import type { ChunkLocator } from "#/db/schema/chunks.ts";
import type { ScoredChunkHit } from "#/lib/rag/diversify-hits.ts";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "during",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
]);

/** Turn a keyword string into an OR full-text query (`mud:* | excavator:*`). */
export function buildOrTsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));

  const unique = [...new Set(terms)].slice(0, 16);
  if (unique.length === 0) return "";

  return unique.map((term) => `${term}:*`).join(" | ");
}

/**
 * Postgres full-text search over chunk content for a notebook.
 * Prefers stored `search_vector` (GIN) when present; falls back to on-the-fly tsvector.
 */
export async function searchNotebookChunksLexical(options: {
  notebookId: string;
  query: string;
  limit?: number;
}): Promise<ScoredChunkHit[]> {
  const tsQuery = buildOrTsQuery(options.query);
  if (!tsQuery) return [];

  const limit = options.limit ?? 20;

  try {
    return await runLexicalQuery({
      notebookId: options.notebookId,
      tsQuery,
      limit,
      useStoredVector: true,
    });
  } catch (error) {
    // Pre-migration DBs may not have search_vector yet.
    console.warn("[lexical-search] stored vector failed; falling back", error);
    return runLexicalQuery({
      notebookId: options.notebookId,
      tsQuery,
      limit,
      useStoredVector: false,
    });
  }
}

async function runLexicalQuery(options: {
  notebookId: string;
  tsQuery: string;
  limit: number;
  useStoredVector: boolean;
}): Promise<ScoredChunkHit[]> {
  const vectorExpr = options.useStoredVector
    ? sql`c.search_vector`
    : sql`to_tsvector('english', c.content)`;

  const result = await db.execute<{
    id: string;
    source_id: string;
    chunk_index: number;
    content: string;
    locator: ChunkLocator;
    rank: number;
  }>(sql`
    SELECT
      c.id,
      c.source_id,
      c.chunk_index,
      c.content,
      c.locator,
      ts_rank_cd(
        ${vectorExpr},
        to_tsquery('english', ${options.tsQuery})
      ) AS rank
    FROM chunks c
    WHERE c.notebook_id = ${options.notebookId}
      AND ${vectorExpr} @@ to_tsquery('english', ${options.tsQuery})
    ORDER BY rank DESC
    LIMIT ${options.limit}
  `);

  const records = result.rows ?? [];

  return records
    .filter((row) => row?.id && row?.content)
    .map((row) => ({
      score: Number(row.rank) || 0,
      chunkId: String(row.id),
      sourceId: String(row.source_id),
      sourceType: "unknown",
      chunkIndex: Number(row.chunk_index) || 0,
      text: String(row.content),
      locator: (row.locator ?? {}) as ChunkLocator,
    }));
}
