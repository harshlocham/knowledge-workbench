import { useEffect, useRef } from "react";

import type { ViewerHighlight } from "./types.ts";

function resolveRange(content: string, highlight: ViewerHighlight | null) {
	if (!highlight) {
		return null;
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
		return { start, end };
	}

	const needle = highlight.content.trim();
	if (!needle) {
		return null;
	}

	const index = content.indexOf(needle);
	if (index === -1) {
		return null;
	}

	return { start: index, end: index + needle.length };
}

export function HighlightedText({
	content,
	highlight,
	className,
	animateKey,
}: {
	content: string;
	highlight: ViewerHighlight | null;
	className?: string;
	animateKey?: string;
}) {
	const markRef = useRef<HTMLElement | null>(null);
	const range = resolveRange(content, highlight);

	useEffect(() => {
		const node = markRef.current;
		if (!node) {
			return;
		}

		node.scrollIntoView({ behavior: "smooth", block: "center" });
		node.classList.remove("citation-highlight-pulse");
		// Restart CSS animation
		void node.offsetWidth;
		node.classList.add("citation-highlight-pulse");
	}, [animateKey, highlight?.chunkId, range?.start, range?.end]);

	if (!range) {
		return <span className={className}>{content}</span>;
	}

	return (
		<span className={className}>
			{content.slice(0, range.start)}
			<mark
				ref={markRef}
				data-highlight
				className="citation-highlight rounded-sm bg-[color-mix(in_oklab,var(--lagoon)_40%,transparent)] px-0.5 text-[var(--sea-ink)]"
			>
				{content.slice(range.start, range.end)}
			</mark>
			{content.slice(range.end)}
		</span>
	);
}
