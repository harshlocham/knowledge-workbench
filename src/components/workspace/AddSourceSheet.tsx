import { useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { formatBytes, INGEST_LIMITS } from "#/lib/ingest/limits.ts";
import { cn } from "#/lib/utils.ts";

export type AddSourceMode = "text" | "pdf" | "url" | "vtt" | "youtube";

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
  const [mode, setMode] = useState<AddSourceMode>("pdf");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [vttFile, setVttFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const modes: AddSourceMode[] = ["pdf", "text", "url", "vtt", "youtube"];

  function reset() {
    setTitle("");
    setContent("");
    setUrl("");
    setYoutubeUrl("");
    setPdfFile(null);
    setVttFile(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await onSubmit({
      mode,
      title,
      content,
      url,
      youtubeUrl,
      pdfFile,
      vttFile,
    });
    reset();
  }

  function onDropFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      setMode("pdf");
      setPdfFile(file);
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, ""));
      return;
    }
    if (
      file.name.toLowerCase().endsWith(".vtt") ||
      file.type === "text/vtt" ||
      file.type === "text/plain"
    ) {
      setMode("vtt");
      setVttFile(file);
      if (!title.trim()) setTitle(file.name.replace(/\.vtt$/i, ""));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add source</SheetTitle>
          <SheetDescription>
            Upload a file or paste content. Indexing continues in the background.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 px-4 pb-6">
          <div className="flex flex-wrap gap-1">
            {modes.map((item) => (
              <Button
                key={item}
                type="button"
                size="xs"
                variant={mode === item ? "default" : "outline"}
                onClick={() => setMode(item)}
              >
                {item}
              </Button>
            ))}
          </div>

          <div
            className={cn(
              "rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
              dragOver ? "border-primary bg-accent" : "border-border bg-muted/40",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onDropFiles(e.dataTransfer.files);
            }}
          >
            <Upload className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Drop a PDF or VTT here, or choose a type below
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-source-title">Title</Label>
            <Input
              id="add-source-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Optional for URL / YouTube"
            />
          </div>

          {mode === "text" ? (
            <div className="space-y-2">
              <Label htmlFor="add-source-content">Content</Label>
              <Textarea
                id="add-source-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                required
                maxLength={INGEST_LIMITS.maxTextChars}
              />
            </div>
          ) : null}

          {mode === "pdf" ? (
            <div className="space-y-2">
              <Label htmlFor="add-source-pdf">PDF (max {formatBytes(INGEST_LIMITS.maxPdfBytes)})</Label>
              <Input
                id="add-source-pdf"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
              {pdfFile ? (
                <p className="text-xs text-muted-foreground">{pdfFile.name}</p>
              ) : null}
            </div>
          ) : null}

          {mode === "url" ? (
            <div className="space-y-2">
              <Label htmlFor="add-source-url">URL</Label>
              <Input
                id="add-source-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                required
              />
            </div>
          ) : null}

          {mode === "vtt" ? (
            <div className="space-y-2">
              <Label htmlFor="add-source-vtt">VTT (max {formatBytes(INGEST_LIMITS.maxVttBytes)})</Label>
              <Input
                id="add-source-vtt"
                type="file"
                accept=".vtt,text/vtt,text/plain"
                onChange={(e) => setVttFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : null}

          {mode === "youtube" ? (
            <div className="space-y-2">
              <Label htmlFor="add-source-yt">YouTube URL</Label>
              <Input
                id="add-source-yt"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                required
              />
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={isAdding}>
            {isAdding ? "Adding…" : "Add source"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
