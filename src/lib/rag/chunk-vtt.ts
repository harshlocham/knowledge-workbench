import { chunkPlainText, type TextChunk } from "#/lib/rag/chunk.ts";
import type { VttCue } from "#/lib/rag/parse-vtt.server.ts";

type CueSpan = {
  cueIndex: number;
  tStart: number;
  tEnd: number;
  startOffset: number;
  endOffset: number;
};

/** Compact clock for embed/prompt labels (drop millis). */
export function formatChunkClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/**
 * Join cues into plain text, run the shared chunker, then map each chunk
 * back onto overlapping cue timings (tStart / tEnd / cueIndexes).
 * Timed chunks get a `[start–end]` prefix so embeddings + RAG see when
 * the clip happens (plainText stays unprefixed for source metadata).
 * Optional videoId is attached for YouTube deep-links.
 */
export function chunkVttCues(
  cues: VttCue[],
  options?: { videoId?: string; url?: string },
): {
  plainText: string;
  chunks: TextChunk[];
} {
  const spans: CueSpan[] = [];
  const parts: string[] = [];
  let cursor = 0;

  for (const cue of cues) {
    if (parts.length > 0) {
      parts.push("\n");
      cursor += 1;
    }

    const startOffset = cursor;
    parts.push(cue.text);
    cursor += cue.text.length;

    spans.push({
      cueIndex: cue.cueIndex,
      tStart: cue.tStart,
      tEnd: cue.tEnd,
      startOffset,
      endOffset: cursor,
    });
  }

  const plainText = parts.join("");
  const textChunks = chunkPlainText(plainText);

  const chunks = textChunks.map((chunk) => {
    const start = chunk.locator.startOffset ?? 0;
    const end = chunk.locator.endOffset ?? start;

    const overlapping = spans.filter(
      (span) => span.startOffset < end && span.endOffset > start,
    );

    const timed = overlapping.length > 0 ? overlapping : spans.slice(0, 1);
    const cueIndexes = timed.map((span) => span.cueIndex);
    const tStart = timed[0]?.tStart;
    const tEnd = timed.at(-1)?.tEnd;

    const timePrefix =
      typeof tStart === "number" && typeof tEnd === "number"
        ? `[${formatChunkClock(tStart)}–${formatChunkClock(tEnd)}] `
        : "";

    return {
      content: `${timePrefix}${chunk.content}`,
      chunkIndex: chunk.chunkIndex,
      locator: {
        startOffset: chunk.locator.startOffset,
        endOffset: chunk.locator.endOffset,
        tStart,
        tEnd,
        cueIndex: cueIndexes[0],
        cueIndexes,
        videoId: options?.videoId,
        url: options?.url,
      },
    } satisfies TextChunk;
  });

  return { plainText, chunks };
}
