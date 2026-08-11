import { MarkdownWithCitations } from "#/components/workspace/MarkdownWithCitations.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ArtifactDTO } from "#/features/studio/artifacts.types.ts";

/** Body and bullets are one markdown block so `[n]` markers become badges. */
function sectionToMarkdown(body: string | undefined, bullets: string[]) {
	const list = bullets.map((bullet) => `- ${bullet}`).join("\n");
	return [body, list].filter(Boolean).join("\n\n");
}

/**
 * Renders whatever sections an artifact actually carries. Section plans are
 * generated per notebook (a single-source brief has no agreement sections, for
 * example), so nothing here may assume a particular heading exists.
 */
export function ArtifactSectionsView({
	artifact,
	activeCitationKey,
	onCitationClick,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
}) {
	const sections = artifact.content?.sections ?? [];

	return (
		<div className="flex flex-col gap-5">
			{sections.map((section) => (
				<section key={section.heading}>
					<h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{section.heading}
					</h4>
					<div className="mt-2">
						<MarkdownWithCitations
							content={sectionToMarkdown(section.body, section.bullets ?? [])}
							citations={artifact.citations}
							ownerId={artifact.id}
							activeCitationKey={activeCitationKey}
							onCitationClick={onCitationClick}
							className="text-sm"
						/>
					</div>
				</section>
			))}
		</div>
	);
}
