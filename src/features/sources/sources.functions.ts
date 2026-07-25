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
import { normalizeUrl } from "#/lib/rag/extract-url.server.ts";
import { indexPdfSource } from "#/lib/rag/index-pdf-source.server.ts";
import { clearSourceIndex } from "#/lib/rag/index-source.server.ts";
import {
  indexTextSource,
  reindexTextSource,
  type TextSourceMetadata,
} from "#/lib/rag/index-text-source.server.ts";
import { indexUrlSource } from "#/lib/rag/index-url-source.server.ts";
import { indexVttSource } from "#/lib/rag/index-vtt-source.server.ts";
import {
  deleteSourceFile,
  pdfStorageKey,
  readSourceFile,
  saveSourceFile,
  vttStorageKey,
} from "#/lib/storage/files.server.ts";

export type SourceDTO = {
  id: string;
  notebookId: string;
  type: "pdf" | "text" | "url" | "youtube" | "vtt";
  title: string;
  status: "uploading" | "indexing" | "ready" | "failed";
  errorMessage: string | null;
  originalUrl: string | null;
  charCount: number | null;
  chunkCount: number | null;
  pageCount: number | null;
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
    originalUrl: row.originalUrl,
    charCount: readMetaNumber(row.metadata, "charCount"),
    chunkCount: readMetaNumber(row.metadata, "chunkCount"),
    pageCount: readMetaNumber(row.metadata, "pageCount"),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function decodeBase64(base64: string) {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function refreshSource(sourceId: string) {
  const [fresh] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  if (!fresh) {
    throw notFound();
  }

  return toSourceDTO(fresh);
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
      // Status already marked failed inside indexer
    }

    return refreshSource(row.id);
  });

export const createPdfSource = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notebookId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      fileName: z.string().trim().min(1).max(260),
      fileBase64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireOwnedNotebook(data.notebookId);

    const bytes = decodeBase64(data.fileBase64);
    if (bytes.byteLength === 0) {
      throw new Error("PDF file is empty");
    }

    // ~20MB decoded limit for local uploads
    if (bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error("PDF must be 20MB or smaller");
    }

    const [row] = await db
      .insert(sources)
      .values({
        notebookId: data.notebookId,
        type: "pdf",
        title: data.title,
        status: "uploading",
        metadata: {
          originalFileName: data.fileName,
          mimeType: "application/pdf",
        },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create PDF source");
    }

    const storageKey = pdfStorageKey(data.notebookId, row.id);

    try {
      await saveSourceFile({ storageKey, data: bytes });

      await db
        .update(sources)
        .set({
          storageUri: storageKey,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, row.id));

      await indexPdfSource({
        sourceId: row.id,
        notebookId: data.notebookId,
        ownerId: userId,
        storageUri: storageKey,
        existingMetadata: {
          originalFileName: data.fileName,
          mimeType: "application/pdf",
        },
      });
    } catch {
      // Indexer/storage errors mark failed; keep row for retry/re-index
    }

    return refreshSource(row.id);
  });

export const createUrlSource = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notebookId: z.string().uuid(),
      url: z.string().trim().min(1).max(2000),
      title: z.string().trim().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireOwnedNotebook(data.notebookId);

    let url: string;
    try {
      url = normalizeUrl(data.url);
    } catch {
      throw new Error("Enter a valid website URL");
    }

    const title =
      data.title?.trim() ||
      (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return "Website";
        }
      })();

    const [row] = await db
      .insert(sources)
      .values({
        notebookId: data.notebookId,
        type: "url",
        title,
        status: "uploading",
        originalUrl: url,
        metadata: {},
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create URL source");
    }

    try {
      await indexUrlSource({
        sourceId: row.id,
        notebookId: data.notebookId,
        ownerId: userId,
        url,
        updateTitleFromPage: !data.title?.trim(),
      });
    } catch {
      // Status already marked failed inside indexer
    }

    return refreshSource(row.id);
  });

