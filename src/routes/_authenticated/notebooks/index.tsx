import { createFileRoute } from "@tanstack/react-router";

import { NotebooksDashboard } from "#/components/dashboard/NotebooksDashboard.tsx";
import { NotebookCardSkeleton } from "#/components/layout/LoadingSkeleton.tsx";
import { TopNavigation } from "#/components/layout/TopNavigation.tsx";
import { listNotebooks } from "#/features/notebooks/notebooks.functions.ts";

export const Route = createFileRoute("/_authenticated/notebooks/")({
	loader: () => listNotebooks(),
	pendingComponent: NotebooksPending,
	component: NotebooksPage,
});

function NotebooksPending() {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TopNavigation />
			<div className="mx-auto grid w-full max-w-6xl flex-1 gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<NotebookCardSkeleton key={i} />
				))}
			</div>
		</div>
	);
}

function NotebooksPage() {
	const notebooks = Route.useLoaderData();
	return <NotebooksDashboard notebooks={notebooks} />;
}
