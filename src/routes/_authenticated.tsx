import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppHeader } from "#/components/app-header.tsx";
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
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
