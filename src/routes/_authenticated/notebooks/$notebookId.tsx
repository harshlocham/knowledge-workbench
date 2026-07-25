import { createFileRoute } from "@tanstack/react-router";

import { ChatSkeleton } from "#/components/layout/LoadingSkeleton.tsx";
import { TopNavigation } from "#/components/layout/TopNavigation.tsx";
import { NotebookWorkspace } from "#/components/workspace/NotebookWorkspace.tsx";
import { listMessages } from "#/features/chat/chat.functions.ts";
import { getNotebook } from "#/features/notebooks/notebooks.functions.ts";
import { listSources } from "#/features/sources/sources.functions.ts";

export const Route = createFileRoute("/_authenticated/notebooks/$notebookId")({
  loader: async ({ params }) => {
    const [notebook, sources, messages] = await Promise.all([
      getNotebook({ data: { id: params.notebookId } }),
      listSources({ data: { notebookId: params.notebookId } }),
      listMessages({ data: { notebookId: params.notebookId } }),
    ]);

    return { notebook, sources, messages };
  },
  pendingComponent: WorkspacePending,
  component: NotebookWorkspacePage,
});

function WorkspacePending() {
  return (
    <div className="flex h-dvh flex-col">
      <TopNavigation compact />
      <ChatSkeleton />
    </div>
  );
}

function NotebookWorkspacePage() {
  const { notebook, sources, messages } = Route.useLoaderData();
  return (
    <NotebookWorkspace
      notebook={notebook}
      initialSources={sources}
      initialMessages={messages}
    />
  );
}
