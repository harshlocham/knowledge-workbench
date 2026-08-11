import {
	Check,
	Copy,
	Download,
	Link2,
	LoaderCircle,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { CitationChips } from "#/components/workspace/CitationChips.tsx";
import { ArtifactSectionsView } from "#/components/workspace/studio/ArtifactSectionsView.tsx";
import { ArtifactShareDialog } from "#/components/workspace/studio/ArtifactShareDialog.tsx";
import { CompareSourcesView } from "#/components/workspace/studio/CompareSourcesView.tsx";
import { LearningRoadmapView } from "#/components/workspace/studio/LearningRoadmapView.tsx";
import { StudyGuideView } from "#/components/workspace/studio/StudyGuideView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	ARTIFACT_TYPE_LABELS,
	type ArtifactDTO,
} from "#/features/studio/artifacts.types.ts";
import {
	artifactMarkdownFilename,
	artifactToMarkdown,
} from "#/lib/artifacts/artifact-markdown.ts";
import { formatRelativeTime } from "#/lib/format-relative.ts";

function downloadMarkdown(filename: string, markdown: string) {
	const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

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
	onArtifactPatch,
}: {
	artifact: ArtifactDTO;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
	onRegenerate: () => void;
	regenerating: boolean;
	canRegenerate: boolean;
	/** Optional: keep list/detail `isShared` in sync after share create/revoke. */
	onArtifactPatch?: (patch: Partial<ArtifactDTO>) => void;
}) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);

	const markdown = artifactToMarkdown({
		title: artifact.title,
		type: artifact.type,
		updatedAt: artifact.updatedAt,
		content: artifact.content,
		citations: artifact.citations,
	});

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(markdown);
			setCopied(true);
			setCopyFailed(false);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopyFailed(true);
			window.setTimeout(() => setCopyFailed(false), 2000);
		}
	}

	function handleDownload() {
		downloadMarkdown(
			artifactMarkdownFilename(artifact.title, artifact.type),
			markdown,
		);
	}

	const exportDisabled = artifact.status !== "ready" || !artifact.content;

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
						{artifact.isShared ? " · Shared" : ""}
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void handleCopy()}
						disabled={exportDisabled}
					>
						{copied ? <Check /> : <Copy />}
						{copyFailed ? "Copy failed" : copied ? "Copied" : "Copy"}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleDownload}
						disabled={exportDisabled}
					>
						<Download />
						Download .md
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setShareOpen(true)}
						disabled={artifact.status !== "ready"}
					>
						<Link2 />
						Share
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
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
				</div>
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
			) : artifact.type === "compare_sources" ? (
				<CompareSourcesView
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

			<ArtifactShareDialog
				artifact={artifact}
				open={shareOpen}
				onOpenChange={setShareOpen}
				onShareChange={(isShared) => onArtifactPatch?.({ isShared })}
			/>
		</article>
	);
}
