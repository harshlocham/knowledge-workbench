import { Link } from "@tanstack/react-router";

import HeaderUser from "#/integrations/clerk/header-user.tsx";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          to="/"
          className="font-[Fraunces,serif] text-lg font-semibold tracking-tight text-[var(--sea-ink)]"
        >
          Knowledge Workbench
        </Link>
        <div className="flex items-center gap-3">
          <Link
            to="/notebooks"
            className="text-sm font-medium text-[var(--sea-ink-soft)] transition-colors hover:text-[var(--sea-ink)]"
          >
            Notebooks
          </Link>
          <HeaderUser />
        </div>
      </div>
    </header>
  );
}
