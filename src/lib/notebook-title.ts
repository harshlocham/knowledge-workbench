import type { SourceDTO } from "#/features/sources/sources.functions.ts";

const UNTITLED = /^untitled(\s+notebook)?$/i;

const WEAK_TITLES = [
  /^text source$/i,
  /^pdf source$/i,
  /^transcript$/i,
  /^website$/i,
  /^youtube\s+[a-zA-Z0-9_-]{6,}$/i,
];

export function isUntitledNotebookTitle(title: string) {
  return UNTITLED.test(title.trim());
}

function isWeakSourceTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return true;
  return WEAK_TITLES.some((pattern) => pattern.test(trimmed));
}

/** Prefer ready sources with stronger titles (e.g. after YouTube/URL fetch). */
export function deriveNotebookTitleFromSources(sources: SourceDTO[]) {
  if (sources.length === 0) return null;

  const ranked = [...sources].sort((a, b) => {
    const aReady = a.status === "ready" ? 0 : 1;
    const bReady = b.status === "ready" ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    const aWeak = isWeakSourceTitle(a.title) ? 1 : 0;
    const bWeak = isWeakSourceTitle(b.title) ? 1 : 0;
    if (aWeak !== bWeak) return aWeak - bWeak;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });

  const titles = ranked
    .map((source) => source.title.trim())
    .filter((title) => title.length > 0);

  if (titles.length === 0) return null;

  if (titles.length === 1) {
    return titles[0]!.slice(0, 200);
  }

  const combined = `${titles[0]} · ${titles[1]}`;
  return combined.slice(0, 200);
}
