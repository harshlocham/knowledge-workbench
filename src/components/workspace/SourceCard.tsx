import {
	FileText,
	Film,
	Link2,
	MoreHorizontal,
	RefreshCw,
	Trash2,
	Type,
	Youtube,
} from "lucide-react";

import { SourceStatusBadge } from "#/components/source-status-badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";
import { cn } from "#/lib/utils.ts";

const TYPE_ICON = {
	pdf: FileText,
	text: Type,
	url: Link2,
	youtube: Youtube,
	vtt: Film,
} as const;

function isPendingStatus(status: SourceDTO["status"]) {
	return status === "uploading" || status === "indexing";
}

export function SourceCard({
	source,
	selected,
	busy,
	onOpen,
	onReindex,
	onDelete,
}: {
	source: SourceDTO;
	selected?: boolean;
	busy?: boolean;
	onOpen: () => void;
	onReindex: () => void;
	onDelete: () => void;
}) {
	const Icon = TYPE_ICON[source.type] ?? FileText;
	const pending = isPendingStatus(source.status);

	return (
		<div
			className={cn(
				"group rounded-lg border border-transparent px-2 py-2 transition-colors",
				selected ? "border-primary/30 bg-accent" : "hover:bg-muted/70",
			)}
		>
			<div className="flex items-start gap-2">
				<button
					type="button"
					onClick={onOpen}
					className="flex min-w-0 flex-1 gap-2 rounded-md text-left focus-ring"
				>
					<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
						<Icon className="size-3.5" />
					</span>
					<span className="min-w-0 flex-1">
						<span className="flex items-start justify-between gap-2">
							<span className="truncate text-sm font-medium text-foreground">
								{source.title}
							</span>
							<SourceStatusBadge
								status={source.status}
								progressLabel={
									pending && source.indexProgress
										? `${source.indexProgress.percent}%`
										: null
								}
							/>
						</span>
						<span className="mt-0.5 block truncate text-xs text-muted-foreground">
							{source.type}
							{source.pageCount != null ? ` · ${source.pageCount} pages` : ""}
							{source.chunkCount != null
								? ` · ${source.chunkCount} chunks`
								: ""}
						</span>
						{pending && source.indexProgress?.message ? (
							<span className="mt-1 block line-clamp-2 text-xs text-primary">
								{source.indexProgress.message}
							</span>
						) : null}
						{source.status === "failed" && source.errorMessage ? (
							<span
								className="mt-1 block line-clamp-2 text-xs text-destructive"
								role="alert"
							>
								{source.errorMessage}
							</span>
						) : null}
					</span>
				</button>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Options for ${source.title}`}
							className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
						>
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
						<DropdownMenuItem disabled={busy || pending} onClick={onReindex}>
							<RefreshCw />
							Re-index for better answers
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							disabled={busy}
							onClick={onDelete}
						>
							<Trash2 />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
