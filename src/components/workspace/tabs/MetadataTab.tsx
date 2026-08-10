import { Info } from "lucide-react";

import { EmptyState } from "#/components/layout/EmptyState.tsx";
import type { ViewerSource } from "#/components/notebook/source-viewer/types.ts";
import type { SourceDTO } from "#/features/sources/sources.functions.ts";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[7rem_1fr] gap-2 border-b border-border py-2 text-sm last:border-0">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0 break-words text-foreground">{value ?? "—"}</dd>
		</div>
	);
}

export function MetadataTab({
	source,
	sourceMeta,
}: {
	source: ViewerSource | null;
	sourceMeta?: SourceDTO | null;
}) {
	if (!source && !sourceMeta) {
		return (
			<EmptyState
				icon={Info}
				title="No citation selected"
				description="Open a source or citation to inspect chunk and locator metadata."
				className="h-full"
			/>
		);
	}

	const locator = source?.highlight?.locator;
	const status = sourceMeta?.status ?? source?.status;

	return (
		<div className="p-4">
			<h3 className="text-sm font-semibold text-foreground">
				{source?.title ?? sourceMeta?.title ?? "Source"}
			</h3>
			<dl className="mt-3">
				<Row label="Type" value={source?.type ?? sourceMeta?.type} />
				<Row label="Status" value={status} />
				<Row label="Source ID" value={source?.id ?? sourceMeta?.id} />
				<Row label="Chunk ID" value={source?.highlight?.chunkId} />
				<Row label="Page" value={locator?.page} />
				<Row
					label="Offsets"
					value={
						locator?.startOffset != null && locator?.endOffset != null
							? `${locator.startOffset}–${locator.endOffset}`
							: null
					}
				/>
				<Row
					label="Timestamp"
					value={
						locator?.tStart != null
							? `${locator.tStart.toFixed(1)}s${
									locator.tEnd != null ? ` – ${locator.tEnd.toFixed(1)}s` : ""
								}`
							: null
					}
				/>
				<Row label="Video ID" value={locator?.videoId ?? source?.videoId} />
				<Row label="URL" value={locator?.url ?? source?.originalUrl} />
				<Row label="Heading" value={locator?.heading} />
				<Row label="Chunks" value={sourceMeta?.chunkCount} />
				<Row label="Pages" value={sourceMeta?.pageCount ?? source?.pageCount} />
				<Row label="Chars" value={sourceMeta?.charCount} />
			</dl>
		</div>
	);
}