export const createVttSource = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notebookId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      fileName: z.string().trim().min(1).max(260),
      fileBase64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireOwnedNotebook(data.notebookId);

    const bytes = decodeBase64(data.fileBase64);
    if (bytes.byteLength === 0) {
      throw new Error("VTT file is empty");
    }

    if (bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("VTT must be 10MB or smaller");
    }

    const [row] = await db
      .insert(sources)
      .values({
        notebookId: data.notebookId,
        type: "vtt",
        title: data.title,
        status: "uploading",
        metadata: {
          originalFileName: data.fileName,
          mimeType: "text/vtt",
        },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create VTT source");
    }

    const storageKey = vttStorageKey(data.notebookId, row.id);

    try {
      await saveSourceFile({ storageKey, data: bytes });

      await db
        .update(sources)
        .set({
          storageUri: storageKey,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, row.id));

      await indexVttSource({
        sourceId: row.id,
        notebookId: data.notebookId,
        ownerId: userId,
        storageUri: storageKey,
        existingMetadata: {
          originalFileName: data.fileName,
          mimeType: "text/vtt",
        },
      });
    } catch {
      // Status already marked failed inside indexer when applicable
    }

    return refreshSource(row.id);
  });

export const reindexSource = createServerFn({ method: "POST" })
  .validator(z.object({ sourceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { userId, source } = await requireOwnedSource(data.sourceId);

    try {
      if (source.type === "text") {
        await reindexTextSource({
          sourceId: source.id,
          notebookId: source.notebookId,
          ownerId: userId,
          metadata: source.metadata,
        });
      } else if (source.type === "pdf") {
        if (!source.storageUri) {
          throw new Error("PDF file is missing from storage");
        }

        await indexPdfSource({
          sourceId: source.id,
          notebookId: source.notebookId,
          ownerId: userId,
          storageUri: source.storageUri,
          existingMetadata:
            source.metadata && typeof source.metadata === "object"
              ? (source.metadata as Record<string, unknown>)
              : {},
        });
      } else if (source.type === "url") {
        if (!source.originalUrl) {
          throw new Error("URL source is missing originalUrl");
        }

        await indexUrlSource({
          sourceId: source.id,
          notebookId: source.notebookId,
          ownerId: userId,
          url: source.originalUrl,
          updateTitleFromPage: false,
        });
      } else if (source.type === "vtt") {
        if (!source.storageUri) {
          throw new Error("VTT file is missing from storage");
        }

        await indexVttSource({
          sourceId: source.id,
          notebookId: source.notebookId,
          ownerId: userId,
          storageUri: source.storageUri,
          existingMetadata:
            source.metadata && typeof source.metadata === "object"
              ? (source.metadata as Record<string, unknown>)
              : {},
        });
      } else {
        throw new Error(
          `Re-index is not implemented for source type: ${source.type}`,
        );
      }
    } catch {
      // Status already marked failed inside indexer when applicable
    }

    return refreshSource(source.id);
  });

export const deleteSource = createServerFn({ method: "POST" })
  .validator(z.object({ sourceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { source } = await requireOwnedSource(data.sourceId);

    await clearSourceIndex(source.id);
    await deleteSourceFile(source.storageUri);

    const [deleted] = await db
      .delete(sources)
      .where(and(eq(sources.id, source.id)))
      .returning({ id: sources.id });

    if (!deleted) {
      throw notFound();
    }

    return { id: deleted.id };
  });

/** Serve an owned source binary (PDF/VTT) to the source viewer. */
export const getSourceFile = createServerFn({ method: "GET" })
  .validator(z.object({ sourceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { source } = await requireOwnedSource(data.sourceId);

    if (!source.storageUri) {
      throw new Error("Source file is not available");
    }

    const buffer = await readSourceFile(source.storageUri);
    const mimeType =
      source.type === "pdf"
        ? "application/pdf"
        : source.type === "vtt"
          ? "text/vtt"
          : "application/octet-stream";

    const meta = source.metadata as { originalFileName?: string } | null;

    return {
      mimeType,
      fileName: meta?.originalFileName ?? `${source.id}.${source.type}`,
      base64: Buffer.from(buffer).toString("base64"),
    };
  });
