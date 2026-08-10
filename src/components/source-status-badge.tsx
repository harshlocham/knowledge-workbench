import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { cn } from "#/lib/utils.ts";

const STATUS_LABEL: Record<SourceDTO["status"], string> = {
	uploading: "Uploading",
	indexing: "Indexing",
	ready: "Ready",
	failed: "Failed",
};

const STATUS_CLASS: Record<SourceDTO["status"], string> = {
	uploading: "bg-amber-500/10 text-amber-800 ring-amber-500/20",
	indexing: "bg-accent text-primary ring-primary/20",
	ready: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/20",
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
				"inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
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
