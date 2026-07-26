import {
	ChevronDown,
	ChevronUp,
	ExternalLink,
	LoaderCircle,
	Maximize2,
	Minimize2,
	X,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

import { formatViewerTime } from "./format.ts";
import { PdfViewer } from "./pdf-viewer.tsx";
import { TextViewer } from "./text-viewer.tsx";
import { TranscriptCueList } from "./transcript-cue-list.tsx";
import { TranscriptViewer } from "./transcript-viewer.tsx";
import type { CitationNavItem, ViewerSource } from "./types.ts";
import { WebsiteViewer } from "./website-viewer.tsx";

function locationLabel(source: ViewerSource) {
	const locator = source.highlight?.locator;
	if (!locator) {
		return source.type;
	}

	const parts = [source.type];
	if (locator.page != null) {
		parts.push(`page ${locator.page}`);
	}
	if (locator.heading) {
		parts.push(locator.heading);
	}
	if (locator.tStart != null && locator.tEnd != null) {
		parts.push(
			`${formatViewerTime(locator.tStart)} → ${formatViewerTime(locator.tEnd)}`,
		);
	}
	return parts.join(" · ");
}

export function SourceViewer({
	source,
	loading,
	onClose,
	citations = [],
	activeCitationKey = null,
	onNavigateCitation,
	expanded = false,
	onToggleExpanded,
	resumeAt = null,
	resumePlaying = false,
	onPlaybackSync,
	/** Focus mode: transcript stays in the side panel while video lives in the center. */
	transcriptOnly = false,
	playbackTime = 0,
	playbackPlaying = false,
	onSeekPlayback,
}: {
	source: ViewerSource | null;
	loading: boolean;
	onClose: () => void;
	citations?: CitationNavItem[];
	activeCitationKey?: string | null;
	onNavigateCitation?: (citation: CitationNavItem) => void;
	expanded?: boolean;
	onToggleExpanded?: () => void;
	resumeAt?: number | null;
	resumePlaying?: boolean;
	onPlaybackSync?: (seconds: number, playing: boolean) => void;
	transcriptOnly?: boolean;
	playbackTime?: number;
	playbackPlaying?: boolean;
	onSeekPlayback?: (seconds: number) => void;
}) {
	const activeIndex = citations.findIndex(
		(citation) => citation.key === activeCitationKey,
	);
	const hasNav = citations.length > 1 && !!onNavigateCitation;

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}

			if (hasNav && (event.key === "ArrowDown" || event.key === "j")) {
				event.preventDefault();
				const next =
					citations[(activeIndex + 1 + citations.length) % citations.length];
				if (next) {
					onNavigateCitation?.(next);
				}
				return;
			}

			if (hasNav && (event.key === "ArrowUp" || event.key === "k")) {
				event.preventDefault();
				const prev =
					citations[(activeIndex - 1 + citations.length) % citations.length];
				if (prev) {
					onNavigateCitation?.(prev);
				}
				return;
			}

			if (event.key === "Escape") {
				if (expanded && onToggleExpanded) {
					event.preventDefault();
					onToggleExpanded();
					return;
				}
				if (hasNav) {
					onClose();
				}
			}
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		activeIndex,
		citations,
		expanded,
		hasNav,
		onClose,
		onNavigateCitation,
		onToggleExpanded,
	]);

	if (!source && !loading) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
				<p className="text-sm font-medium text-foreground">Source viewer</p>
				<p className="text-sm text-muted-foreground">
					Select a citation or source to inspect the exact referenced location.
				</p>
			</div>
		);
	}

	const openUrl = source?.originalUrl ?? source?.highlight?.locator?.url;
	const animateKey = `${source?.id ?? ""}:${source?.highlight?.chunkId ?? ""}:${activeCitationKey ?? ""}`;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				className={cn(
					"flex items-start justify-between gap-3 border-b border-border",
					expanded ? "px-5 py-4" : "px-4 py-3",
				)}
			>
				<div className="min-w-0">
					<p
						className={cn(
							"truncate font-semibold text-foreground",
							expanded ? "text-base" : "text-sm",
						)}
					>
						{loading ? "Opening source…" : source?.title}
					</p>
					{source ? (
						<p className="mt-0.5 truncate text-xs tracking-wide text-muted-foreground uppercase">
							{locationLabel(source)}
						</p>
					) : null}
					{activeCitationKey && citations.length > 0 ? (
						<p className="mt-1 text-xs text-primary">
							Active citation {Math.max(activeIndex, 0) + 1} of{" "}
							{citations.length}
							{hasNav ? " · ↑↓ or J/K to navigate" : ""}
						</p>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-1">
					{hasNav ? (
						<>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								aria-label="Previous citation"
								onClick={() => {
									const prev =
										citations[
											(activeIndex - 1 + citations.length) % citations.length
										];
									if (prev) {
										onNavigateCitation?.(prev);
									}
								}}
							>
								<ChevronUp />
							</Button>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								aria-label="Next citation"
								onClick={() => {
									const next = citations[(activeIndex + 1) % citations.length];
									if (next) {
										onNavigateCitation?.(next);
									}
								}}
							>
								<ChevronDown />
							</Button>
						</>
					) : null}
					{onToggleExpanded ? (
						<Button
							type="button"
							variant="outline"
							size="xs"
							aria-label={
								expanded
									? "Return video to the source panel"
									: "Open video in the main workspace"
							}
							onClick={onToggleExpanded}
						>
							{expanded ? <Minimize2 /> : <Maximize2 />}
							{expanded ? "Dock" : "Focus"}
						</Button>
					) : null}
					{openUrl ? (
						<Button asChild variant="outline" size="xs">
							<a href={openUrl} target="_blank" rel="noreferrer">
								<ExternalLink />
								Open
							</a>
						</Button>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Close source viewer"
						onClick={onClose}
					>
						<X />
					</Button>
				</div>
			</div>

			<div
				className={cn(
					"min-h-0 flex-1",
					transcriptOnly
						? "overflow-hidden px-3 py-3"
						: "overflow-y-auto px-4 py-4",
				)}
			>
				{loading || !source ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
						<LoaderCircle className="size-5 animate-spin text-primary" />
						Opening cited source…
					</div>
				) : transcriptOnly &&
					(source.type === "youtube" || source.type === "vtt") ? (
					<TranscriptCueList
						cues={source.cues}
						highlight={source.highlight}
						currentTime={playbackTime}
						isPlaying={playbackPlaying}
						animateKey={animateKey}
						onSeek={(seconds) => onSeekPlayback?.(seconds)}
						largerText
					/>
				) : source.type === "pdf" ? (
					<PdfViewer
						sourceId={source.id}
						pages={source.pages}
						highlight={source.highlight}
						animateKey={animateKey}
						hasFile={source.hasFile}
					/>
				) : source.type === "url" ? (
					<WebsiteViewer
						content={source.content}
						highlight={source.highlight}
						originalUrl={source.originalUrl}
						animateKey={animateKey}
					/>
				) : source.type === "vtt" || source.type === "youtube" ? (
					<TranscriptViewer
						cues={source.cues}
						highlight={source.highlight}
						videoId={source.videoId}
						animateKey={animateKey}
						resumeAt={resumeAt}
						resumePlaying={resumePlaying}
						onPlaybackSync={onPlaybackSync}
					/>
				) : (
					<TextViewer
						content={source.content}
						highlight={source.highlight}
						animateKey={animateKey}
					/>
				)}
			</div>
		</div>
	);
}
