import type {
	CitationNavItem,
	ViewerSource,
} from "#/components/notebook/source-viewer/types.ts";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/ui/tabs.tsx";
import { MetadataTab } from "#/components/workspace/tabs/MetadataTab.tsx";
import { SourceTab } from "#/components/workspace/tabs/SourceTab.tsx";
import { SummaryTab } from "#/components/workspace/tabs/SummaryTab.tsx";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import type { NotebookDTO } from "#/features/notebooks/notebooks.functions.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";

export type ToolsTab = "source" | "summary" | "metadata";

export function ViewerTabs({
	tab,
	onTabChange,
	notebook,
	sources,
	messages,
	viewer,
	viewerLoading,
	citationNav,
	activeCitationKey,
	onNavigateCitation,
	onCloseViewer,
	sourceExpanded,
	onToggleSourceExpanded,
	resumeAt,
	resumePlaying,
	onPlaybackSync,
	playbackTime,
	playbackPlaying,
	onSeekPlayback,
	selectedSource,
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
}) {
	return (
		<Tabs
			value={tab}
			onValueChange={(value) => onTabChange(value as ToolsTab)}
			className="flex h-full min-h-0 flex-col"
		>
			<div className="border-b border-border px-3 pt-2">
				<TabsList className="h-9 w-full justify-start bg-transparent p-0">
					<TabsTrigger value="source" className="text-xs">
						Source
					</TabsTrigger>
					<TabsTrigger value="summary" className="text-xs">
						Summary
					</TabsTrigger>
					<TabsTrigger value="metadata" className="text-xs">
						Metadata
					</TabsTrigger>
				</TabsList>
			</div>

			<TabsContent
				value="source"
				className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
			>
				<SourceTab
					source={viewer}
					loading={viewerLoading}
					citations={citationNav}
					activeCitationKey={activeCitationKey}
					onNavigateCitation={onNavigateCitation}
					onClose={onCloseViewer}
					expanded={sourceExpanded}
					onToggleExpanded={onToggleSourceExpanded}
					resumeAt={resumeAt}
					resumePlaying={resumePlaying}
					onPlaybackSync={onPlaybackSync}
					playbackTime={playbackTime}
					playbackPlaying={playbackPlaying}
					onSeekPlayback={onSeekPlayback}
				/>
			</TabsContent>
			<TabsContent
				value="summary"
				className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
			>
				<SummaryTab notebook={notebook} sources={sources} messages={messages} />
			</TabsContent>
			<TabsContent
				value="metadata"
				className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
			>
				<MetadataTab source={viewer} sourceMeta={selectedSource} />
			</TabsContent>
		</Tabs>
	);
}
