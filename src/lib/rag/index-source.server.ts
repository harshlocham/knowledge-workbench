import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import { messages } from "#/db/schema/messages.ts";
import { sources } from "#/db/schema/sources.ts";
import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import { deletePointsBySourceId, upsertChunkPoints } from "#/lib/qdrant/points.ts";
import type { TextChunk } from "#/lib/rag/chunk.ts";
import { embedTexts } from "#/lib/rag/embed.ts";
import { tryPostSourceAddedSummaryMessage } from "#/lib/rag/source-summary-message.server.ts";

export type IndexProgress = {
  phase: "queued" | "extracting" | "embedding" | "storing" | "finalizing";
  percent: number;
  message: string;
};

export async function setSourceStatus(
  sourceId: string,
  status: "uploading" | "indexing" | "ready" | "failed",
  errorMessage: string | null = null,
) {
  const [current] = await db
    .select({ metadata: sources.metadata })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  const metadata =
    current?.metadata && typeof current.metadata === "object"
      ? { ...(current.metadata as Record<string, unknown>) }
      : {};

  let previousSummaryMessageId: string | null = null;

  if (status === "ready" || status === "failed") {
    delete metadata.indexProgress;
  } else if (status === "indexing") {
    // Reindex should generate a fresh overview message.
    if (typeof metadata.summaryMessageId === "string") {
      previousSummaryMessageId = metadata.summaryMessageId;
      delete metadata.summaryMessageId;
    }
    if (!metadata.indexProgress) {
      metadata.indexProgress = {
        phase: "queued",
        percent: 5,
        message: "Queued for indexing…",
      } satisfies IndexProgress;
    }
  }

  await db
    .update(sources)
    .set({
      status,
      errorMessage,
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));

  if (previousSummaryMessageId) {
    try {
      await db
        .delete(messages)
        .where(eq(messages.id, previousSummaryMessageId));
    } catch {
      // Old overview may already be gone
    }
  }
}

export async function setSourceIndexProgress(
  sourceId: string,
  progress: IndexProgress,
) {
  const [current] = await db
    .select({ metadata: sources.metadata })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  const metadata =
    current?.metadata && typeof current.metadata === "object"
      ? { ...(current.metadata as Record<string, unknown>) }
      : {};

  metadata.indexProgress = progress;

  await db
    .update(sources)
    .set({
      metadata,
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

  await setSourceIndexProgress(sourceId, {
    phase: "embedding",
    percent: 35,
    message: `Embedding ${preparedChunks.length} chunks…`,
  });

  const embeddings = await embedTexts(
    preparedChunks.map((chunk) => chunk.content),
  );

  await setSourceIndexProgress(sourceId, {
    phase: "storing",
    percent: 70,
    message: "Saving chunks…",
  });

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

  await setSourceIndexProgress(sourceId, {
    phase: "storing",
    percent: 85,
    message: "Writing vectors…",
  });

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

  await setSourceIndexProgress(sourceId, {
    phase: "finalizing",
    percent: 95,
    message: "Finishing up…",
  });

  await setSourceIndexProgress(sourceId, {
    phase: "finalizing",
    percent: 98,
    message: "Writing source overview…",
  });

  // Stay in "indexing" until the overview message is posted so SSE doesn't
  // close before the NotebookLM-style summary appears in chat.
  await tryPostSourceAddedSummaryMessage({
    sourceId,
    notebookId,
    sourceType,
    chunkRows: inserted.map((row) => ({
      id: row.id,
      content: row.content,
      locator: row.locator,
    })),
  });

  const [current] = await db
    .select({ metadata: sources.metadata })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  const currentMeta =
    current?.metadata && typeof current.metadata === "object"
      ? { ...(current.metadata as Record<string, unknown>) }
      : {};

  const cleanedMetadata = {
    ...currentMeta,
    ...readyMetadata,
  };
  delete cleanedMetadata.indexProgress;
  if (typeof currentMeta.summaryMessageId === "string") {
    cleanedMetadata.summaryMessageId = currentMeta.summaryMessageId;
  }

  await db
    .update(sources)
    .set({
      status: "ready",
      errorMessage: null,
      metadata: {
        ...cleanedMetadata,
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
    const message = friendlyIngestError(error, "Failed to index source");
    await setSourceStatus(options.sourceId, "failed", message);
    throw error;
  }
}
