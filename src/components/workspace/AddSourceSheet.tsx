import { useRef, useState } from "react";
import {
  ClipboardPaste,
  FileUp,
  Globe,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
  classifyFile,
  detectSourceInput,
  isYoutubeUrl,
} from "#/lib/detect-source.ts";
import { formatBytes, INGEST_LIMITS } from "#/lib/ingest/limits.ts";
import { cn } from "#/lib/utils.ts";

export type AddSourceMode = "text" | "pdf" | "url" | "vtt" | "youtube";

type EntryMode = "auto" | "link" | "text" | "file";

export function AddSourceSheet({
  open,
  onOpenChange,
  onSubmit,
  isAdding,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    mode: AddSourceMode;
    title: string;
    content: string;
    url: string;
    youtubeUrl: string;
    pdfFile: File | null;
    vttFile: File | null;
  }) => Promise<void>;
  isAdding: boolean;
  error: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [entry, setEntry] = useState<EntryMode>("auto");
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function reset() {
    setEntry("auto");
    setPaste("");
    setFile(null);
    setLocalError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function acceptFile(next: File | null) {
    if (!next) return;
    const kind = classifyFile(next);
    if (!kind) {
      setLocalError("Only PDF and VTT files are supported right now.");
      return;
    }
    if (kind === "pdf" && next.size > INGEST_LIMITS.maxPdfBytes) {
      setLocalError(
        `PDF must be ${formatBytes(INGEST_LIMITS.maxPdfBytes)} or smaller`,
      );
      return;
    }
    if (kind === "vtt" && next.size > INGEST_LIMITS.maxVttBytes) {
      setLocalError(
        `VTT must be ${formatBytes(INGEST_LIMITS.maxVttBytes)} or smaller`,
      );
      return;
    }
    setLocalError(null);
    setFile(next);
    setPaste("");
    setEntry("file");
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setLocalError(null);

    const detected = detectSourceInput({
      text: file ? undefined : paste,
      file,
    });

    if (!detected) {
      setLocalError(
        entry === "link"
          ? "Paste a website or YouTube URL."
          : entry === "text"
            ? "Paste some text to add as a source."
            : "Drop a file, paste a link, or paste text to continue.",
      );
      return;
    }

    try {
      if (detected.kind === "pdf") {
        await onSubmit({
          mode: "pdf",
          title: detected.file.name.replace(/\.pdf$/i, ""),
          content: "",
          url: "",
          youtubeUrl: "",
          pdfFile: detected.file,
          vttFile: null,
        });
      } else if (detected.kind === "vtt") {
        await onSubmit({
          mode: "vtt",
          title: detected.file.name.replace(/\.vtt$/i, ""),
          content: "",
          url: "",
          youtubeUrl: "",
          pdfFile: null,
          vttFile: detected.file,
        });
      } else if (detected.kind === "youtube") {
        await onSubmit({
          mode: "youtube",
          title: "",
          content: "",
          url: "",
          youtubeUrl: detected.url,
          pdfFile: null,
          vttFile: null,
        });
      } else if (detected.kind === "url") {
        await onSubmit({
          mode: "url",
          title: "",
          content: "",
          url: detected.url,
          youtubeUrl: "",
          pdfFile: null,
          vttFile: null,
        });
      } else {
        await onSubmit({
          mode: "text",
          title: "Text source",
          content: detected.content,
          url: "",
          youtubeUrl: "",
          pdfFile: null,
          vttFile: null,
        });
      }
      reset();
    } catch {
      // Parent surfaces error via `error` prop
    }
  }

  const detectionHint = (() => {
    if (file) {
      const kind = classifyFile(file);
      return kind === "pdf"
        ? `Ready to add PDF · ${file.name}`
        : kind === "vtt"
          ? `Ready to add transcript · ${file.name}`
          : null;
    }
    const trimmed = paste.trim();
    if (!trimmed) return null;
    if (isYoutubeUrl(trimmed)) return "Detected YouTube video";
    const detected = detectSourceInput({ text: trimmed });
    if (detected?.kind === "url") return "Detected website URL";
    if (detected?.kind === "text") {
      return `Detected text · ${trimmed.length.toLocaleString()} characters`;
    }
    return null;
  })();

  const placeholder =
    entry === "link"
      ? "Paste a website or YouTube URL…"
      : entry === "text"
        ? "Paste or type source text…"
        : "Paste a link, YouTube URL, or text…";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="left" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-4 text-left">
          <SheetTitle>Add sources</SheetTitle>
          <SheetDescription>
            Drop files or paste a link — we’ll figure out the type for you.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
        >
          <Textarea
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setFile(null);
              if (entry === "file") setEntry("auto");
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text && isYoutubeUrl(text.trim())) {
                setEntry("link");
              }
            }}
            placeholder={placeholder}
            rows={entry === "text" ? 10 : 3}
            className="min-h-[88px] resize-none bg-muted/30"
            disabled={isAdding || Boolean(file)}
            maxLength={INGEST_LIMITS.maxTextChars}
          />

          {detectionHint ? (
            <p className="text-xs font-medium text-primary">{detectionHint}</p>
          ) : null}

          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-10 text-center transition-colors",
              dragOver
                ? "border-primary bg-accent"
                : "border-border bg-muted/30",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              acceptFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border">
              <Upload className="size-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              or drop your files
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF and VTT · max {formatBytes(INGEST_LIMITS.maxPdfBytes)}
            </p>

            {file ? (
              <div className="mt-4 flex max-w-full items-center gap-2 rounded-full bg-background px-3 py-1.5 text-xs ring-1 ring-border">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Remove file"
                  onClick={() => {
                    setFile(null);
                    setEntry("auto");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant={entry === "file" ? "default" : "outline"}
              className="h-auto flex-col gap-1 py-3"
              disabled={isAdding}
              onClick={() => {
                setEntry("file");
                fileInputRef.current?.click();
              }}
            >
              <FileUp className="size-4" />
              <span className="text-xs">Upload</span>
            </Button>
            <Button
              type="button"
              variant={entry === "link" ? "default" : "outline"}
              className="h-auto flex-col gap-1 py-3"
              disabled={isAdding}
              onClick={() => {
                setFile(null);
                setEntry("link");
              }}
            >
              <Globe className="size-4" />
              <span className="text-xs">Website</span>
            </Button>
            <Button
              type="button"
              variant={entry === "text" ? "default" : "outline"}
              className="h-auto flex-col gap-1 py-3"
              disabled={isAdding}
              onClick={() => {
                setFile(null);
                setEntry("text");
              }}
            >
              <ClipboardPaste className="size-4" />
              <span className="text-xs">Text</span>
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf,.vtt,text/vtt"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
          />

          {localError || error ? (
            <p className="text-sm text-destructive" role="alert">
              {localError || error}
            </p>
          ) : null}

          <Button
            type="submit"
            className="mt-auto"
            disabled={isAdding || (!paste.trim() && !file)}
          >
            {isAdding ? (
              <>
                <LoaderCircle className="animate-spin" />
                Adding…
              </>
            ) : (
              "Add source"
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
