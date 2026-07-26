import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import {
  messages,
  type MessageCitation,
} from "#/db/schema/messages.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { sources } from "#/db/schema/sources.ts";
import { runNotebookAsk } from "#/features/chat/ask-notebook.server.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.types.ts";
import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import { requireUserId } from "#/lib/auth.server.ts";
import { formatVttTimestamp } from "#/lib/rag/parse-vtt.server.ts";

export type { ChatMessageDTO } from "#/features/chat/chat.types.ts";

function toMessageDTO(row: typeof messages.$inferSelect): ChatMessageDTO {
  return {
    id: row.id,
    notebookId: row.notebookId,
    role: row.role,
    content: row.content,
    citations: row.citations ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

export const listMessages = createServerFn({ method: "GET" })
  .validator(z.object({ notebookId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireOwnedNotebook(data.notebookId);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.notebookId, data.notebookId))
      .orderBy(asc(messages.createdAt));

    return rows.map(toMessageDTO);
  });

export const askNotebook = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notebookId: z.string().uuid(),
      question: z.string().trim().min(1).max(4000),
    }),
  )
  .handler(async ({ data }) => {
    const { userId } = await requireOwnedNotebook(data.notebookId);
    return runNotebookAsk({
      notebookId: data.notebookId,
      ownerId: userId,
      question: data.question,
    });
  });

export const getSourceViewer = createServerFn({ method: "GET" })
  .validator(
    z.object({
      sourceId: z.string().uuid(),
      chunkId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();

    const [row] = await db
      .select({
        source: sources,
        ownerId: notebooks.ownerId,
      })
      .from(sources)
      .innerJoin(notebooks, eq(sources.notebookId, notebooks.id))
      .where(and(eq(sources.id, data.sourceId), eq(notebooks.ownerId, userId)))
      .limit(1);

    if (!row) {
      throw notFound();
    }

    const metadata = row.source.metadata as { content?: string } | null;

    let highlight: {
      chunkId: string;
      content: string;
      locator: MessageCitation["locator"];
    } | null = null;

    if (data.chunkId) {
      const [chunk] = await db
        .select()
        .from(chunks)
        .where(
          and(eq(chunks.id, data.chunkId), eq(chunks.sourceId, data.sourceId)),
        )
        .limit(1);

      if (chunk) {
        highlight = {
          chunkId: chunk.id,
          content: chunk.content,
          locator: chunk.locator,
        };
      }
    }

    let content =
      typeof metadata?.content === "string" ? metadata.content : "";

    let pages: Array<{ page: number; text: string }> | null = null;
    let cues: Array<{
      cueIndex: number;
      tStart: number;
      tEnd: number;
      text: string;
    }> | null = null;

    const meta = metadata as {
      content?: string;
      canonicalUrl?: string;
      videoId?: string;
      pageCount?: number;
      cues?: Array<{
        cueIndex: number;
        tStart: number;
        tEnd: number;
        text: string;
      }>;
    } | null;

    // Transcript sources (VTT / future YouTube): structured cues for the viewer
    if (row.source.type === "vtt" || row.source.type === "youtube") {
      cues = Array.isArray(meta?.cues) ? meta.cues : [];

      if (cues.length > 0) {
        content = cues
          .map(
            (cue) =>
              `[${formatVttTimestamp(cue.tStart)} → ${formatVttTimestamp(cue.tEnd)}] ${cue.text}`,
          )
          .join("\n");

        if (highlight) {
          const cueIndexes =
            highlight.locator?.cueIndexes ??
            (highlight.locator?.cueIndex != null
              ? [highlight.locator.cueIndex]
              : []);

          const matchedLines = cues
            .filter((cue) => cueIndexes.includes(cue.cueIndex))
            .map(
              (cue) =>
                `[${formatVttTimestamp(cue.tStart)} → ${formatVttTimestamp(cue.tEnd)}] ${cue.text}`,
            );

          highlight = {
            ...highlight,
            content:
              matchedLines.length > 0
                ? matchedLines.join("\n")
                : highlight.content,
            locator: {
              ...highlight.locator,
              startOffset: undefined,
              endOffset: undefined,
            },
          };
        }
      }
    }

    // PDFs: page-structured text for citation jump + file preview
    if (row.source.type === "pdf") {
      const pdfChunks = await db
        .select()
        .from(chunks)
        .where(eq(chunks.sourceId, data.sourceId))
        .orderBy(asc(chunks.chunkIndex));

      const byPage = new Map<number, string[]>();
      for (const chunk of pdfChunks) {
        const page = chunk.locator?.page ?? 0;
        const list = byPage.get(page) ?? [];
        list.push(chunk.content);
        byPage.set(page, list);
      }

      pages = [...byPage.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([page]) => page > 0)
        .map(([page, parts]) => ({
          page,
          text: parts.join("\n\n"),
        }));

      content = pages
        .map((item) => `--- Page ${item.page} ---\n\n${item.text}`)
        .join("\n\n");

      // Keep page-local offsets for cited-text panel; PDF canvas uses quote match.
    }

    const videoId =
      (typeof meta?.videoId === "string" ? meta.videoId : null) ??
      highlight?.locator?.videoId ??
      null;

    return {
      id: row.source.id,
      title: row.source.title,
      type: row.source.type,
      status: row.source.status,
      content,
      highlight,
      originalUrl:
        row.source.originalUrl ??
        (typeof meta?.canonicalUrl === "string" ? meta.canonicalUrl : null),
      videoId,
      pages,
      cues,
      pageCount:
        typeof meta?.pageCount === "number"
          ? meta.pageCount
          : (pages?.length ?? null),
      hasFile: Boolean(row.source.storageUri),
    };
  });
