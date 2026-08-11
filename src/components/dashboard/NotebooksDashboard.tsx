import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, LoaderCircle, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useBilling } from "#/components/billing/BillingProvider.tsx";
import { NotebookCard } from "#/components/dashboard/NotebookCard.tsx";
import { EmptyState } from "#/components/layout/EmptyState.tsx";
import { NotebookCardSkeleton } from "#/components/layout/LoadingSkeleton.tsx";
import { TopNavigation } from "#/components/layout/TopNavigation.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	createNotebook,
	deleteNotebook,
	type NotebookDTO,
} from "#/features/notebooks/notebooks.functions.ts";
import { track } from "#/lib/analytics.ts";
import { isLimitOrProError, parseAppError } from "#/lib/errors.ts";

export function NotebooksDashboard({
	notebooks,
	pending,
}: {
	notebooks: NotebookDTO[];
	pending?: boolean;
}) {
	const router = useRouter();
	const billing = useBilling();
	const createNotebookFn = useServerFn(createNotebook);
	const deleteNotebookFn = useServerFn(deleteNotebook);

	const [query, setQuery] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return notebooks;
		return notebooks.filter(
			(n) =>
				n.title.toLowerCase().includes(q) ||
				(n.description?.toLowerCase().includes(q) ?? false),
		);
	}, [notebooks, query]);

	async function handleCreate() {
		if (isCreating) return;
		setError(null);
		setIsCreating(true);
		try {
			const notebook = await createNotebookFn({
				data: { title: "Untitled notebook" },
			});
			track("notebook_created");
			await router.invalidate();
			await router.navigate({
				to: "/notebooks/$notebookId",
				params: { notebookId: notebook.id },
			});
		} catch (err) {
			const parsed = parseAppError(err);
			setError(parsed.message || "Failed to create notebook");
			if (isLimitOrProError(parsed.code)) {
				billing.openUpgrade("general_upgrade");
			}
			setIsCreating(false);
		}
	}

	async function handleDelete(id: string) {
		if (!confirm("Delete this notebook and all of its sources?")) return;
		setDeletingId(id);
		setError(null);
		try {
			await deleteNotebookFn({ data: { id } });
			await router.invalidate();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to delete notebook",
			);
		} finally {
			setDeletingId(null);
		}
	}

	const createButton = (
		<Button
			type="button"
			size="sm"
			onClick={() => void handleCreate()}
			disabled={isCreating}
		>
			{isCreating ? <LoaderCircle className="animate-spin" /> : <Plus />}
			{isCreating ? "Creating…" : "New Notebook"}
		</Button>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TopNavigation
				search={
					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search notebooks…"
							className="h-9 bg-card pl-9"
							aria-label="Search notebooks"
						/>
					</div>
				}
				actions={createButton}
			/>

			<div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
				<div className="mb-8">
					<h1 className="font-[Fraunces,serif] text-3xl font-semibold tracking-tight text-foreground">
						Recent notebooks
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Open a notebook to add sources and ask grounded questions.
					</p>
				</div>

				{error ? (
					<p className="mb-4 text-sm text-destructive" role="alert">
						{error}
					</p>
				) : null}

				{pending ? (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{["s0", "s1", "s2", "s3", "s4", "s5"].map((id) => (
							<NotebookCardSkeleton key={id} />
						))}
					</div>
				) : notebooks.length === 0 ? (
					<EmptyState
						icon={BookOpen}
						title="Start your first research notebook"
						description="Add technical material and turn it into a reusable learning workspace — docs, PDFs, articles, and YouTube courses."
						action={createButton}
						className="rounded-xl border border-dashed border-border bg-card"
					/>
				) : filtered.length === 0 ? (
					<EmptyState
						icon={Search}
						title="No matches"
						description="Try a different search term."
						className="rounded-xl border border-dashed border-border bg-card"
					/>
				) : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{filtered.map((notebook) => (
							<NotebookCard
								key={notebook.id}
								notebook={notebook}
								onDelete={handleDelete}
								deleting={deletingId === notebook.id}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
