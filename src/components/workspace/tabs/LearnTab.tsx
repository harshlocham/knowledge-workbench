import { LearningRoadmapPanel } from "#/components/notebook/learning-roadmap-panel.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type { LearningRoadmap } from "#/features/roadmap/roadmap.functions.ts";

export function LearnTab({
  youtubeReadyCount,
  focus,
  onFocusChange,
  roadmap,
  isGenerating,
  error,
  onGenerate,
  onOpenClip,
}: {
  youtubeReadyCount: number;
  focus: string;
  onFocusChange: (value: string) => void;
  roadmap: LearningRoadmap | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
  onOpenClip: (citation: MessageCitation) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <LearningRoadmapPanel
        youtubeReadyCount={youtubeReadyCount}
        focus={focus}
        onFocusChange={onFocusChange}
        roadmap={roadmap}
        isGenerating={isGenerating}
        error={error}
        onGenerate={onGenerate}
        onOpenClip={onOpenClip}
      />
    </div>
  );
}
