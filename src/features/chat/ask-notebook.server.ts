import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  messages,
  type MessageCitation,
} from "#/db/schema/messages.ts";
import { sources } from "#/db/schema/sources.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.types.ts";
import { retrieveHybridNotebookChunks } from "#/lib/rag/hybrid-retrieve.server.ts";
import {
  generateGroundedAnswerStream,
  type RetrievedContext,
} from "#/lib/rag/llm.ts";

const RETRIEVAL_FINAL_LIMIT = 8;
const RETRIEVAL_MIN_GAP_SECONDS = 90;
const CHAT_HISTORY_LIMIT = 6;

export type AskPhase =
  | "understanding"
  | "searching"
  | "ranking"
  | "writing"
  | "saving";

export type AskPhaseEvent = {
  phase: AskPhase;
  message: string;
};

function buildHistorySummary(
  rows: Array<{ role: "user" | "assistant"; content: string }>,
) {
  return rows
    .map((row) => {
      const label = row.role === "user" ? "User" : "Assistant";
      const text = row.content.replace(/\s+/g, " ").trim().slice(0, 400);
      return `${label}: ${text}`;
    })
    .join("\n");
}

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

function buildCitations(
  answer: string,
  citedIndexes: number[],
  contexts: RetrievedContext[],
) {
  const indexes =
    citedIndexes.length > 0
      ? citedIndexes
      : /cannot find|couldn't find|do not contain|don't contain|no relevant/i.test(
            answer,
          )
        ? []
        : contexts.slice(0, 2).map((ctx) => ctx.index);

  const citations: MessageCitation[] = [];
  for (const citationNumber of indexes) {
    const ctx = contexts.find((item) => item.index === citationNumber);
    if (!ctx) continue;
    citations.push({
      chunkId: ctx.chunkId,
      sourceId: ctx.sourceId,
      sourceTitle: ctx.sourceTitle,
      quote: ctx.text.slice(0, 280),
      locator: ctx.locator,
      citationNumber,
    });
  }

  let finalAnswer = answer;
  if (
    contexts.length > 0 &&
    citedIndexes.length === 0 &&
    citations.length > 0 &&
    !/cannot find|couldn't find|do not contain|don't contain|no relevant/i.test(
      answer,
    )
  ) {
    const fallback = citations
      .map((citation) => `[${citation.citationNumber}]`)
      .join(" ");
    finalAnswer = `${answer}\n\nSources: ${fallback}`;
  }

  return { citations, finalAnswer };
}

/**
 * Full ask pipeline with optional progress + token streaming hooks.
 */
export async function runNotebookAsk(options: {
  notebookId: string;
  ownerId: string;
  question: string;
  onPhase?: (event: AskPhaseEvent) => void;
  onToken?: (token: string) => void;
}): Promise<{
  userMessage: ChatMessageDTO;
  assistantMessage: ChatMessageDTO;
}> {
  const { notebookId, ownerId, question } = options;
  const emit = (phase: AskPhase, message: string) => {
    options.onPhase?.({ phase, message });
  };

  const readySources = await db
    .select({ id: sources.id, title: sources.title })
    .from(sources)
    .where(
      and(eq(sources.notebookId, notebookId), eq(sources.status, "ready")),
    );

  const [userMessage] = await db
    .insert(messages)
    .values({
      notebookId,
      role: "user",
      content: question,
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
        notebookId,
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

  const priorMessages = await db
    .select({
      role: messages.role,
      content: messages.content,
    })
    .from(messages)
    .where(
      and(eq(messages.notebookId, notebookId), ne(messages.id, userMessage.id)),
    )
    .orderBy(desc(messages.createdAt))
    .limit(CHAT_HISTORY_LIMIT);

  const historySummary = buildHistorySummary([...priorMessages].reverse());

  const { hits } = await retrieveHybridNotebookChunks({
    notebookId,
    ownerId,
    question,
    historySummary,
    finalLimit: RETRIEVAL_FINAL_LIMIT,
    minGapSeconds: RETRIEVAL_MIN_GAP_SECONDS,
    onPhase: (phase) => {
      if (phase === "rewriting") {
        emit("understanding", "Understanding your question…");
      } else if (phase === "searching") {
        emit("searching", "Searching sources…");
      } else if (phase === "reranking") {
        emit("ranking", "Ranking the best clips…");
      }
    },
  });

  const sourceTitleById = new Map(
    readySources.map((source) => [source.id, source.title]),
  );

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

  const contexts: RetrievedContext[] = hits
    .filter((hit) => hit.chunkId && hit.text)
    .map((hit, index) => ({
      index: index + 1,
      chunkId: hit.chunkId,
      sourceId: hit.sourceId,
      sourceTitle: sourceTitleById.get(hit.sourceId) ?? "Untitled source",
      text: hit.text,
      locator: hit.locator,
    }));

  emit("writing", "Writing answer…");

  const { answer, citedIndexes } = await generateGroundedAnswerStream({
    question,
    contexts,
    historySummary,
    onToken: options.onToken,
  });

  const { citations, finalAnswer } = buildCitations(
    answer,
    citedIndexes,
    contexts,
  );

  emit("saving", "Saving answer…");

  const [assistantMessage] = await db
    .insert(messages)
    .values({
      notebookId,
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
}
