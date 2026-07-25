import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";

export type ViewerHighlight = {
  chunkId: string;
  content: string;
  locator?: {
    page?: number;
    startOffset?: number;
    endOffset?: number;
    url?: string;
    heading?: string;
  } | null;
};

export type ViewerSource = {
  id: string;
  title: string;
  type: string;
  content: string;
  highlight: ViewerHighlight | null;
  originalUrl?: string | null;
};

function renderHighlightedContent(
  content: string,
  highlight: ViewerHighlight | null,
) {
  if (!highlight) {
    return <span>{content}</span>;
  }

  const start = highlight.locator?.startOffset;
  const end = highlight.locator?.endOffset;

  if (
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end > start &&
    end <= content.length
  ) {
    return (
      <>
        <span>{content.slice(0, start)}</span>
        <mark
          data-highlight
          className="rounded-sm bg-[color-mix(in_oklab,var(--lagoon)_35%,transparent)] px-0.5 text-[var(--sea-ink)]"
        >
          {content.slice(start, end)}
        </mark>
        <span>{content.slice(end)}</span>
      </>
    );
  }

  const needle = highlight.content.trim();
  const index = needle ? content.indexOf(needle) : -1;
  if (index === -1) {
    return <span>{content}</span>;
  }

  return (
    <>
      <span>{content.slice(0, index)}</span>
      <mark
        data-highlight
        className="rounded-sm bg-[color-mix(in_oklab,var(--lagoon)_35%,transparent)] px-0.5 text-[var(--sea-ink)]"
      >
        {content.slice(index, index + needle.length)}
      </mark>
      <span>{content.slice(index + needle.length)}</span>
    </>
  );
}

export function SourceViewerPanel({
  source,
  loading,
  onClose,
}: {
  source: ViewerSource | null;
  loading: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mark = scrollRef.current?.querySelector("[data-highlight]");
    mark?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [source?.id, source?.highlight?.chunkId]);

  if (!source && !loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-[var(--sea-ink)]">Source viewer</p>
        <p className="text-sm text-[var(--sea-ink-soft)]">
          Select a citation or source to inspect the original text.
        </p>
      </div>
    );
  }

  const openUrl = source?.originalUrl ?? source?.highlight?.locator?.url;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--sea-ink)]">
            {loading ? "Loading source…" : source?.title}
          </p>
          {source ? (
            <p className="mt-0.5 text-xs uppercase tracking-wide text-[var(--sea-ink-soft)]">
              {source.type}
              {source.highlight?.locator?.page != null
                ? ` · page ${source.highlight.locator.page}`
                : ""}
              {source.highlight?.locator?.heading
                ? ` · ${source.highlight.locator.heading}`
                : ""}
            </p>
          ) : null}
          {openUrl ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
            >
              <ExternalLink className="size-3 shrink-0" />
              <span className="truncate">{openUrl}</span>
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
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
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">Opening source…</p>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--sea-ink)]">
            {renderHighlightedContent(
              source?.content ?? "",
              source?.highlight ?? null,
            )}
          </pre>
        )}
      </div>
    </div>
  );
}
