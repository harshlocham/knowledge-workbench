import { Children, type ReactNode, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationBadge } from "#/components/workspace/CitationBadge.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Scopes a citation to the block that rendered it (a chat message or an
 * artifact), so the same chunk cited in two places highlights independently.
 */
export function citationKey(ownerId: string, citation: MessageCitation) {
	return `${ownerId}:${citation.chunkId}:${citation.citationNumber ?? ""}`;
}

type CitationResolver = (citationNumber: number) => MessageCitation | undefined;

/**
 * Resolves `[n]` to the citation that claims number `n`. Falling back to list
 * position is only safe for older records that carry no numbers at all —
 * otherwise a stray number would silently render someone else's source.
 */
function makeCitationResolver(citations: MessageCitation[]): CitationResolver {
	const byNumber = new Map<number, MessageCitation>();
	for (const citation of citations) {
		if (typeof citation.citationNumber === "number") {
			byNumber.set(citation.citationNumber, citation);
		}
	}

	if (byNumber.size === 0) {
		return (citationNumber) => citations[citationNumber - 1];
	}

	return (citationNumber) => byNumber.get(citationNumber);
}

function injectCitationBadges(
	node: ReactNode,
	resolveCitation: CitationResolver,
	ownerId: string,
	activeCitationKey: string | null,
	onCitationClick: (citation: MessageCitation, ownerId: string) => void,
): ReactNode {
	if (typeof node === "string") {
		const children: ReactNode[] = [];
		// Keys use the character offset within the text, which is stable per render.
		let offset = 0;

		for (const part of node.split(/(\[\d+\])/g)) {
			const start = offset;
			offset += part.length;
			if (!part) continue;

			const match = part.match(/^\[(\d+)\]$/);
			if (!match) {
				children.push(<span key={`t-${start}`}>{part}</span>);
				continue;
			}

			const citationNumber = Number(match[1]);
			const citation = resolveCitation(citationNumber);
			if (!citation) {
				children.push(<span key={`t-${start}`}>{part}</span>);
				continue;
			}

			const key = citationKey(ownerId, citation);
			children.push(
				<CitationBadge
					key={`c-${start}`}
					number={citationNumber}
					title={citation.sourceTitle}
					active={activeCitationKey === key}
					onClick={() => onCitationClick(citation, ownerId)}
				/>,
			);
		}

		return children;
	}

	if (Array.isArray(node)) {
		// Children.map assigns stable keys for us.
		return Children.map(node, (child) =>
			injectCitationBadges(
				child,
				resolveCitation,
				ownerId,
				activeCitationKey,
				onCitationClick,
			),
		);
	}

	return node;
}

/** Markdown renderer that turns `[n]` markers into clickable citation badges. */
export function MarkdownWithCitations({
	content,
	citations,
	ownerId,
	activeCitationKey,
	onCitationClick,
	className,
}: {
	content: string;
	citations: MessageCitation[];
	ownerId: string;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
	className?: string;
}) {
	const resolveCitation = useMemo(
		() => makeCitationResolver(citations),
		[citations],
	);

	const wrap =
		(Tag: "p" | "li" | "td" | "th" | "strong" | "em") =>
		({ children }: { children?: ReactNode }) => {
			const Comp = Tag;
			return (
				<Comp>
					{injectCitationBadges(
						children,
						resolveCitation,
						ownerId,
						activeCitationKey,
						onCitationClick,
					)}
				</Comp>
			);
		};

	return (
		<div
			className={cn(
				"prose prose-sm dark:prose-invert max-w-none text-foreground",
				"prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-pre:my-3",
				"prose-headings:font-[Fraunces,serif] prose-headings:text-foreground",
				"prose-strong:font-semibold prose-strong:text-foreground",
				"prose-em:text-foreground",
				"prose-a:font-medium prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
				"prose-code:before:content-none prose-code:after:content-none",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					p: wrap("p"),
					li: wrap("li"),
					td: wrap("td"),
					th: wrap("th"),
					strong: wrap("strong"),
					em: wrap("em"),
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
