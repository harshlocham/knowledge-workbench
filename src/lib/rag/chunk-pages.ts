import { chunkPlainText, type TextChunk } from "#/lib/rag/chunk.ts";

/** Chunk each page independently so locators keep a stable page number. */
export function chunkPages(
  pages: Array<{ page: number; text: string }>,
): TextChunk[] {
  const prepared: TextChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const pageChunks = chunkPlainText(page.text);

    for (const chunk of pageChunks) {
      prepared.push({
        content: chunk.content,
        chunkIndex,
        locator: {
          ...chunk.locator,
          page: page.page,
        },
      });
      chunkIndex += 1;
    }
  }

  return prepared;
}
