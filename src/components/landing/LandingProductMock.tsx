/**
 * Static product composition for the hero — not live account data.
 */
export function LandingProductMock() {
	return (
		<figure className="w-full">
			<div
				className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]"
				aria-hidden
			>
				<div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2">
					<span className="size-2 rounded-full bg-border" />
					<span className="size-2 rounded-full bg-border" />
					<span className="size-2 rounded-full bg-border" />
					<span className="ml-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
						Example workspace
					</span>
				</div>

				<div className="grid gap-0 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
					{/* Sources column */}
					<div className="border-b border-border p-4 md:border-r md:border-b-0">
						<p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
							Sources
						</p>
						<ul className="mt-3 flex flex-col gap-2 text-sm">
							<li className="rounded-md border border-border bg-background px-2.5 py-2">
								<span className="text-xs text-primary">PDF</span>
								<p className="font-medium text-foreground">
									Kubernetes handbook
								</p>
							</li>
							<li className="rounded-md border border-border bg-background px-2.5 py-2">
								<span className="text-xs text-primary">URL</span>
								<p className="font-medium text-foreground">Official docs</p>
							</li>
							<li className="rounded-md border border-border bg-background px-2.5 py-2">
								<span className="text-xs text-primary">YouTube</span>
								<p className="font-medium text-foreground">Cluster deep dive</p>
							</li>
						</ul>
					</div>

					{/* Studio + citation */}
					<div className="flex flex-col gap-4 p-4">
						<div>
							<p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
								Research Studio · Learning Roadmap
							</p>
							<h3 className="mt-1 font-[Fraunces,serif] text-lg font-semibold text-foreground">
								From clusters to production
							</h3>
							<ol className="mt-3 space-y-2 text-sm text-foreground/90">
								<li className="flex gap-2">
									<span className="text-primary">1.</span>
									<span>Understand control plane basics [1]</span>
								</li>
								<li className="flex gap-2">
									<span className="text-primary">2.</span>
									<span>Practice workloads and networking [2]</span>
								</li>
								<li className="flex gap-2">
									<span className="text-primary">3.</span>
									<span>Ship with observability in place [3]</span>
								</li>
							</ol>
						</div>

						<div className="border-t border-border pt-3">
							<p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
								Citation
							</p>
							<div className="mt-2 flex flex-wrap gap-1.5">
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80">
									<span className="text-primary">[1]</span> Official docs —
									Controllers
								</span>
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80">
									<span className="text-primary">[2]</span> Cluster deep dive ·
									12:40
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>
			<figcaption className="mt-2 text-center text-xs text-muted-foreground">
				Example workspace layout — illustrative, not live account data
			</figcaption>
		</figure>
	);
}
