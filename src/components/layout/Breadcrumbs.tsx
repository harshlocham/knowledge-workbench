import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { cn } from "#/lib/utils.ts";

export type BreadcrumbItem = {
  label: string;
  to?: string;
  params?: Record<string, string>;
};

export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              ) : null}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  params={item.params}
                  className="truncate text-muted-foreground no-underline transition-colors hover:text-foreground focus-ring rounded-sm"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    "truncate",
                    isLast
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
