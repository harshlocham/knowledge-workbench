import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { messages, type MessageCitation } from "#/db/schema/messages.ts";
import { sources } from "#/db/schema/sources.ts";
import { generateSourceAddedSummary } from "#/lib/rag/llm.ts";
import { formatVttTimestamp } from "#/lib/rag/parse-vtt.server.ts";

const SUMMARY_CHUNK_LIMIT = 14;
const EXCERPT_CHAR_LIMIT = 1100;

/**
 * After a source indexes successfully, post an assistant chat message summarizing it
 * (NotebookLM-style "I've added this source" overview).
 */
export async function postSourceAddedSummaryMessage(options: {
  sourceId: string;
  notebookId: string;
  sourceType: string;
  chunkRows: Array<{
    id: string;
    content: string;
    locator: MessageCitation["locator"];
  }>;
}) {
  const { sourceId, notebookId, sourceType, chunkRows } = options;

  const [source] = await db
    .select({
      title: sources.title,
      metadata: sources.metadata,
    })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  if (!source) {
    return null;
  }

  const meta =
    source.metadata && typeof source.metadata === "object"
      ? (source.metadata as Record<string, unknown>)
      : {};

  // Avoid duplicate summaries if indexing retries for the same ready source.
  if (typeof meta.summaryMessageId === "string") {
    return null;
  }

  const sample = pickSummaryChunks(chunkRows, SUMMARY_CHUNK_LIMIT);
  if (sample.length === 0) {
    return null;
  }

  const { summary, citedIndexes } = await generateSourceAddedSummary({
    sourceTitle: source.title,
    sourceType,
    excerpts: sample.map((chunk) => ({
      text: chunk.content.slice(0, EXCERPT_CHAR_LIMIT),
      label: excerptLabel(chunk.locator),
    })),
  });

  const citations: MessageCitation[] = citedIndexes
    .map((index) => {
      const chunk = sample[index - 1];
      if (!chunk) return null;
      return {
        chunkId: chunk.id,
        sourceId,
        sourceTitle: source.title,
        quote: chunk.content.slice(0, 280),
        locator: chunk.locator ?? {},
        citationNumber: index,
      } satisfies MessageCitation;
    })
    .filter((item): item is MessageCitation => item != null);

  // Always include at least the first chunk so the summary is openable.
  if (citations.length === 0 && sample[0]) {
    citations.push({
      chunkId: sample[0].id,
      sourceId,
      sourceTitle: source.title,
      quote: sample[0].content.slice(0, 280),
      locator: sample[0].locator ?? {},
      citationNumber: 1,
    });
  }

  const [message] = await db
    .insert(messages)
    .values({
      notebookId,
      role: "assistant",
      content: summary,
      citations,
    })
    .returning({ id: messages.id });

  if (!message) {
    return null;
  }

  await db
    .update(sources)
    .set({
      metadata: {
        ...meta,
        summaryMessageId: message.id,
      },
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));

  return message.id;
}

function excerptLabel(locator: MessageCitation["locator"]): string | undefined {
  if (!locator || typeof locator.tStart !== "number") {
    return undefined;
  }

  const start = formatShortClock(locator.tStart);
  if (typeof locator.tEnd === "number" && locator.tEnd > locator.tStart) {
    return `${start}–${formatShortClock(locator.tEnd)}`;
  }
  return start;
}

/** Compact clock for prompt labels (drop millis). */
function formatShortClock(totalSeconds: number): string {
  const full = formatVttTimestamp(totalSeconds);
  return full.replace(/\.\d+$/, "");
}

/**
 * Prefer opening + closing context, with evenly spaced samples through the middle.
 * Long YouTube videos need more than a thin title-driven skim.
 */
function pickSummaryChunks<T extends { content: string }>(
  rows: T[],
  max: number,
): T[] {
  if (rows.length <= max) return rows;

  const indexes = new Set<number>();
  indexes.add(0);
  if (rows.length > 1) indexes.add(1);
  if (rows.length > 2) indexes.add(rows.length - 1);

  const remaining = max - indexes.size;
  if (remaining > 0 && rows.length > 3) {
    for (let i = 0; i < remaining; i++) {
      const t = (i + 1) / (remaining + 1);
      const index = Math.round(2 + t * (rows.length - 4));
      indexes.add(Math.min(Math.max(index, 2), rows.length - 2));
    }
  }

  // If collisions left us short, fill evenly.
  if (indexes.size < max) {
    const step = (rows.length - 1) / (max - 1);
    for (let i = 0; i < max && indexes.size < max; i++) {
      indexes.add(Math.round(i * step));
    }
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((index) => rows[index]!);
}

/** Best-effort wrapper — never fail indexing because of summary generation. */
export async function tryPostSourceAddedSummaryMessage(
  options: Parameters<typeof postSourceAddedSummaryMessage>[0],
) {
  try {
    return await postSourceAddedSummaryMessage(options);
  } catch (error) {
    console.error("[source-summary]", options.sourceId, error);
    return null;
  }
}
