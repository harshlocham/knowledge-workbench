import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { citationKey } from "#/components/workspace/MarkdownWithCitations.tsx";
import { ArtifactSectionsView } from "#/components/workspace/studio/ArtifactSectionsView.tsx";
import { CompareSourcesView } from "#/components/workspace/studio/CompareSourcesView.tsx";
import { LearningRoadmapView } from "#/components/workspace/studio/LearningRoadmapView.tsx";
import { StudyGuideView } from "#/components/workspace/studio/StudyGuideView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { PublicArtifactDTO } from "#/features/studio/artifact-share.public.ts";
import {
	ARTIFACT_TYPE_LABELS,
	type ArtifactDTO,
} from "#/features/studio/artifacts.types.ts";
import { formatRelativeTime } from "#/lib/format-relative.ts";
import { sectionLabel } from "#/lib/locator.ts";

/** Nil UUID — public views never load private chunks/sources. */
const PUBLIC_NIL_ID = "00000000-0000-4000-8000-000000000000";

function toDisplayArtifact(shared: PublicArtifactDTO): {
	artifact: ArtifactDTO;
	externalByNumber: Map<number, string>;
} {
	const externalByNumber = new Map<number, string>();
	const citations: MessageCitation[] = shared.citations.map(
		(citation, index) => {
			if (citation.externalUrl) {
				externalByNumber.set(citation.citationNumber, citation.externalUrl);
			}
			return {
				// Distinct chunk ids so citationKey stays unique across the list.
				chunkId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
				sourceId: PUBLIC_NIL_ID,
				sourceTitle: citation.sourceTitle,
				quote: citation.quote,
				locator: citation.locator,
				citationNumber: citation.citationNumber,
			};
		},
	);

	return {
		externalByNumber,
		artifact: {
			id: PUBLIC_NIL_ID,
			notebookId: PUBLIC_NIL_ID,
			ownerId: PUBLIC_NIL_ID,
			type: shared.type,
			title: shared.title,
			status: "ready",
			content: shared.content,
			citations,
			errorMessage: null,
			isShared: true,
			createdAt: shared.updatedAt,
			updatedAt: shared.updatedAt,
		},
	};
}

/**
 * Read-only published document for `/share/$token`. Never opens private
 * storage — citation clicks only follow `externalUrl` when present.
 */
export function SharedArtifactDocument({
	shared,
}: {
	shared: PublicArtifactDTO;
}) {
	const { artifact, externalByNumber } = useMemo(
		() => toDisplayArtifact(shared),
		[shared],
	);
	const [activeCitationKey, setActiveCitationKey] = useState<string | null>(
		null,
	);
	const [expandedQuote, setExpandedQuote] = useState<string | null>(null);

	function handleCitationClick(citation: MessageCitation) {
		const number = citation.citationNumber ?? 0;
		setActiveCitationKey(citationKey(artifact.id, citation));

		const url = externalByNumber.get(number);
		if (url) {
			window.open(url, "_blank", "noopener,noreferrer");
			setExpandedQuote(null);
			return;
		}

		setExpandedQuote(citation.quote?.trim() || null);
	}

	return (
		<article className="flex flex-col gap-6">
			<header className="border-b border-border pb-5">
				<p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
					Knowledge Workbench
				</p>
				<p className="mt-3 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
					{ARTIFACT_TYPE_LABELS[artifact.type]}
				</p>
				<h1 className="mt-1 font-[Fraunces,serif] text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					{artifact.title}
				</h1>
				<p
					className="mt-2 text-sm text-muted-foreground"
					title={new Date(artifact.updatedAt).toLocaleString()}
				>
					Generated {formatRelativeTime(artifact.updatedAt)} ·{" "}
					{artifact.citations.length} citation
					{artifact.citations.length === 1 ? "" : "s"} · Read-only share
				</p>
			</header>

			{artifact.type === "study_guide" ? (
				<StudyGuideView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={(citation) => handleCitationClick(citation)}
				/>
			) : artifact.type === "learning_roadmap" ? (
				<LearningRoadmapView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={(citation) => handleCitationClick(citation)}
				/>
			) : artifact.type === "compare_sources" ? (
				<CompareSourcesView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={(citation) => handleCitationClick(citation)}
				/>
			) : (
				<ArtifactSectionsView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={(citation) => handleCitationClick(citation)}
				/>
			)}

			{expandedQuote ? (
				<aside className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
					<p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
						Quote
					</p>
					<p className="mt-1 whitespace-pre-wrap">{expandedQuote}</p>
				</aside>
			) : null}

			{shared.citations.length > 0 ? (
				<section className="border-t border-border pt-5">
					<h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Sources
					</h2>
					<ul className="flex flex-col gap-3">
						{shared.citations.map((citation) => {
							const section = sectionLabel(citation.locator);
							return (
								<li
									key={citation.citationNumber}
									className="text-sm text-foreground"
								>
									<p>
										<span className="font-medium text-primary">
											[{citation.citationNumber}]
										</span>{" "}
										{citation.sourceTitle}
										{citation.locator?.page != null
											? ` · p.${citation.locator.page}`
											: ""}
										{typeof citation.locator?.tStart === "number"
											? ` · ${Math.floor(
													citation.locator.tStart >= 100_000
														? citation.locator.tStart / 1000
														: citation.locator.tStart,
												)}s`
											: ""}
										{section ? ` — ${section}` : ""}
									</p>
									{citation.quote ? (
										<p className="mt-1 text-muted-foreground">
											“{citation.quote}”
										</p>
									) : null}
									{citation.externalUrl ? (
										<a
											href={citation.externalUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
										>
											Open source
											<ExternalLink className="size-3" aria-hidden />
										</a>
									) : null}
								</li>
							);
						})}
					</ul>
				</section>
			) : null}
		</article>
	);
}
