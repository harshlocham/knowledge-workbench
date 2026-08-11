import {
	AlertTriangle,
	FileText,
	LoaderCircle,
	RefreshCw,
	Sparkles,
} from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { ResearchBriefView } from "#/components/workspace/studio/ResearchBriefView.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type {
	ArtifactDTO,
	ArtifactSummaryDTO,
} from "#/features/studio/artifacts.types.ts";
import { formatRelativeTime } from "#/lib/format-relative.ts";
import { cn } from "#/lib/utils.ts";

export type ResearchStudioPanelProps = {
	readyCount: number;
	focus: string;
	onFocusChange: (value: string) => void;
	briefs: ArtifactSummaryDTO[];
	activeBrief: ArtifactDTO | null;
	activeBriefId: string | null;
	activeBriefLoading: boolean;
	isCreating: boolean;
	error: string | null;
	onGenerate: () => void;
	onSelectBrief: (artifactId: string) => void;
	activeCitationKey: string | null;
	onCitationClick: (citation: MessageCitation, ownerId: string) => void;
};

function statusLabel(brief: ArtifactSummaryDTO) {
	if (brief.status === "pending") return "Generating…";
	if (brief.status === "failed") return "Failed";
	return `${brief.citationCount} citation${brief.citationCount === 1 ? "" : "s"}`;
}

export function ResearchStudioPanel({
	readyCount,
	focus,
	onFocusChange,
	briefs,
	activeBrief,
	activeBriefId,
	activeBriefLoading,
	isCreating,
	error,
	onGenerate,
	onSelectBrief,
	activeCitationKey,
	onCitationClick,
}: ResearchStudioPanelProps) {
	const disabled = isCreating || readyCount === 0;
	const isGenerating =
		isCreating || activeBrief?.status === "pending" || activeBriefLoading;

	return (
		<div className="flex w-full flex-col gap-4">
			<div className="flex flex-col gap-3">
				<div>
					<h2 className="flex items-center gap-2 font-[Fraunces,serif] text-lg font-semibold text-foreground">
						<Sparkles className="size-4 text-primary" />
						Research Studio
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						Turn every source in this notebook into a cited research brief you
						can jump back into.
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					onClick={onGenerate}
					disabled={disabled}
				>
					{isCreating ? (
						<LoaderCircle className="animate-spin" />
					) : briefs.length > 0 ? (
						<RefreshCw />
					) : (
						<FileText />
					)}
					{briefs.length > 0 ? "New research brief" : "Create research brief"}
				</Button>
			</div>

			<div className="space-y-2">
				<Label htmlFor="brief-focus">Optional focus</Label>
				<Input
					id="brief-focus"
					value={focus}
					onChange={(e) => onFocusChange(e.target.value)}
					placeholder="e.g. production readiness…"
					disabled={isCreating}
				/>
				<p className="text-xs text-muted-foreground">
					{readyCount} ready source{readyCount === 1 ? "" : "s"} will be used as
					evidence.
				</p>
			</div>

			{error ? (
				<p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error}
				</p>
			) : null}

			{readyCount === 0 && briefs.length === 0 ? (
				<EmptyState
					icon={FileText}
					title="No evidence yet"
					description="Add and index at least one source, then create a research brief grounded in it."
				/>
			) : null}

			{briefs.length > 1 ? (
				<div className="flex flex-col gap-1.5">
					{briefs.map((brief) => (
						<button
							key={brief.id}
							type="button"
							onClick={() => onSelectBrief(brief.id)}
							className={cn(
								"rounded-lg border px-3 py-2 text-left transition focus-ring",
								brief.id === activeBriefId
									? "border-primary/40 bg-accent"
									: "border-border hover:bg-muted/60",
							)}
						>
							<span className="block truncate text-sm font-medium text-foreground">
								{brief.title}
							</span>
							<span className="mt-0.5 block text-xs text-muted-foreground">
								{formatRelativeTime(brief.createdAt)} · {statusLabel(brief)}
							</span>
						</button>
					))}
				</div>
			) : null}

			{activeBrief?.status === "failed" ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
					<p className="flex items-center gap-2 text-sm font-medium text-destructive">
						<AlertTriangle className="size-4" />
						Brief generation failed
					</p>
					<p className="mt-1 text-sm text-destructive/90">
						{activeBrief.errorMessage ??
							"Something went wrong while generating this brief."}
					</p>
					<p className="mt-2 text-xs text-destructive/80">
						{readyCount < 2
							? "A brief needs enough indexed evidence to stay honest. Add another source, or a longer one, then try again."
							: "Try a narrower focus, or add sources that cover this topic in more depth."}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={onGenerate}
						disabled={disabled}
					>
						<RefreshCw />
						Try again
					</Button>
				</div>
			) : null}

			{isGenerating && activeBrief?.status !== "failed" ? (
				<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
					<LoaderCircle className="size-4 shrink-0 animate-spin" />
					Reading your sources and assembling a grounded brief…
				</div>
			) : null}

			{activeBrief?.status === "ready" ? (
				<ResearchBriefView
					artifact={activeBrief}
					activeCitationKey={activeCitationKey}
					onCitationClick={onCitationClick}
				/>
			) : null}
		</div>
	);
}
