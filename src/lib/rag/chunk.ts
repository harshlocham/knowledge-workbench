import type { ChunkLocator } from "#/db/schema/chunks.ts";

export type TextChunk = {
  content: string;
  chunkIndex: number;
  locator: ChunkLocator;
};

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 120;

/** Split plain text into overlapping chunks with character offsets for highlighting. */
export function chunkPlainText(
  text: string,
  options?: { chunkSize?: number; overlap?: number },
): TextChunk[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;
  const normalized = text.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= chunkSize) {
    return [
      {
        content: normalized,
        chunkIndex: 0,
        locator: { startOffset: 0, endOffset: normalized.length },
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" "),
      );

      if (breakAt > chunkSize * 0.4) {
        end = start + breakAt + (window[breakAt] === "." ? 1 : 0);
      }
    }

    const content = normalized.slice(start, end).trim();
    if (content) {
      const trimmedStart = normalized.indexOf(content, start);
      chunks.push({
        content,
        chunkIndex: index,
        locator: {
          startOffset: trimmedStart,
          endOffset: trimmedStart + content.length,
        },
      });
      index += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
