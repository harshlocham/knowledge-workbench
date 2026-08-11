import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { CitationChips } from "#/components/workspace/CitationChips.tsx";
import { ArtifactSectionsView } from "#/components/workspace/studio/ArtifactSectionsView.tsx";
import { LearningRoadmapView } from "#/components/workspace/studio/LearningRoadmapView.tsx";
import { StudyGuideView } from "#/components/workspace/studio/StudyGuideView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	ARTIFACT_TYPE_LABELS,
	type ArtifactDTO,
} from "#/features/studio/artifacts.types.ts";
import { formatRelativeTime } from "#/lib/format-relative.ts";

/**
 * Shared document chrome for every artifact type. The body is delegated: study
 * guides render their typed payload, everything else renders its sections.
 */
export function ArtifactDocument({
	artifact,
	activeCitationKey,
	onCitationClick,
	onRegenerate,
	regenerating,
	canRegenerate,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
	onRegenerate: () => void;
	regenerating: boolean;
	canRegenerate: boolean;
}) {
	return (
		<article className="flex flex-col gap-5">
			<header className="flex items-start justify-between gap-3 border-b border-border pb-4">
				<div className="min-w-0">
					<p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
						{ARTIFACT_TYPE_LABELS[artifact.type]}
					</p>
					<h3 className="mt-1 font-[Fraunces,serif] text-xl font-semibold text-foreground">
						{artifact.title}
					</h3>
					<p
						className="mt-1 text-xs text-muted-foreground"
						title={new Date(artifact.updatedAt).toLocaleString()}
					>
						Generated {formatRelativeTime(artifact.updatedAt)} ·{" "}
						{artifact.citations.length} citation
						{artifact.citations.length === 1 ? "" : "s"}
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="shrink-0"
					onClick={onRegenerate}
					disabled={regenerating || !canRegenerate}
				>
					{regenerating ? (
						<LoaderCircle className="animate-spin" />
					) : (
						<RefreshCw />
					)}
					Regenerate
				</Button>
			</header>

			{artifact.type === "study_guide" ? (
				<StudyGuideView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={onCitationClick}
				/>
			) : artifact.type === "learning_roadmap" ? (
				<LearningRoadmapView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={onCitationClick}
				/>
			) : (
				<ArtifactSectionsView
					artifact={artifact}
					activeCitationKey={activeCitationKey}
					onCitationClick={onCitationClick}
				/>
			)}

			{artifact.citations.length > 0 ? (
				<section className="border-t border-border pt-4">
					<h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Sources
					</h4>
					<CitationChips
						citations={artifact.citations}
						ownerId={artifact.id}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
					/>
				</section>
			) : null}
		</article>
	);
}
