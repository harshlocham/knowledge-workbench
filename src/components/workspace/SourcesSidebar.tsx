import { useMemo, useState } from "react";
import { FileStack, Plus, Search } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import { PanelHeader } from "#/components/layout/PanelHeader.tsx";
import { AddSourceSheet } from "#/components/workspace/AddSourceSheet.tsx";
import { SourceCard } from "#/components/workspace/SourceCard.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { cn } from "#/lib/utils.ts";

export function SourcesSidebar({
  sources,
  selectedSourceId,
  busySourceId,
  sourceError,
  isAddingSource,
  onOpenSource,
  onReindex,
  onDelete,
  onAddSource,
  addOpen: controlledAddOpen,
  onAddOpenChange,
  className,
}: {
  sources: SourceDTO[];
  selectedSourceId?: string | null;
  busySourceId: string | null;
  sourceError: string | null;
  isAddingSource: boolean;
  onOpenSource: (sourceId: string) => void;
  onReindex: (sourceId: string) => void;
  onDelete: (sourceId: string) => void;
  onAddSource: Parameters<
    typeof import("./AddSourceSheet.tsx").AddSourceSheet
  >[0]["onSubmit"];
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [uncontrolledAddOpen, setUncontrolledAddOpen] = useState(false);
  const addOpen = controlledAddOpen ?? uncontrolledAddOpen;
  const setAddOpen = onAddOpenChange ?? setUncontrolledAddOpen;
  const [dragOver, setDragOver] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.type.toLowerCase().includes(q),
    );
  }, [sources, query]);

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          setAddOpen(true);
        }
      }}
    >
      <PanelHeader
        title="Sources"
        description={`${sources.length} in notebook`}
        actions={
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setAddOpen(true)}
          >
            <Plus />
            Add
          </Button>
        }
      />

      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sources…"
            className="h-8 bg-card pl-8 text-sm"
            aria-label="Search sources"
          />
        </div>
      </div>

      {sourceError ? (
        <p className="px-3 py-2 text-xs text-destructive" role="alert">
          {sourceError}
        </p>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-2",
          dragOver && "bg-accent/50",
        )}
      >
        {sources.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No sources"
            description="Add a PDF, URL, YouTube video, or text to ground your answers."
            action={
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Plus />
                Add source
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No sources match “{query}”.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((source) => (
              <li key={source.id}>
                <SourceCard
                  source={source}
                  selected={selectedSourceId === source.id}
                  busy={busySourceId === source.id}
                  onOpen={() => onOpenSource(source.id)}
                  onReindex={() => onReindex(source.id)}
                  onDelete={() => onDelete(source.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddSourceSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={async (payload) => {
          await onAddSource(payload);
          setAddOpen(false);
        }}
        isAdding={isAddingSource}
        error={sourceError}
      />
    </div>
  );
}
