import { cn } from "#/lib/utils.ts";

export function LoadingSkeleton({ className }: { className?: string }) {
	return (
		<div
			className={cn("animate-pulse rounded-md bg-muted", className)}
			aria-hidden
		/>
	);
}

export function NotebookCardSkeleton() {
	return (
		<div className="kw-card space-y-3 p-5">
			<LoadingSkeleton className="size-9 rounded-lg" />
			<LoadingSkeleton className="h-5 w-2/3" />
			<LoadingSkeleton className="h-4 w-full" />
			<LoadingSkeleton className="h-3 w-1/3" />
		</div>
	);
}

export function SourceListSkeleton() {
	return (
		<div className="space-y-2 p-3">
			{Array.from({ length: 4 }).map((_, i) => (
				<div key={i} className="space-y-2 rounded-lg border border-border p-3">
					<LoadingSkeleton className="h-4 w-3/4" />
					<LoadingSkeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	);
}

export function ChatSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
			<LoadingSkeleton className="ml-auto h-16 w-[70%] rounded-2xl" />
			<LoadingSkeleton className="h-24 w-[85%] rounded-2xl" />
			<LoadingSkeleton className="ml-auto h-12 w-[55%] rounded-2xl" />
		</div>
	);
}
