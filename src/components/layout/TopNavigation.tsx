import { Link } from "@tanstack/react-router";

import HeaderUser from "#/integrations/clerk/header-user.tsx";
import { cn } from "#/lib/utils.ts";

export function TopNavigation({
  search,
  actions,
  className,
  compact,
}: {
  search?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-[var(--header-bg)] backdrop-blur-md",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center gap-3 px-4 sm:px-6",
          compact ? "h-12 max-w-none" : "h-14 max-w-6xl",
        )}
      >
        <Link
          to="/notebooks"
          className="shrink-0 font-[Fraunces,serif] text-lg font-semibold tracking-tight text-foreground no-underline focus-ring rounded-sm"
        >
          Knowledge Workbench
        </Link>

        {search ? (
          <div className="mx-auto hidden min-w-0 max-w-md flex-1 md:block">
            {search}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <HeaderUser />
        </div>
      </div>
      {search ? (
        <div className="border-t border-border px-4 py-2 md:hidden">{search}</div>
      ) : null}
    </header>
  );
}
