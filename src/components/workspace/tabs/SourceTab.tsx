import { FileSearch } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import {
  SourceViewerPanel,
  type CitationNavItem,
  type ViewerSource,
} from "#/components/notebook/source-viewer-panel.tsx";

export function SourceTab({
  source,
  loading,
  citations,
  activeCitationKey,
  onNavigateCitation,
  onClose,
}: {
  source: ViewerSource | null;
  loading: boolean;
  citations: CitationNavItem[];
  activeCitationKey: string | null;
  onNavigateCitation: (citation: CitationNavItem) => void;
  onClose: () => void;
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SourceViewerPanel
        source={source}
        loading={loading}
        citations={citations}
        activeCitationKey={activeCitationKey}
        onNavigateCitation={onNavigateCitation}
        onClose={onClose}
      />
    </div>
  );
}
