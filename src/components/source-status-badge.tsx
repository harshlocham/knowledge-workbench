import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { cn } from "#/lib/utils.ts";

const STATUS_LABEL: Record<SourceDTO["status"], string> = {
  uploading: "Uploading",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_CLASS: Record<SourceDTO["status"], string> = {
  uploading:
    "bg-amber-500/15 text-amber-800 ring-amber-500/25 dark:text-amber-200",
  indexing:
    "bg-[color-mix(in_oklab,var(--lagoon)_18%,transparent)] text-[var(--lagoon-deep)] ring-[color-mix(in_oklab,var(--lagoon)_30%,transparent)]",
  ready:
    "bg-[color-mix(in_oklab,var(--palm)_16%,transparent)] text-[var(--palm)] ring-[color-mix(in_oklab,var(--palm)_28%,transparent)]",
  failed: "bg-destructive/10 text-destructive ring-destructive/20",
};

export function SourceStatusBadge({
  status,
  progressLabel,
}: {
  status: SourceDTO["status"];
  progressLabel?: string | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_CLASS[status],
      )}
      title={progressLabel ?? STATUS_LABEL[status]}
    >
      {STATUS_LABEL[status]}
      {progressLabel ? (
        <span className="truncate font-normal opacity-80">{progressLabel}</span>
      ) : null}
    </span>
  );
}
