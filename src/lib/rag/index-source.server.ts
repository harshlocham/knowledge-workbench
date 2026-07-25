import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import { sources } from "#/db/schema/sources.ts";
import { deletePointsBySourceId, upsertChunkPoints } from "#/lib/qdrant/points.ts";
import type { TextChunk } from "#/lib/rag/chunk.ts";
import { embedTexts } from "#/lib/rag/embed.ts";

export async function setSourceStatus(
  sourceId: string,
  status: "uploading" | "indexing" | "ready" | "failed",
  errorMessage: string | null = null,
) {
  await db
    .update(sources)
    .set({
      status,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));
}

/** Remove Postgres chunks + Qdrant vectors for a source (no orphan vectors). */
export async function clearSourceIndex(sourceId: string) {
  try {
    await deletePointsBySourceId(sourceId);
  } catch {
    // Collection may not exist yet on first run / misconfigured env
  }

  await db.delete(chunks).where(eq(chunks.sourceId, sourceId));
}

/**
 * Persist prepared chunks: embed → Postgres → Qdrant → ready.
 * Caller owns status=indexing and any prior clearSourceIndex.
 */
export async function persistSourceChunks(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  sourceType: "pdf" | "text" | "url" | "youtube" | "vtt";
  preparedChunks: TextChunk[];
  readyMetadata: Record<string, unknown>;
}) {
  const {
    sourceId,
    notebookId,
    ownerId,
    sourceType,
    preparedChunks,
    readyMetadata,
  } = options;

  if (preparedChunks.length === 0) {
    throw new Error("No extractable text found in source");
  }

  const embeddings = await embedTexts(
    preparedChunks.map((chunk) => chunk.content),
  );

  const inserted = await db
    .insert(chunks)
    .values(
      preparedChunks.map((chunk) => ({
        sourceId,
        notebookId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        locator: chunk.locator,
      })),
    )
    .returning();

  try {
    await upsertChunkPoints(
      inserted.map((row, index) => ({
        id: row.qdrantPointId,
        vector: embeddings[index]!,
        payload: {
          notebookId,
          sourceId,
          chunkId: row.id,
          ownerId,
          sourceType,
          chunkIndex: row.chunkIndex,
          text: row.content,
          locator: row.locator,
        },
      })),
    );
  } catch (error) {
    // Qdrant failed after Postgres insert — remove partial rows/vectors
    await clearSourceIndex(sourceId);
    throw error;
  }

  await db
    .update(sources)
    .set({
      status: "ready",
      errorMessage: null,
      metadata: {
        ...readyMetadata,
        chunkCount: inserted.length,
      },
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));

  return { chunkCount: inserted.length };
}

/**
 * Shared indexing entrypoint for source types that already have extracted text.
 * Order: indexing → clear → persist → ready | failed(+cleanup).
 */
export async function indexSourceChunks(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  sourceType: "pdf" | "text" | "url" | "youtube" | "vtt";
  preparedChunks: TextChunk[];
  readyMetadata: Record<string, unknown>;
}) {
  await setSourceStatus(options.sourceId, "indexing");
  await clearSourceIndex(options.sourceId);

  try {
    return await persistSourceChunks(options);
  } catch (error) {
    await clearSourceIndex(options.sourceId);
    const message =
      error instanceof Error ? error.message : "Failed to index source";
    await setSourceStatus(options.sourceId, "failed", message);
    throw error;
  }
}
