import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { TooltipProvider } from "#/components/ui/tooltip.tsx";
import { getAuthSession } from "#/features/notebooks/notebooks.functions.ts";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { userId } = await getAuthSession();

    if (!userId) {
      throw redirect({ to: "/" });
    }

    return { userId };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-dvh flex-col bg-background">
        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
