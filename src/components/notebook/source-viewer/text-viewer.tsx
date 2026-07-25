import { HighlightedText } from "./highlighted-text.tsx";
import type { ViewerHighlight } from "./types.ts";

export function TextViewer({
  content,
  highlight,
  animateKey,
}: {
  content: string;
  highlight: ViewerHighlight | null;
  animateKey?: string;
}) {
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--sea-ink)]">
      <HighlightedText
        content={content}
        highlight={highlight}
        animateKey={animateKey}
      />
    </pre>
  );
}
