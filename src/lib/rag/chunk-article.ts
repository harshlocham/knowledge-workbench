import { chunkPlainText, type TextChunk } from "#/lib/rag/chunk.ts";

/**
 * Reuse the shared plain-text chunker, then attach URL + nearest preceding heading.
 */
export function chunkArticleText(
  content: string,
  options: { url: string },
): TextChunk[] {
  return chunkPlainText(content).map((chunk) => ({
    ...chunk,
    locator: {
      ...chunk.locator,
      url: options.url,
      heading: findHeadingBefore(content, chunk.locator.startOffset ?? 0),
    },
  }));
}

function findHeadingBefore(content: string, offset: number): string | undefined {
  const before = content.slice(0, Math.max(0, offset));
  const matches = [...before.matchAll(/^##\s+(.+)$/gm)];
  const last = matches.at(-1)?.[1]?.trim();
  return last || undefined;
}
