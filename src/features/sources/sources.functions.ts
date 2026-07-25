import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import {
  requireOwnedNotebook,
  requireOwnedSource,
} from "#/features/sources/notebook-access.server.ts";
import {
  clearSourceIndex,
  indexTextSource,
  reindexTextSource,
  type TextSourceMetadata,
} from "#/lib/rag/index-text-source.server.ts";

export type SourceDTO = {
  id: string;
  notebookId: string;
  type: "pdf" | "text" | "url" | "youtube" | "vtt";
  title: string;
  status: "uploading" | "indexing" | "ready" | "failed";
  errorMessage: string | null;
  charCount: number | null;
  chunkCount: number | null;
  createdAt: string;
  updatedAt: string;
};

function readMetaNumber(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function toSourceDTO(row: typeof sources.$inferSelect): SourceDTO {
  return {
    id: row.id,
    notebookId: row.notebookId,
    type: row.type,
    title: row.title,
    status: row.status,
    errorMessage: row.errorMessage,
    charCount: readMetaNumber(row.metadata, "charCount"),
    chunkCount: readMetaNumber(row.metadata, "chunkCount"),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const listSources = createServerFn({ method: "GET" })
  .validator(z.object({ notebookId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireOwnedNotebook(data.notebookId);

    const rows = await db
      .select()
      .from(sources)
      .where(eq(sources.notebookId, data.notebookId))
      .orderBy(desc(sources.createdAt));

    return rows.map(toSourceDTO);
  });

export const createTextSource = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notebookId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      content: z.string().trim().min(1).max(200_000),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireOwnedNotebook(data.notebookId);

    const metadata: TextSourceMetadata = {
      content: data.content,
      charCount: data.content.length,
    };

    const [row] = await db
      .insert(sources)
      .values({
        notebookId: data.notebookId,
        type: "text",
        title: data.title,
        status: "uploading",
        metadata,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create source");
    }

    try {
      await indexTextSource({
        sourceId: row.id,
        notebookId: data.notebookId,
        ownerId: userId,
        content: data.content,
      });
    } catch {
      // Status already marked failed inside indexer; return current row state
    }

    const [fresh] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, row.id))
      .limit(1);

    return toSourceDTO(fresh ?? row);
  });

export const reindexSource = createServerFn({ method: "POST" })
  .validator(z.object({ sourceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { userId, source } = await requireOwnedSource(data.sourceId);

    if (source.type !== "text") {
      throw new Error("Only text sources can be re-indexed in this slice");
    }

    try {
      await reindexTextSource({
        sourceId: source.id,
        notebookId: source.notebookId,
        ownerId: userId,
        metadata: source.metadata,
      });
    } catch {
      // Status already marked failed inside indexer
    }

    const [fresh] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, source.id))
      .limit(1);

    if (!fresh) {
      throw notFound();
    }

    return toSourceDTO(fresh);
  });

export const deleteSource = createServerFn({ method: "POST" })
  .validator(z.object({ sourceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { source } = await requireOwnedSource(data.sourceId);

    await clearSourceIndex(source.id);

    const [deleted] = await db
      .delete(sources)
      .where(and(eq(sources.id, source.id)))
      .returning({ id: sources.id });

    if (!deleted) {
      throw notFound();
    }

    return { id: deleted.id };
  });
