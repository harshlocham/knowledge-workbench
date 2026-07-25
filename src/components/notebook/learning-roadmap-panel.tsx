import { LoaderCircle, Map, RefreshCw, Youtube } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { LearningRoadmap } from "#/features/roadmap/roadmap.functions.ts";

function formatTimestamp(seconds?: number) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type LearningRoadmapPanelProps = {
  youtubeReadyCount: number;
  focus: string;
  onFocusChange: (value: string) => void;
  roadmap: LearningRoadmap | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
  onOpenClip: (citation: MessageCitation) => void;
};

export function LearningRoadmapPanel({
  youtubeReadyCount,
  focus,
  onFocusChange,
  roadmap,
  isGenerating,
  error,
  onGenerate,
  onOpenClip,
}: LearningRoadmapPanelProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-[Fraunces,serif] text-2xl font-semibold text-[var(--sea-ink)]">
            <Map className="size-6 text-[var(--lagoon-deep)]" />
            Learning roadmap
          </h2>
          <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
            Personalized concept path from your YouTube sources, with deep links
            into the exact clips.
          </p>
        </div>
        <Button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating || youtubeReadyCount === 0}
        >
          {isGenerating ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {roadmap ? "Regenerate" : "Generate roadmap"}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="roadmap-focus">Optional focus</Label>
        <Input
          id="roadmap-focus"
          value={focus}
          onChange={(e) => onFocusChange(e.target.value)}
          placeholder="e.g. interview prep, fundamentals first…"
          disabled={isGenerating}
        />
        <p className="flex items-center gap-1.5 text-xs text-[var(--sea-ink-soft)]">
          <Youtube className="size-3.5" />
          {youtubeReadyCount} ready YouTube source
          {youtubeReadyCount === 1 ? "" : "s"}
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {youtubeReadyCount === 0 && !roadmap ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
          <p className="text-sm text-[var(--sea-ink-soft)]">
            Add and index at least one YouTube video (with captions) to build a
            roadmap.
          </p>
        </div>
      ) : null}

      {roadmap ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-5 py-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--sea-ink-soft)]">
              Topic
            </p>
            <h3 className="mt-1 font-[Fraunces,serif] text-xl font-semibold text-[var(--sea-ink)]">
              {roadmap.topic}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--sea-ink-soft)]">
              {roadmap.overview}
            </p>
            <p className="mt-3 text-xs text-[var(--sea-ink-soft)]">
              {roadmap.steps.length} steps · {roadmap.sourceCount} videos ·{" "}
              {roadmap.clipCount} clips sampled
            </p>
          </div>

          <ol className="space-y-4">
            {roadmap.steps.map((step) => (
              <li
                key={`${step.order}-${step.title}`}
                className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-5 py-4 shadow-sm"
              >
                <div className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--lagoon)_20%,transparent)] text-sm font-semibold text-[var(--lagoon-deep)]">
                    {step.order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-[var(--sea-ink)]">
                      {step.title}
                    </h4>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--sea-ink-soft)]">
                      {step.summary}
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      {step.clips.map((clip) => {
                        const ts = formatTimestamp(clip.locator.tStart);
                        return (
                          <button
                            key={`${clip.chunkId}-${clip.citationNumber}`}
                            type="button"
                            onClick={() =>
                              onOpenClip({
                                chunkId: clip.chunkId,
                                sourceId: clip.sourceId,
                                sourceTitle: clip.sourceTitle,
                                quote: clip.quote,
                                locator: clip.locator,
                                citationNumber: clip.citationNumber,
                              })
                            }
                            className="flex w-full items-start gap-2 rounded-xl bg-[var(--chip-bg)] px-3 py-2 text-left text-xs ring-1 ring-[var(--chip-line)] transition hover:bg-[color-mix(in_oklab,var(--lagoon)_12%,transparent)] hover:ring-[var(--lagoon)]"
                          >
                            <Youtube className="mt-0.5 size-3.5 shrink-0 text-[var(--lagoon-deep)]" />
                            <span className="min-w-0">
                              <span className="font-medium text-[var(--sea-ink)]">
                                {clip.sourceTitle}
                                {ts ? ` · ${ts}` : ""}
                              </span>
                              <span className="mt-0.5 line-clamp-2 block text-[var(--sea-ink-soft)]">
                                {clip.quote}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
