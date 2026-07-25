import { BookOpen } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import type { ChatMessageDTO } from "#/features/chat/chat.functions.ts";
import type { NotebookDTO } from "#/features/notebooks/notebooks.functions.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";

export function SummaryTab({
  notebook,
  sources,
  messages,
}: {
  notebook: NotebookDTO;
  sources: SourceDTO[];
  messages: ChatMessageDTO[];
}) {
  const ready = sources.filter((s) => s.status === "ready").length;
  const byType = sources.reduce<Record<string, number>>((acc, source) => {
    acc[source.type] = (acc[source.type] ?? 0) + 1;
    return acc;
  }, {});

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Nothing to summarize yet"
        description="Add sources to see a notebook overview here."
        className="h-full"
      />
    );
  }

  return (
    <div className="space-y-5 p-4">
      <div>
        <h3 className="font-[Fraunces,serif] text-lg font-semibold text-foreground">
          {notebook.title}
        </h3>
        {notebook.description ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {notebook.description}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground italic">
            No description
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Sources</dt>
          <dd className="text-lg font-semibold text-foreground">
            {sources.length}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Ready</dt>
          <dd className="text-lg font-semibold text-foreground">{ready}</dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Messages</dt>
          <dd className="text-lg font-semibold text-foreground">
            {messages.length}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">Types</dt>
          <dd className="text-sm font-medium text-foreground">
            {Object.entries(byType)
              .map(([type, count]) => `${count} ${type}`)
              .join(" · ")}
          </dd>
        </div>
      </dl>

      <div>
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Sources
        </h4>
        <ul className="mt-2 space-y-1.5">
          {sources.slice(0, 8).map((source) => (
            <li
              key={source.id}
              className="truncate text-sm text-foreground"
            >
              <span className="text-muted-foreground">{source.type}</span>
              {" · "}
              {source.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
