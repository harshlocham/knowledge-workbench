import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Plus, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
  createNotebook,
  deleteNotebook,
  listNotebooks,
} from "#/features/notebooks/notebooks.functions.ts";

export const Route = createFileRoute("/_authenticated/notebooks/")({
  loader: () => listNotebooks(),
  component: NotebooksPage,
});

function NotebooksPage() {
  const notebooks = Route.useLoaderData();
  const router = useRouter();
  const createNotebookFn = useServerFn(createNotebook);
  const deleteNotebookFn = useServerFn(deleteNotebook);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsCreating(true);

    try {
      const notebook = await createNotebookFn({
        data: {
          title,
          description: description || undefined,
        },
      });
      setTitle("");
      setDescription("");
      await router.invalidate();
      await router.navigate({
        to: "/notebooks/$notebookId",
        params: { notebookId: notebook.id },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create notebook");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this notebook and all of its sources?")) {
      return;
    }

    setDeletingId(id);
    setError(null);

    try {
      await deleteNotebookFn({ data: { id } });
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete notebook");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-8 sm:px-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--kicker)] uppercase">
          Your workspace
        </p>
        <h1 className="mt-1 font-[Fraunces,serif] text-3xl font-semibold tracking-tight text-[var(--sea-ink)]">
          Notebooks
        </h1>
        <p className="mt-2 max-w-xl text-[var(--sea-ink-soft)]">
          Each notebook is an isolated knowledge base for sources and grounded
          Q&amp;A.
        </p>
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm backdrop-blur-sm sm:p-6">
        <h2 className="text-base font-semibold text-[var(--sea-ink)]">
          Create notebook
        </h2>
        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notebook-title">Title</Label>
            <Input
              id="notebook-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. React Server Components notes"
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notebook-description">Description (optional)</Label>
            <Textarea
              id="notebook-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this notebook about?"
              maxLength={2000}
              rows={3}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={isCreating || !title.trim()}>
            <Plus />
            {isCreating ? "Creating…" : "Create notebook"}
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--sea-ink)]">
          All notebooks
        </h2>

        {notebooks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center">
            <BookOpen className="mx-auto size-8 text-[var(--lagoon-deep)] opacity-80" />
            <p className="mt-3 text-[var(--sea-ink-soft)]">
              No notebooks yet. Create one to start collecting sources.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]">
            {notebooks.map((notebook) => (
              <li
                key={notebook.id}
                className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5"
              >
                <Link
                  to="/notebooks/$notebookId"
                  params={{ notebookId: notebook.id }}
                  className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]"
                >
                  <h3 className="truncate font-semibold text-[var(--sea-ink)]">
                    {notebook.title}
                  </h3>
                  {notebook.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--sea-ink-soft)]">
                      {notebook.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-[var(--sea-ink-soft)]">
                    Updated{" "}
                    {new Date(notebook.updatedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${notebook.title}`}
                  disabled={deletingId === notebook.id}
                  onClick={() => handleDelete(notebook.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
