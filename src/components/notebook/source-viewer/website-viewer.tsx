import { ExternalLink } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";

import { HighlightedText } from "./highlighted-text.tsx";
import type { ViewerHighlight } from "./types.ts";

export function WebsiteViewer({
  content,
  highlight,
  originalUrl,
  animateKey,
}: {
  content: string;
  highlight: ViewerHighlight | null;
  originalUrl?: string | null;
  animateKey?: string;
}) {
  const url = originalUrl ?? highlight?.locator?.url;

  return (
    <div className="space-y-4">
      {url ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2">
          <ExternalLink className="size-3.5 shrink-0 text-[var(--lagoon-deep)]" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
          >
            {url}
          </a>
          <Button asChild size="xs" variant="outline">
            <a href={url} target="_blank" rel="noreferrer">
              Open page
            </a>
          </Button>
        </div>
      ) : null}

      {highlight?.locator?.heading ? (
        <p className="text-xs font-medium tracking-wide text-[var(--kicker)] uppercase">
          {highlight.locator.heading}
        </p>
      ) : null}

      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--sea-ink)]">
        <HighlightedText
          content={content}
          highlight={highlight}
          animateKey={animateKey}
        />
      </pre>
    </div>
  );
}
