import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { chunks } from "#/db/schema/chunks.ts";
import {
  messages,
  type MessageCitation,
} from "#/db/schema/messages.ts";
import { notebooks } from "#/db/schema/notebooks.ts";
import { sources } from "#/db/schema/sources.ts";
import { requireOwnedNotebook } from "#/features/sources/notebook-access.server.ts";
import { requireUserId } from "#/lib/auth.server.ts";
import { searchNotebookChunks } from "#/lib/qdrant/points.ts";
import { embedTexts } from "#/lib/rag/embed.ts";
import { generateGroundedAnswer } from "#/lib/rag/llm.ts";
import { formatVttTimestamp } from "#/lib/rag/parse-vtt.server.ts";

export type ChatMessageDTO = {
  id: string;
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  citations: MessageCitation[];
  createdAt: string;
};

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

    const readySources = await db
      .select({ id: sources.id, title: sources.title })
      .from(sources)
      .where(
        and(
          eq(sources.notebookId, data.notebookId),
          eq(sources.status, "ready"),
        ),
      );

    const [userMessage] = await db
      .insert(messages)
      .values({
        notebookId: data.notebookId,
        role: "user",
        content: data.question,
        citations: [],
      })
      .returning();

    if (!userMessage) {
      throw new Error("Failed to save question");
    }

    if (readySources.length === 0) {
      const [assistantMessage] = await db
        .insert(messages)
        .values({
          notebookId: data.notebookId,
          role: "assistant",
          content:
            "This notebook has no ready sources yet. Add and index at least one source, then ask again.",
          citations: [],
        })
        .returning();

      return {
        userMessage: toMessageDTO(userMessage),
        assistantMessage: toMessageDTO(assistantMessage!),
      };
    }

    const [queryVector] = await embedTexts([data.question]);
    const hits = await searchNotebookChunks({
      notebookId: data.notebookId,
      ownerId: userId,
      vector: queryVector!,
      limit: 6,
    });

    const sourceTitleById = new Map(
      readySources.map((source) => [source.id, source.title]),
    );

    // Enrich titles for any hit source (including ones just indexed)
    const missingIds = [
      ...new Set(
        hits
          .map((hit) => hit.sourceId)
          .filter((id) => id && !sourceTitleById.has(id)),
      ),
    ];

    if (missingIds.length > 0) {
      const extra = await db
        .select({ id: sources.id, title: sources.title })
        .from(sources)
        .where(inArray(sources.id, missingIds));

      for (const row of extra) {
        sourceTitleById.set(row.id, row.title);
      }
    }

    const contexts = hits
      .filter((hit) => hit.chunkId && hit.text)
      .map((hit, index) => ({
        index: index + 1,
        chunkId: hit.chunkId,
        sourceId: hit.sourceId,
        sourceTitle: sourceTitleById.get(hit.sourceId) ?? "Untitled source",
        text: hit.text,
        locator: hit.locator,
      }));

    const { answer, citedIndexes } = await generateGroundedAnswer({
      question: data.question,
      contexts,
    });

    const indexes =
      citedIndexes.length > 0
        ? citedIndexes
        : contexts.map((ctx) => ctx.index);

    const citations: MessageCitation[] = [];
    for (const citationNumber of indexes) {
      const ctx = contexts.find((item) => item.index === citationNumber);
      if (!ctx) {
        continue;
      }

      citations.push({
        chunkId: ctx.chunkId,
        sourceId: ctx.sourceId,
        sourceTitle: ctx.sourceTitle,
        quote: ctx.text.slice(0, 280),
        locator: ctx.locator,
        citationNumber,
      });
    }

    // Prefer answer that already has citations; if model omitted them but we have context, append note
    let finalAnswer = answer;
    if (
      contexts.length > 0 &&
      citedIndexes.length === 0 &&
      !/cannot find|couldn't find|do not contain|don't contain/i.test(answer)
    ) {
      const fallback = citations
        .map((citation) => `[${citation.citationNumber}]`)
        .join(" ");
      finalAnswer = `${answer}\n\nSources: ${fallback}`;
    }

    const [assistantMessage] = await db
      .insert(messages)
      .values({
        notebookId: data.notebookId,
        role: "assistant",
        content: finalAnswer,
        citations,
      })
      .returning();

    if (!assistantMessage) {
      throw new Error("Failed to save answer");
    }

    return {
      userMessage: toMessageDTO(userMessage),
      assistantMessage: toMessageDTO(assistantMessage),
    };
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

      if (highlight) {
        highlight = {
          ...highlight,
          locator: {
            ...highlight.locator,
            startOffset: undefined,
            endOffset: undefined,
          },
        };
      }
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
