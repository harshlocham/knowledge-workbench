import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import type { NotebookDTO } from "#/features/notebooks/notebooks.functions.ts";
import { formatRelativeTime, notebookIcon } from "#/lib/format-relative.ts";
import { cn } from "#/lib/utils.ts";

export function NotebookCard({
  notebook,
  onDelete,
  deleting,
}: {
  notebook: NotebookDTO;
  onDelete: (id: string) => void;
  deleting?: boolean;
}) {
  return (
    <article
      className={cn(
        "kw-card group relative flex flex-col p-5 transition-transform hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to="/notebooks/$notebookId"
          params={{ notebookId: notebook.id }}
          className="flex min-w-0 flex-1 gap-3 no-underline focus-ring rounded-md"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-lg"
            aria-hidden
          >
            {notebookIcon(notebook.title)}
          </span>
          <span className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">
              {notebook.title}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Updated {formatRelativeTime(notebook.updatedAt)}
            </p>
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Notebook options for ${notebook.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting}
              onClick={() => onDelete(notebook.id)}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link
        to="/notebooks/$notebookId"
        params={{ notebookId: notebook.id }}
        className="mt-3 flex-1 no-underline focus-ring rounded-md"
      >
        {notebook.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {notebook.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/70 italic">No description</p>
        )}
      </Link>
    </article>
  );
}
