import { useEffect, useMemo, useRef, useState } from "react";

import { formatCompactTime, formatViewerTime } from "./format.ts";
import type { ViewerCue, ViewerHighlight } from "./types.ts";

export function TranscriptViewer({
  cues,
  highlight,
  videoId,
  animateKey,
}: {
  cues: ViewerCue[] | null | undefined;
  highlight: ViewerHighlight | null;
  videoId?: string | null;
  animateKey?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [playerSeconds, setPlayerSeconds] = useState<number | null>(null);
  /** Remount + autoplay only after an explicit seek (cue click / citation). */
  const [playToken, setPlayToken] = useState(0);

  const activeCueIndexes = useMemo(() => {
    if (!highlight?.locator) {
      return new Set<number>();
    }
    const fromList = highlight.locator.cueIndexes ?? [];
    if (fromList.length > 0) {
      return new Set(fromList);
    }
    if (highlight.locator.cueIndex != null) {
      return new Set([highlight.locator.cueIndex]);
    }
    return new Set<number>();
  }, [highlight]);

  const seekSeconds = Math.floor(
    playerSeconds ?? highlight?.locator?.tStart ?? 0,
  );

  const seekAndPlay = (seconds: number) => {
    setPlayerSeconds(seconds);
    setPlayToken((token) => token + 1);
  };

  useEffect(() => {
    if (highlight?.locator?.tStart == null) {
      return;
    }
    setPlayerSeconds(highlight.locator.tStart);
    if (animateKey) {
      setPlayToken((token) => token + 1);
    }
  }, [highlight?.chunkId, highlight?.locator?.tStart, animateKey]);

  useEffect(() => {
    const node = listRef.current?.querySelector("[data-active-cue='true']");
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (node) {
      node.classList.remove("citation-highlight-pulse");
      void (node as HTMLElement).offsetWidth;
      node.classList.add("citation-highlight-pulse");
    }
  }, [animateKey, activeCueIndexes, highlight?.chunkId]);

  const shouldAutoplay = playToken > 0;
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${Math.max(0, seekSeconds)}&autoplay=${shouldAutoplay ? 1 : 0}&rel=0`
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {embedUrl ? (
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-black">
          <iframe
            key={`${videoId}-${seekSeconds}-${playToken}`}
            title="YouTube citation player"
            src={embedUrl}
            className="aspect-video w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}

      {highlight?.locator?.tStart != null &&
      highlight?.locator?.tEnd != null ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink-soft)]">
          Cited range{" "}
          <span className="font-medium text-[var(--sea-ink)]">
            {formatViewerTime(highlight.locator.tStart)} →{" "}
            {formatViewerTime(highlight.locator.tEnd)}
          </span>
        </div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {(cues ?? []).map((cue) => {
          const active = activeCueIndexes.has(cue.cueIndex);
          return (
            <button
              key={cue.cueIndex}
              type="button"
              data-active-cue={active ? "true" : "false"}
              onClick={() => seekAndPlay(cue.tStart)}
              className={
                active
                  ? "citation-highlight w-full rounded-lg border border-[color-mix(in_oklab,var(--lagoon)_35%,transparent)] bg-[color-mix(in_oklab,var(--lagoon)_18%,transparent)] px-3 py-2 text-left"
                  : "w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:bg-[color-mix(in_oklab,var(--surface)_85%,white)]"
              }
            >
              <p className="text-[11px] font-medium text-[var(--lagoon-deep)]">
                {formatCompactTime(cue.tStart)} → {formatCompactTime(cue.tEnd)}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--sea-ink)]">
                {cue.text}
              </p>
            </button>
          );
        })}

        {!cues?.length ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">
            No transcript cues available for this source.
          </p>
        ) : null}
      </div>
    </div>
  );
}
