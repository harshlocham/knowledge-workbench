import { FileSearch, Minimize2 } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import { HighlightedText } from "#/components/notebook/source-viewer/highlighted-text.tsx";
import {
  type CitationNavItem,
  SourceViewerPanel,
  type ViewerSource,
} from "#/components/notebook/source-viewer-panel.tsx";
import { Button } from "#/components/ui/button.tsx";

export function SourceTab({
	source,
	loading,
	citations,
	activeCitationKey,
	onNavigateCitation,
	onClose,
	expanded,
	onToggleExpanded,
	resumeAt,
	resumePlaying,
	onPlaybackSync,
	playbackTime,
	playbackPlaying,
	onSeekPlayback,
}: {
	source: ViewerSource | null;
	loading: boolean;
	citations: CitationNavItem[];
	activeCitationKey: string | null;
	onNavigateCitation: (citation: CitationNavItem) => void;
	onClose: () => void;
	expanded: boolean;
	onToggleExpanded: () => void;
	resumeAt?: number | null;
	resumePlaying?: boolean;
	onPlaybackSync?: (seconds: number, playing: boolean) => void;
	playbackTime?: number;
	playbackPlaying?: boolean;
	onSeekPlayback?: (seconds: number) => void;
}) {
	if (!source && !loading) {
		return (
			<EmptyState
				icon={FileSearch}
				title="No source open"
				description="Select a source or click a citation to inspect the original passage."
				className="h-full"
			/>
		);
	}

	const timedSource = source?.type === "youtube" || source?.type === "vtt";

	// Non-video focus: PDF/page in main workspace; cited text stays here.
	if (expanded && source && !timedSource) {
		const quote = source.highlight?.content?.trim();
		const animateKey = `${source.id}:${source.highlight?.chunkId ?? ""}:${activeCitationKey ?? ""}`;
		return (
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-foreground">
							{source.title}
						</p>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Open in main workspace
						</p>
						{activeCitationKey && citations.length > 0 ? (
							<p className="mt-1 text-xs text-primary">
								Active citation{" "}
								{Math.max(
									citations.findIndex((c) => c.key === activeCitationKey),
									0,
								) + 1}{" "}
								of {citations.length}
							</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						{citations.length > 1 ? (
							<>
								<Button
									type="button"
									size="xs"
									variant="ghost"
									aria-label="Previous citation"
									onClick={() => {
										const index = citations.findIndex(
											(c) => c.key === activeCitationKey,
										);
										const prev =
											citations[
												(index - 1 + citations.length) % citations.length
											];
										if (prev) onNavigateCitation(prev);
									}}
								>
									Prev
								</Button>
								<Button
									type="button"
									size="xs"
									variant="ghost"
									aria-label="Next citation"
									onClick={() => {
										const index = citations.findIndex(
											(c) => c.key === activeCitationKey,
										);
										const next = citations[(index + 1) % citations.length];
										if (next) onNavigateCitation(next);
									}}
								>
									Next
								</Button>
							</>
						) : null}
						<Button
							type="button"
							variant="outline"
							size="xs"
							onClick={onToggleExpanded}
						>
							<Minimize2 />
							Dock
						</Button>
					</div>
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
					<p className="text-sm text-muted-foreground">
						The {source.type.toUpperCase()} is shown across the left and center.
						Cited text stays here.
					</p>
					{quote ? (
						<div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/40 px-3 py-3">
							<p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
								Cited text
							</p>
							<pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
								<HighlightedText
									content={quote}
									highlight={
										source.highlight
											? {
													...source.highlight,
													locator: {
														...source.highlight.locator,
														startOffset: 0,
														endOffset: quote.length,
													},
												}
											: null
									}
									animateKey={animateKey}
								/>
							</pre>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No cited passage for this view.
						</p>
					)}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						onClick={onToggleExpanded}
					>
						<Minimize2 />
						Dock to panel
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<SourceViewerPanel
				source={source}
				loading={loading}
				citations={citations}
				activeCitationKey={activeCitationKey}
				onNavigateCitation={onNavigateCitation}
				onClose={onClose}
				expanded={expanded}
				onToggleExpanded={onToggleExpanded}
				resumeAt={resumeAt}
				resumePlaying={resumePlaying}
				onPlaybackSync={onPlaybackSync}
				transcriptOnly={expanded && timedSource}
				playbackTime={playbackTime}
				playbackPlaying={playbackPlaying}
				onSeekPlayback={onSeekPlayback}
			/>
		</div>
	);
}
