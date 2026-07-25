import { Link, createFileRoute } from "@tanstack/react-router";
import { Show, SignInButton } from "@clerk/tanstack-react-start";

import { AppHeader } from "#/components/app-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { getAuthSession } from "#/features/notebooks/notebooks.functions.ts";

export const Route = createFileRoute("/")({
  loader: () => getAuthSession(),
  component: HomePage,
});

function HomePage() {
  const { userId } = Route.useLoaderData();

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-medium tracking-wide text-[var(--kicker)] uppercase">
            Research assistant
          </p>
          <h1 className="mt-2 font-[Fraunces,serif] text-4xl font-semibold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
            Knowledge Workbench
          </h1>
          <p className="mt-4 text-lg text-[var(--sea-ink-soft)]">
            Upload sources into notebooks, ask grounded questions, and inspect
            citations back to the original material.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Show when="signed-in">
              <Button asChild>
                <Link to="/notebooks">Open notebooks</Link>
              </Button>
            </Show>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <Button type="button">Sign in to continue</Button>
              </SignInButton>
            </Show>
            {userId ? (
              <span className="text-sm text-[var(--sea-ink-soft)]">
                Signed in
              </span>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
