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

/** Turn a keyword string into an OR full-text query (`mud | excavator | buried`). */
export function buildOrTsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));

  const unique = [...new Set(terms)].slice(0, 16);
  if (unique.length === 0) return "";

  // Escape tsquery special chars inside terms; keep alphanumerics only after filter.
  return unique.map((term) => `${term}:*`).join(" | ");
}

/**
 * Postgres full-text search over chunk content for a notebook.
 * Uses OR semantics so multi-keyword rewrites still match partial chunks.
 */
export async function searchNotebookChunksLexical(options: {
  notebookId: string;
  query: string;
  limit?: number;
}): Promise<ScoredChunkHit[]> {
  const tsQuery = buildOrTsQuery(options.query);
  if (!tsQuery) return [];

  const limit = options.limit ?? 20;

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
        to_tsvector('english', c.content),
        to_tsquery('english', ${tsQuery})
      ) AS rank
    FROM chunks c
    WHERE c.notebook_id = ${options.notebookId}
      AND to_tsvector('english', c.content) @@ to_tsquery('english', ${tsQuery})
    ORDER BY rank DESC
    LIMIT ${limit}
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
