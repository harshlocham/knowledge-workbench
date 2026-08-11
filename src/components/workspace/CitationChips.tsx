import { formatCompactTime } from "#/components/notebook/source-viewer/format.ts";
import { citationKey } from "#/components/workspace/MarkdownWithCitations.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import { cn } from "#/lib/utils.ts";

/** Stored YouTube cues may still be ms from before timing normalization. */
function formatCitationClock(tStart: number): string {
	const seconds = tStart >= 100_000 ? tStart / 1000 : tStart;
	return formatCompactTime(seconds);
}

/** The evidence footer shown under a grounded answer or artifact. */
export function CitationChips({
	citations,
	ownerId,
	activeCitationKey,
	onCitationClick,
	className,
}: {
	citations: MessageCitation[];
	ownerId: string;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
	className?: string;
}) {
	if (citations.length === 0) {
		return null;
	}

	return (
		<div className={cn("flex flex-wrap gap-1.5", className)}>
			{citations.map((citation) => {
				const key = citationKey(ownerId, citation);
				return (
					<button
						key={key}
						type="button"
						onClick={() => onCitationClick(citation, ownerId)}
						className={cn(
							"max-w-full rounded-full px-2.5 py-1 text-left text-xs font-medium transition focus-ring",
							activeCitationKey === key
								? "bg-accent text-foreground ring-2 ring-primary"
								: "bg-muted text-foreground/80 hover:bg-muted/80 hover:text-foreground",
						)}
					>
						<span className="text-primary">[{citation.citationNumber}]</span>{" "}
						<span className="wrap-break-word">
							{citation.sourceTitle ?? "Source"}
						</span>
						{citation.locator?.page != null
							? ` · p.${citation.locator.page}`
							: ""}
						{citation.locator?.tStart != null
							? ` · ${formatCitationClock(citation.locator.tStart)}`
							: ""}
					</button>
				);
			})}
		</div>
	);
}
