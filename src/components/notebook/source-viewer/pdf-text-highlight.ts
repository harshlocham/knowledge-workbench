export type PdfTextItemRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MatchRange = { start: number; end: number };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the cited quote inside the concatenated pdf.js text layer.
 * Uses whitespace-flexible matching so unpdf chunks still hit PDF.js tokens.
 */
export function findCitationRanges(options: {
  haystack: string;
  quote: string;
}): MatchRange[] {
  const haystack = options.haystack;
  const quote = options.quote.trim();
  if (!haystack || !quote) return [];

  const exact = haystack.indexOf(quote);
  if (exact !== -1) {
    return [{ start: exact, end: exact + quote.length }];
  }

  const words = quote.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const tryWords = (slice: string[]) => {
    if (slice.length === 0) return null;
    const pattern = slice.map(escapeRegExp).join("\\s+");
    try {
      const match = haystack.match(new RegExp(pattern, "i"));
      if (!match || match.index == null) return null;
      return { start: match.index, end: match.index + match[0].length };
    } catch {
      return null;
    }
  };

  const full = tryWords(words);
  if (full) return [full];

  // Shorter prefix (first ~12 words) for long chunks
  const prefix = tryWords(words.slice(0, Math.min(12, words.length)));
  if (prefix) return [prefix];

  // Last resort: first long word (≥5 chars)
  const anchor = words.find((word) => word.length >= 5);
  if (!anchor) return [];
  const idx = haystack.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return [];
  return [{ start: idx, end: idx + anchor.length }];
}

/**
 * Map character ranges over concatenated item strings into viewport rectangles.
 */
export function rangesToRects(
  items: Array<{ str: string; rect: PdfTextItemRect }>,
  ranges: MatchRange[],
): PdfTextItemRect[] {
  if (ranges.length === 0 || items.length === 0) return [];

  const rects: PdfTextItemRect[] = [];

  for (const range of ranges) {
    let cursor = 0;
    for (const item of items) {
      const next = cursor + item.str.length;
      const overlapStart = Math.max(range.start, cursor);
      const overlapEnd = Math.min(range.end, next);

      if (overlapEnd > overlapStart && item.str.length > 0) {
        const localStart = overlapStart - cursor;
        const localEnd = overlapEnd - cursor;
        const fracStart = localStart / item.str.length;
        const fracEnd = localEnd / item.str.length;
        const left = item.rect.left + item.rect.width * fracStart;
        const width = Math.max(item.rect.width * (fracEnd - fracStart), 2);
        rects.push({
          left,
          top: item.rect.top,
          width,
          height: Math.max(item.rect.height, 10),
        });
      }

      cursor = next;
    }
  }

  return mergeNearbyRects(rects);
}

function mergeNearbyRects(rects: PdfTextItemRect[]) {
  if (rects.length <= 1) return rects;

  const sorted = [...rects].sort(
    (a, b) => a.top - b.top || a.left - b.left,
  );
  const merged: PdfTextItemRect[] = [];

  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(last.top - rect.top) < last.height * 0.5 &&
      rect.left <= last.left + last.width + 4
    ) {
      const right = Math.max(last.left + last.width, rect.left + rect.width);
      last.left = Math.min(last.left, rect.left);
      last.width = right - last.left;
      last.height = Math.max(last.height, rect.height);
    } else {
      merged.push({ ...rect });
    }
  }

  return merged;
}

/** Build a searchable string + item list from pdf.js text content. */
export function buildTextLayerModel(
  items: Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
  }>,
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
) {
  const layerItems: Array<{ str: string; rect: PdfTextItemRect }> = [];
  let haystack = "";

  for (const item of items) {
    if (!item.str) continue;

    const tx = item.transform[4] ?? 0;
    const ty = item.transform[5] ?? 0;
    const [x1, y1] = viewport.convertToViewportPoint(tx, ty);
    const [x2, y2] = viewport.convertToViewportPoint(
      tx + item.width,
      ty + item.height,
    );

    const left = Math.min(x1!, x2!);
    const top = Math.min(y1!, y2!);
    const width = Math.abs(x2! - x1!);
    const height = Math.abs(y2! - y1!);

    layerItems.push({
      str: item.str,
      rect: { left, top, width, height: Math.max(height, 8) },
    });
    haystack += item.str;
  }

  return { haystack, items: layerItems };
}
