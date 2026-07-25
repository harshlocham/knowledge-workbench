import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LoaderCircle } from "lucide-react";
import { getSourceFile } from "#/features/sources/sources.functions.ts";

import { HighlightedText } from "./highlighted-text.tsx";
import {
  buildTextLayerModel,
  findCitationRanges,
  rangesToRects,
} from "./pdf-text-highlight.ts";
import type { ViewerHighlight, ViewerPage } from "./types.ts";

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs() {
  pdfJsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, workerMod]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
    return pdfjs;
  });
  return pdfJsPromise;
}

type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [loadingFile, setLoadingFile] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  const page = highlight?.locator?.page ?? pages?.[0]?.page ?? 1;
  const pageText =
    pages?.find((item) => item.page === page)?.text ??
    highlight?.content ??
    "";

  useEffect(() => {
    if (!hasFile) return;

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
        if (!cancelled) {
          setPdfData(bytes);
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
    };
  }, [getSourceFileFn, hasFile, sourceId]);

  useEffect(() => {
    if (!pdfData) return;

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let loadingTask: { destroy: () => Promise<unknown> } | null = null;

    async function renderPage() {
      setRendering(true);
      setFileError(null);

      try {
        const pdfjs = await loadPdfJs();
        if (cancelled) return;

        // Copy buffer — pdf.js may transfer/detach the underlying ArrayBuffer
        loadingTask = pdfjs.getDocument({ data: pdfData!.slice() });
        const doc = await loadingTask.promise;
        const pageNumber = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(pageNumber);

        const containerWidth =
          containerRef.current?.clientWidth || pdfPage.view[2] || 600;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(containerWidth / unscaled.width, 2.5);
        const viewport = pdfPage.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas unavailable");
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
          canvas,
        });
        await renderTask.promise;

        if (cancelled) return;

        setPageSize({ width: viewport.width, height: viewport.height });

        const textContent = await pdfPage.getTextContent();
        const rawItems = textContent.items.filter(
          (
            item,
          ): item is (typeof textContent.items)[number] & {
            str: string;
            transform: number[];
            width: number;
            height: number;
          } => "str" in item,
        );

        const model = buildTextLayerModel(rawItems, viewport);
        const ranges = findCitationRanges({
          haystack: model.haystack,
          quote: highlight?.content ?? "",
        });
        const rects = rangesToRects(model.items, ranges);

        if (!cancelled) {
          setHighlightRects(rects);
        }

        await doc.cleanup();
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Failed to render PDF";
          // Cancellation during citation switches is expected
          if (!/cancel/i.test(message)) {
            setFileError(message);
          }
          setHighlightRects([]);
        }
      } finally {
        if (!cancelled) {
          setRendering(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [pdfData, page, highlight?.content, animateKey]);

  useEffect(() => {
    if (highlightRects.length === 0) return;
    const first = containerRef.current?.querySelector(
      "[data-pdf-highlight]",
    ) as HTMLElement | null;
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightRects, animateKey]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink-soft)]">
        Page {page}
        {highlight
          ? highlightRects.length > 0
            ? " · citation highlighted in PDF"
            : " · jump to page · see cited text below"
          : ""}
      </div>

      <div
        ref={containerRef}
        className="relative min-h-[280px] flex-1 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--foam)]"
      >
        {loadingFile || rendering ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[color-mix(in_oklab,var(--foam)_80%,transparent)] text-sm text-[var(--sea-ink-soft)]">
            <LoaderCircle className="size-4 animate-spin" />
            {loadingFile ? "Loading PDF…" : "Rendering page…"}
          </div>
        ) : null}

        {fileError ? (
          <div className="flex h-full min-h-[240px] items-center justify-center px-4 text-center text-sm text-destructive">
            {fileError}
          </div>
        ) : (
          <div
            className="relative mx-auto"
            style={{
              width: pageSize.width || "100%",
              height: pageSize.height || undefined,
            }}
          >
            <canvas ref={canvasRef} className="block max-w-full" />
            {highlightRects.map((rect, index) => (
              <div
                key={`${animateKey ?? "h"}-${index}-${rect.left}-${rect.top}`}
                data-pdf-highlight
                className="citation-highlight-pulse pointer-events-none absolute rounded-sm bg-[color-mix(in_oklab,var(--lagoon)_42%,transparent)] mix-blend-multiply ring-1 ring-[color-mix(in_oklab,var(--lagoon)_55%,transparent)]"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[32%] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-3">
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
                    locator: {
                      ...highlight.locator,
                      startOffset: 0,
                      endOffset: (highlight.content || pageText).length,
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
