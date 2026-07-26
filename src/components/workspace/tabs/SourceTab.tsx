import { FileSearch } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import {
	type CitationNavItem,
	SourceViewerPanel,
	type ViewerSource,
} from "#/components/notebook/source-viewer-panel.tsx";

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
