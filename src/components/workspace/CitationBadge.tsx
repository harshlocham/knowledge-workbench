import { cn } from "#/lib/utils.ts";

export function CitationBadge({
  number,
  title,
  active,
  onClick,
}: {
  number: number;
  title?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? "Open citation"}
      className={cn(
        "mx-0.5 inline-flex -translate-y-px items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold transition focus-ring",
        active
          ? "bg-accent text-primary ring-2 ring-primary"
          : "bg-accent/70 text-primary ring-1 ring-primary/20 hover:bg-accent",
      )}
    >
      {number}
    </button>
  );
}
