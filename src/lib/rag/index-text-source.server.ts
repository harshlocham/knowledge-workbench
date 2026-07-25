import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import { sources } from "#/db/schema/sources.ts";
import { deletePointsBySourceId, upsertChunkPoints } from "#/lib/qdrant/points.ts";
import { chunkPlainText } from "#/lib/rag/chunk.ts";
import { embedTexts } from "#/lib/rag/embed.ts";

export type TextSourceMetadata = {
  content: string;
  charCount: number;
};

function getTextContent(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const content = (metadata as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

async function setSourceStatus(
  sourceId: string,
  status: "indexing" | "ready" | "failed",
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

export async function clearSourceIndex(sourceId: string) {
  try {
    await deletePointsBySourceId(sourceId);
  } catch {
    // Collection may not exist yet on first run / misconfigured env
  }

  await db.delete(chunks).where(eq(chunks.sourceId, sourceId));
}

export async function indexTextSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  content: string;
}) {
  const { sourceId, notebookId, ownerId, content } = options;

  await setSourceStatus(sourceId, "indexing");
  await clearSourceIndex(sourceId);

  try {
    const textChunks = chunkPlainText(content);
    if (textChunks.length === 0) {
      throw new Error("Source content is empty after normalization");
    }

    const embeddings = await embedTexts(textChunks.map((chunk) => chunk.content));

    const inserted = await db
      .insert(chunks)
      .values(
        textChunks.map((chunk) => ({
          sourceId,
          notebookId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          locator: chunk.locator,
        })),
      )
      .returning();

    await upsertChunkPoints(
      inserted.map((row, index) => ({
        id: row.qdrantPointId,
        vector: embeddings[index]!,
        payload: {
          notebookId,
          sourceId,
          chunkId: row.id,
          ownerId,
          sourceType: "text",
          chunkIndex: row.chunkIndex,
          text: row.content,
          locator: row.locator,
        },
      })),
    );

    await db
      .update(sources)
      .set({
        status: "ready",
        errorMessage: null,
        metadata: {
          content,
          charCount: content.length,
          chunkCount: inserted.length,
        } satisfies TextSourceMetadata & { chunkCount: number },
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to index text source";
    await setSourceStatus(sourceId, "failed", message);
    throw error;
  }
}

export async function reindexTextSource(options: {
  sourceId: string;
  notebookId: string;
  ownerId: string;
  metadata: unknown;
}) {
  const content = getTextContent(options.metadata);
  if (!content?.trim()) {
    await setSourceStatus(
      options.sourceId,
      "failed",
      "Missing text content for re-index",
    );
    throw new Error("Missing text content for re-index");
  }

  await indexTextSource({
    sourceId: options.sourceId,
    notebookId: options.notebookId,
    ownerId: options.ownerId,
    content,
  });
}
