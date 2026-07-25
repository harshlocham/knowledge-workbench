import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

export function ResizablePanel({
  side,
  width,
  minWidth = 220,
  maxWidth = 480,
  collapsed,
  onWidthChange,
  onCollapsedChange,
  children,
  className,
  label,
}: {
  side: "left" | "right";
  width: number;
  minWidth?: number;
  maxWidth?: number;
  collapsed: boolean;
  onWidthChange: (width: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragging.current) return;
      const next =
        side === "left" ? event.clientX : window.innerWidth - event.clientX;
      onWidthChange(Math.min(maxWidth, Math.max(minWidth, next)));
    },
    [maxWidth, minWidth, onWidthChange, side],
  );

  const stopDrag = useCallback(() => {
    dragging.current = false;
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };
  }, [onPointerMove, stopDrag]);

  if (collapsed) {
    return (
      <div
        className={cn(
          "hidden w-10 shrink-0 flex-col items-center border-border bg-[var(--workspace-sidebar)] py-3 lg:flex",
          side === "left" ? "border-r" : "border-l",
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Expand ${label}`}
          onClick={() => onCollapsedChange(false)}
        >
          <PanelLeftOpen
            className={side === "right" ? "rotate-180" : undefined}
          />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative hidden min-h-0 shrink-0 flex-col bg-[var(--workspace-sidebar)] lg:flex",
        side === "left" ? "border-r border-border" : "border-l border-border",
        className,
      )}
      style={{ width }}
    >
      {/* In-flow toolbar so collapse never overlays panel headers / actions */}
      <div
        className={cn(
          "flex h-9 shrink-0 items-center border-b border-border px-2",
          side === "left" ? "justify-end" : "justify-start",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Collapse ${label}`}
          onClick={() => onCollapsedChange(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelLeftClose
            className={side === "right" ? "rotate-180" : undefined}
          />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        tabIndex={0}
        className={cn(
          "absolute top-0 z-20 h-full w-1 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/30",
          side === "left" ? "right-0" : "left-0",
          isDragging && "bg-primary/30",
        )}
        onPointerDown={(event) => {
          event.preventDefault();
          dragging.current = true;
          setIsDragging(true);
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 24 : 12;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onWidthChange(
              side === "left"
                ? Math.max(minWidth, width - step)
                : Math.min(maxWidth, width + step),
            );
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onWidthChange(
              side === "left"
                ? Math.min(maxWidth, width + step)
                : Math.max(minWidth, width - step),
            );
          }
        }}
      />
    </div>
  );
}
