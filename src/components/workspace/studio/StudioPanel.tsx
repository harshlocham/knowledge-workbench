import { AlertTriangle, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";

import { useBillingOptional } from "#/components/billing/BillingProvider.tsx";
import { EmptyState } from "#/components/layout/EmptyState.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { ArtifactDocument } from "#/components/workspace/studio/ArtifactDocument.tsx";
import {
	ArtifactTypeCards,
	type StudioArtifactType,
} from "#/components/workspace/studio/ArtifactTypeCards.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	ARTIFACT_TYPE_LABELS,
	type ArtifactDTO,
	type ArtifactSummaryDTO,
	type ArtifactType,
} from "#/features/studio/artifacts.types.ts";
import { formatRelativeTime } from "#/lib/format-relative.ts";
import { cn } from "#/lib/utils.ts";

const GENERATABLE_TYPES = new Set<ArtifactType>([
	"research_brief",
	"study_guide",
	"learning_roadmap",
	"compare_sources",
]);

function isGeneratable(type: ArtifactType): type is StudioArtifactType {
	return GENERATABLE_TYPES.has(type);
}

function statusLabel(artifact: ArtifactSummaryDTO) {
	if (artifact.status === "pending") return "Generating…";
	if (artifact.status === "failed") return "Failed";
	return `${artifact.citationCount} citation${
		artifact.citationCount === 1 ? "" : "s"
	}`;
}

export type StudioPanelProps = {
	readyCount: number;
	focus: string;
	onFocusChange: (value: string) => void;
	artifacts: ArtifactSummaryDTO[];
	activeArtifact: ArtifactDTO | null;
	activeArtifactId: string | null;
	activeArtifactLoading: boolean;
	/** Set while a create request is in flight, before the row exists. */
	generatingType: StudioArtifactType | null;
	error: string | null;
	onGenerate: (type: StudioArtifactType) => void;
	onSelectArtifact: (artifactId: string) => void;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
	onArtifactPatch?: (patch: Partial<ArtifactDTO>) => void;
};

export function StudioPanel({
	readyCount,
	focus,
	onFocusChange,
	artifacts,
	activeArtifact,
	activeArtifactId,
	activeArtifactLoading,
	generatingType,
	error,
	onGenerate,
	onSelectArtifact,
	activeCitationKey,
	onCitationClick,
	onArtifactPatch,
}: StudioPanelProps) {
	const billing = useBillingOptional();
	const studioUsage = billing?.summary?.studio;
	const noEvidence = readyCount === 0;
	const pendingTypes = new Set(
		artifacts.filter((row) => row.status === "pending").map((row) => row.type),
	);
	const activeType = activeArtifact?.type;
	const canRegenerate =
		!noEvidence &&
		generatingType === null &&
		activeType != null &&
		isGeneratable(activeType) &&
		!pendingTypes.has(activeType);

	function regenerate() {
		if (activeType && isGeneratable(activeType)) {
			onGenerate(activeType);
		}
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
				<header>
					<h2 className="flex items-center gap-2 font-[Fraunces,serif] text-xl font-semibold text-foreground">
						<Sparkles className="size-4 text-primary" aria-hidden />
						Research Studio
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Turn your sources into useful knowledge.
					</p>
					{studioUsage ? (
						<p className="mt-2 text-xs text-muted-foreground">
							Studio generations · {studioUsage.used} / {studioUsage.limit} this
							month
						</p>
					) : null}
				</header>

				<div className="space-y-2">
					<Label htmlFor="studio-focus">What do you want to focus on?</Label>
					<Input
						id="studio-focus"
						value={focus}
						onChange={(event) => onFocusChange(event.target.value)}
						placeholder="Optional — e.g. production readiness…"
						disabled={generatingType !== null}
					/>
					<p className="text-xs text-muted-foreground">
						{readyCount} ready source{readyCount === 1 ? "" : "s"} will be used
						as evidence.
					</p>
				</div>

				<ArtifactTypeCards
					generatingType={generatingType}
					pendingTypes={pendingTypes}
					disabled={noEvidence || generatingType !== null}
					onGenerate={onGenerate}
				/>

				{error ? (
					<p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
						{error}
					</p>
				) : null}

				{noEvidence && artifacts.length === 0 ? (
					<EmptyState
						icon={Sparkles}
						title="No evidence yet"
						description="Add and index at least one source, then generate an artifact grounded in it."
					/>
				) : null}

				{artifacts.length > 0 ? (
					<section>
						<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							Your artifacts
						</h3>
						<div className="flex flex-col gap-1.5">
							{artifacts.map((artifact) => (
								<button
									key={artifact.id}
									type="button"
									onClick={() => onSelectArtifact(artifact.id)}
									className={cn(
										"rounded-lg border px-3 py-2 text-left transition focus-ring",
										artifact.id === activeArtifactId
											? "border-primary/40 bg-accent"
											: "border-border hover:bg-muted/60",
									)}
								>
									<span className="block truncate text-sm font-medium text-foreground">
										{artifact.title}
									</span>
									<span className="mt-0.5 block text-xs text-muted-foreground">
										{ARTIFACT_TYPE_LABELS[artifact.type]} ·{" "}
										{formatRelativeTime(artifact.createdAt)} ·{" "}
										{statusLabel(artifact)}
									</span>
								</button>
							))}
						</div>
					</section>
				) : null}

				{activeArtifact?.status === "failed" ? (
					<div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
						<p className="flex items-center gap-2 text-sm font-medium text-destructive">
							<AlertTriangle className="size-4" aria-hidden />
							{ARTIFACT_TYPE_LABELS[activeArtifact.type]} generation failed
						</p>
						<p className="mt-1 text-sm text-destructive/90">
							{activeArtifact.errorMessage ??
								"Something went wrong while generating this artifact."}
						</p>
						<p className="mt-2 text-xs text-destructive/80">
							{readyCount < 2
								? "Grounded artifacts need enough indexed evidence to stay honest. Add another source, or a longer one, then try again."
								: "Try a narrower focus, or add sources that cover this topic in more depth."}
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={regenerate}
							disabled={!canRegenerate}
						>
							<RefreshCw />
							Try again
						</Button>
					</div>
				) : null}

				{activeArtifactLoading || activeArtifact?.status === "pending" ? (
					<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
						<LoaderCircle
							className="size-4 shrink-0 animate-spin"
							aria-hidden
						/>
						Analyzing your notebook and assembling a grounded document…
					</div>
				) : null}

				{activeArtifact?.status === "ready" ? (
					<ArtifactDocument
						artifact={activeArtifact}
						activeCitationKey={activeCitationKey}
						onCitationClick={onCitationClick}
						onRegenerate={regenerate}
						regenerating={
							generatingType !== null ||
							(activeType != null && pendingTypes.has(activeType))
						}
						canRegenerate={canRegenerate}
						onArtifactPatch={onArtifactPatch}
					/>
				) : null}
			</div>
		</div>
	);
}
