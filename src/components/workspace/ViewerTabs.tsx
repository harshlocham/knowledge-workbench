import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { LearnTab } from "#/components/workspace/tabs/LearnTab.tsx";
import { MetadataTab } from "#/components/workspace/tabs/MetadataTab.tsx";
import { SourceTab } from "#/components/workspace/tabs/SourceTab.tsx";
import { SummaryTab } from "#/components/workspace/tabs/SummaryTab.tsx";
import type {
  CitationNavItem,
  ViewerSource,
} from "#/components/notebook/source-viewer/types.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import type { NotebookDTO } from "#/features/notebooks/notebooks.functions.ts";
import type { LearningRoadmap } from "#/features/roadmap/roadmap.functions.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";

export type ToolsTab = "source" | "summary" | "learn" | "metadata";

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
  selectedSource,
  youtubeReadyCount,
  roadmapFocus,
  onRoadmapFocusChange,
  roadmap,
  isGeneratingRoadmap,
  roadmapError,
  onGenerateRoadmap,
  onOpenClip,
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
  selectedSource: SourceDTO | null;
  youtubeReadyCount: number;
  roadmapFocus: string;
  onRoadmapFocusChange: (value: string) => void;
  roadmap: LearningRoadmap | null;
  isGeneratingRoadmap: boolean;
  roadmapError: string | null;
  onGenerateRoadmap: () => void;
  onOpenClip: (citation: MessageCitation) => void;
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
          <TabsTrigger value="learn" className="text-xs">
            Learn
          </TabsTrigger>
          <TabsTrigger value="metadata" className="text-xs">
            Metadata
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="source" className="mt-0 min-h-0 flex-1 overflow-hidden">
        <SourceTab
          source={viewer}
          loading={viewerLoading}
          citations={citationNav}
          activeCitationKey={activeCitationKey}
          onNavigateCitation={onNavigateCitation}
          onClose={onCloseViewer}
        />
      </TabsContent>
      <TabsContent value="summary" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        <SummaryTab notebook={notebook} sources={sources} messages={messages} />
      </TabsContent>
      <TabsContent value="learn" className="mt-0 min-h-0 flex-1 overflow-hidden">
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
      <TabsContent value="metadata" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        <MetadataTab source={viewer} sourceMeta={selectedSource} />
      </TabsContent>
    </Tabs>
  );
}
