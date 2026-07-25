import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LoaderCircle } from "lucide-react";

import { getSourceFile } from "#/features/sources/sources.functions.ts";

import { HighlightedText } from "./highlighted-text.tsx";
import type { ViewerHighlight, ViewerPage } from "./types.ts";

export function PdfViewer({
  sourceId,
  pages,
  highlight,
  animateKey,
  hasFile,
}: {
  sourceId: string;
  pages: ViewerPage[] | null | undefined;
  highlight: ViewerHighlight | null;
  animateKey?: string;
  hasFile?: boolean;
}) {
  const getSourceFileFn = useServerFn(getSourceFile);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const page = highlight?.locator?.page ?? pages?.[0]?.page ?? 1;

  const pageText = useMemo(() => {
    if (!pages?.length) {
      return highlight?.content ?? "";
    }
    const match = pages.find((item) => item.page === page);
    return match?.text ?? pages.map((item) => item.text).join("\n\n");
  }, [pages, page, highlight?.content]);

  useEffect(() => {
    if (!hasFile) {
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      setLoadingFile(true);
      setFileError(null);
      try {
        const file = await getSourceFileFn({ data: { sourceId } });
        const binary = atob(file.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: file.mimeType });
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setFileUrl(objectUrl);
        }
      } catch (error) {
        if (!cancelled) {
          setFileError(
            error instanceof Error ? error.message : "Failed to load PDF",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingFile(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [getSourceFileFn, hasFile, sourceId]);

  const iframeSrc = fileUrl ? `${fileUrl}#page=${page}` : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink-soft)]">
        Page {page}
        {highlight ? " · cited region highlighted below" : ""}
      </div>

      <div className="min-h-[240px] flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--foam)]">
        {loadingFile ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--sea-ink-soft)]">
            <LoaderCircle className="size-4 animate-spin" />
            Loading PDF…
          </div>
        ) : fileError ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive">
            {fileError}
          </div>
        ) : iframeSrc ? (
          <iframe
            title={`PDF page ${page}`}
            src={iframeSrc}
            className="h-full min-h-[240px] w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--sea-ink-soft)]">
            PDF preview unavailable
          </div>
        )}
      </div>

      <div className="max-h-[40%] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-3">
        <p className="mb-2 text-xs font-medium tracking-wide text-[var(--kicker)] uppercase">
          Cited text
        </p>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--sea-ink)]">
          <HighlightedText
            content={highlight?.content || pageText}
            highlight={
              highlight
                ? {
                    ...highlight,
                    // Page-local offsets may not match joined page text; quote match
                    locator: {
                      ...highlight.locator,
                      startOffset: undefined,
                      endOffset: undefined,
                    },
                  }
                : null
            }
            animateKey={animateKey}
          />
        </pre>
      </div>
    </div>
  );
}
