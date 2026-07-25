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
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-[Fraunces,serif] text-lg font-semibold text-foreground">
            <Map className="size-4 text-primary" />
            Learning roadmap
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Personalized path from your YouTube sources with deep links into clips.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
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
          placeholder="e.g. interview prep…"
          disabled={isGenerating}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Youtube className="size-3.5" />
          {youtubeReadyCount} ready YouTube source
          {youtubeReadyCount === 1 ? "" : "s"}
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {youtubeReadyCount === 0 && !roadmap ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Add and index at least one YouTube video with captions.
          </p>
        </div>
      ) : null}

      {roadmap ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Topic
            </p>
            <h3 className="mt-1 font-[Fraunces,serif] text-base font-semibold text-foreground">
              {roadmap.topic}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{roadmap.overview}</p>
          </div>

          <ol className="space-y-3">
            {roadmap.steps.map((step) => (
              <li
                key={`${step.order}-${step.title}`}
                className="rounded-lg border border-border px-3 py-3"
              >
                <div className="flex gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
                    {step.order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-foreground">
                      {step.title}
                    </h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {step.summary}
                    </p>
                    <div className="mt-2 flex flex-col gap-1.5">
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
                            className="flex w-full items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-left text-xs transition hover:bg-accent focus-ring"
                          >
                            <Youtube className="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <span className="min-w-0">
                              <span className="font-medium text-foreground">
                                {clip.sourceTitle}
                                {ts ? ` · ${ts}` : ""}
                              </span>
                              <span className="mt-0.5 line-clamp-2 block text-muted-foreground">
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
