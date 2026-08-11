import { CitationChips } from "#/components/workspace/CitationChips.tsx";
import { MarkdownWithCitations } from "#/components/workspace/MarkdownWithCitations.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ArtifactDTO } from "#/features/studio/artifacts.types.ts";

/** Bullets are rendered as markdown so `[n]` markers become citation badges. */
function bulletsToMarkdown(bullets: string[]) {
	return bullets.map((bullet) => `- ${bullet}`).join("\n");
}

export function ResearchBriefView({
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
}) {
	const sections = artifact.content?.sections ?? [];
	const citations = artifact.citations;

	return (
		<article className="flex flex-col gap-4">
			<header>
				<p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
					Research Brief
				</p>
				<h3 className="mt-1 font-[Fraunces,serif] text-base font-semibold text-foreground">
					{artifact.title}
				</h3>
			</header>

			{sections.map((section) => (
				<section key={section.heading}>
					<h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{section.heading}
					</h4>
					<div className="mt-1.5">
						<MarkdownWithCitations
							content={section.body ?? bulletsToMarkdown(section.bullets ?? [])}
							citations={citations}
							ownerId={artifact.id}
							activeCitationKey={activeCitationKey}
							onCitationClick={onCitationClick}
							className="text-sm"
						/>
					</div>
				</section>
			))}

			{citations.length > 0 ? (
				<section className="border-t border-border pt-3">
					<h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Sources
					</h4>
					<CitationChips
						citations={citations}
						ownerId={artifact.id}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</section>
			) : null}
		</article>
	);
}
