import { useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils.ts";

export function EditableNotebookTitle({
  title,
  onSave,
  className,
}: {
  title: string;
  onSave: (title: string) => Promise<void>;
  className?: string;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(title);
  }, [title]);

  async function commit() {
    const next = value.trim() || "Untitled notebook";
    setValue(next);
    if (next === title) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      setValue(title);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      disabled={saving}
      aria-label="Notebook title"
      title="Click to rename"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inputRef.current?.blur();
        }
        if (e.key === "Escape") {
          setValue(title);
          inputRef.current?.blur();
        }
      }}
      className={cn(
        "min-w-0 max-w-md truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-medium text-foreground outline-none transition",
        "hover:border-border focus:border-primary focus:ring-2 focus:ring-primary/20",
        className,
      )}
    />
  );
}
