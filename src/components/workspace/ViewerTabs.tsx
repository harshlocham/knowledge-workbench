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
import type { ResearchStudioPanelProps } from "#/components/workspace/studio/ResearchStudioPanel.tsx";
import { LearnTab } from "#/components/workspace/tabs/LearnTab.tsx";
import { MetadataTab } from "#/components/workspace/tabs/MetadataTab.tsx";
import { SourceTab } from "#/components/workspace/tabs/SourceTab.tsx";
import { StudioTab } from "#/components/workspace/tabs/StudioTab.tsx";
import { SummaryTab } from "#/components/workspace/tabs/SummaryTab.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import type { NotebookDTO } from "#/features/notebooks/notebooks.functions.ts";
import type { LearningRoadmap } from "#/features/roadmap/roadmap.functions.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";

export type ToolsTab = "source" | "summary" | "studio" | "learn" | "metadata";

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
	youtubeReadyCount,
	roadmapFocus,
	onRoadmapFocusChange,
	roadmap,
	isGeneratingRoadmap,
	roadmapError,
	onGenerateRoadmap,
	onOpenClip,
	studio,
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
	youtubeReadyCount: number;
	roadmapFocus: string;
	onRoadmapFocusChange: (value: string) => void;
	roadmap: LearningRoadmap | null;
	isGeneratingRoadmap: boolean;
	roadmapError: string | null;
	onGenerateRoadmap: () => void;
	onOpenClip: (citation: MessageCitation) => void;
	studio: ResearchStudioPanelProps;
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
					<TabsTrigger value="studio" className="text-xs">
						Studio
					</TabsTrigger>
					<TabsTrigger value="learn" className="text-xs">
						Learn
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
				value="studio"
				className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
			>
				<StudioTab {...studio} />
			</TabsContent>
			<TabsContent
				value="learn"
				className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
			>
				<LearnTab
					youtubeReadyCount={youtubeReadyCount}
					focus={roadmapFocus}
					onFocusChange={onRoadmapFocusChange}
					roadmap={roadmap}
					isGenerating={isGeneratingRoadmap}
					error={roadmapError}
					onGenerate={onGenerateRoadmap}
					onOpenClip={onOpenClip}
				/>
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
