import { Button } from "#/components/ui/button.tsx";

/**
 * Lightweight first-run guidance. Hidden once the notebook has enough ready
 * material — no persistence / backend.
 */
export function FirstNotebookGuide({
	sourceCount,
	readyCount,
	onAddSources,
	onOpenStudio,
}: {
	sourceCount: number;
	readyCount: number;
	onAddSources: () => void;
	onOpenStudio: () => void;
}) {
	if (sourceCount >= 2 && readyCount >= 1) {
		return null;
	}

	return (
		<div className="rounded-xl border border-dashed border-border bg-card px-4 py-4 sm:px-5">
			<h3 className="font-[Fraunces,serif] text-base font-semibold text-foreground">
				Build your first knowledge base
			</h3>
			<ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
				<li>
					<span className="font-medium text-foreground">1.</span> Add 2–3
					sources (docs URL, YouTube, PDF, or text).
				</li>
				<li>
					<span className="font-medium text-foreground">2.</span> Wait until
					they show as ready.
				</li>
				<li>
					<span className="font-medium text-foreground">3.</span> Ask your first
					question or open Research Studio.
				</li>
				<li>
					<span className="font-medium text-foreground">4.</span> Generate a
					Study Guide or Learning Roadmap.
				</li>
			</ol>
			<div className="mt-4 flex flex-wrap gap-2">
				<Button type="button" size="sm" onClick={onAddSources}>
					Add sources
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={onOpenStudio}
				>
					Open Research Studio
				</Button>
			</div>
		</div>
	);
}
