import type {
	CitationNavItem,
	ViewerSource,
} from "#/components/notebook/source-viewer/types.ts";
import {
	type ToolsTab,
	ViewerTabs,
} from "#/components/workspace/ViewerTabs.tsx";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import type { NotebookDTO } from "#/features/notebooks/notebooks.functions.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { cn } from "#/lib/utils.ts";

export function KnowledgeToolsPanel({
	className,
	...props
}: {
	tab: ToolsTab;
	onTabChange: (tab: ToolsTab) => void;
	notebook: NotebookDTO;
	sources: SourceDTO[];
	messages: ChatMessageDTO[];
	viewer: ViewerSource | null;
	viewerLoading: boolean;
	citationNav: CitationNavItem[];
	activeCitationKey: string | null;
	onNavigateCitation: (citation: CitationNavItem) => void;
	onCloseViewer: () => void;
	sourceExpanded: boolean;
	onToggleSourceExpanded: () => void;
	resumeAt?: number | null;
	resumePlaying?: boolean;
	onPlaybackSync?: (seconds: number, playing: boolean) => void;
	playbackTime?: number;
	playbackPlaying?: boolean;
	onSeekPlayback?: (seconds: number) => void;
	selectedSource: SourceDTO | null;
	className?: string;
}) {
	return (
		<div className={cn("flex h-full min-h-0 flex-col bg-card", className)}>
			<div className="min-h-0 flex-1">
				<ViewerTabs {...props} />
			</div>
		</div>
	);
}
