import { ExternalLink } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { sectionLabel, sectionUrl } from "#/lib/locator.ts";

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
	// A cited section with a real DOM id lands the reader on that section
	// instead of the top of the page.
	const href = sectionUrl(url, highlight?.locator?.anchor);
	const section = sectionLabel(highlight?.locator);

	return (
		<div className="space-y-4">
			{url && href ? (
				<div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2">
					<ExternalLink className="size-3.5 shrink-0 text-[var(--lagoon-deep)]" />
					<a
						href={href}
						target="_blank"
						rel="noreferrer"
						className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--lagoon-deep)] hover:underline"
					>
						{url}
					</a>
					<Button asChild size="xs" variant="outline">
						<a href={href} target="_blank" rel="noreferrer">
							Open page
						</a>
					</Button>
				</div>
			) : null}

			{section ? (
				<p className="text-xs font-medium tracking-wide text-[var(--kicker)] uppercase">
					{section}
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
