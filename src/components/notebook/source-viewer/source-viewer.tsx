import { useEffect } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LoaderCircle,
  X,
} from "lucide-react";

import { Button } from "#/components/ui/button.tsx";

import { formatViewerTime } from "./format.ts";
import { PdfViewer } from "./pdf-viewer.tsx";
import { TextViewer } from "./text-viewer.tsx";
import { TranscriptViewer } from "./transcript-viewer.tsx";
import type { CitationNavItem, ViewerSource } from "./types.ts";
import { WebsiteViewer } from "./website-viewer.tsx";

function locationLabel(source: ViewerSource) {
  const locator = source.highlight?.locator;
  if (!locator) {
    return source.type;
  }

  const parts = [source.type];
  if (locator.page != null) {
    parts.push(`page ${locator.page}`);
  }
  if (locator.heading) {
    parts.push(locator.heading);
  }
  if (locator.tStart != null && locator.tEnd != null) {
    parts.push(
      `${formatViewerTime(locator.tStart)} → ${formatViewerTime(locator.tEnd)}`,
    );
  }
  return parts.join(" · ");
}

export function SourceViewer({
  source,
  loading,
  onClose,
  citations = [],
  activeCitationKey = null,
  onNavigateCitation,
}: {
  source: ViewerSource | null;
  loading: boolean;
  onClose: () => void;
  citations?: CitationNavItem[];
  activeCitationKey?: string | null;
  onNavigateCitation?: (citation: CitationNavItem) => void;
}) {
  const activeIndex = citations.findIndex(
    (citation) => citation.key === activeCitationKey,
  );
  const hasNav = citations.length > 1 && !!onNavigateCitation;

  useEffect(() => {
    if (!hasNav) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        const next = citations[(activeIndex + 1 + citations.length) % citations.length];
        if (next) {
          onNavigateCitation?.(next);
        }
      }

      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        const prev =
          citations[(activeIndex - 1 + citations.length) % citations.length];
        if (prev) {
          onNavigateCitation?.(prev);
        }
      }

      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, citations, hasNav, onClose, onNavigateCitation]);

  if (!source && !loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-[var(--sea-ink)]">Source viewer</p>
        <p className="text-sm text-[var(--sea-ink-soft)]">
          Select a citation or source to inspect the exact referenced location.
        </p>
      </div>
    );
  }

  const openUrl = source?.originalUrl ?? source?.highlight?.locator?.url;
  const animateKey = `${source?.id ?? ""}:${source?.highlight?.chunkId ?? ""}:${activeCitationKey ?? ""}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--sea-ink)]">
            {loading ? "Opening source…" : source?.title}
          </p>
          {source ? (
            <p className="mt-0.5 truncate text-xs uppercase tracking-wide text-[var(--sea-ink-soft)]">
              {locationLabel(source)}
            </p>
          ) : null}
          {activeCitationKey && citations.length > 0 ? (
            <p className="mt-1 text-xs text-[var(--palm)]">
              Active citation {Math.max(activeIndex, 0) + 1} of {citations.length}
              {hasNav ? " · ↑↓ or J/K to navigate" : ""}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {hasNav ? (
            <>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Previous citation"
                onClick={() => {
                  const prev =
                    citations[
                      (activeIndex - 1 + citations.length) % citations.length
                    ];
                  if (prev) {
                    onNavigateCitation?.(prev);
                  }
                }}
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Next citation"
                onClick={() => {
                  const next =
                    citations[(activeIndex + 1) % citations.length];
                  if (next) {
                    onNavigateCitation?.(next);
                  }
                }}
              >
                <ChevronDown />
              </Button>
            </>
          ) : null}
          {openUrl ? (
            <Button asChild variant="outline" size="xs">
              <a href={openUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close source viewer"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading || !source ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--sea-ink-soft)]">
            <LoaderCircle className="size-5 animate-spin text-[var(--lagoon-deep)]" />
            Opening cited source…
          </div>
        ) : source.type === "pdf" ? (
          <PdfViewer
            sourceId={source.id}
            pages={source.pages}
            highlight={source.highlight}
            animateKey={animateKey}
            hasFile={source.hasFile}
          />
        ) : source.type === "url" ? (
          <WebsiteViewer
            content={source.content}
            highlight={source.highlight}
            originalUrl={source.originalUrl}
            animateKey={animateKey}
          />
        ) : source.type === "vtt" || source.type === "youtube" ? (
          <TranscriptViewer
            cues={source.cues}
            highlight={source.highlight}
            videoId={source.videoId}
            animateKey={animateKey}
          />
        ) : (
          <TextViewer
            content={source.content}
            highlight={source.highlight}
            animateKey={animateKey}
          />
        )}
      </div>
    </div>
  );
}
