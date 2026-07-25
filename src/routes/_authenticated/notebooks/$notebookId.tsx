import { useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  FileText,
  LoaderCircle,
  Map,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";

import { LearningRoadmapPanel } from "#/components/notebook/learning-roadmap-panel.tsx";
import {
  SourceViewerPanel,
  type CitationNavItem,
  type ViewerSource,
} from "#/components/notebook/source-viewer-panel.tsx";
import { SourceStatusBadge } from "#/components/source-status-badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
  askNotebook,
  getSourceViewer,
  listMessages,
  type ChatMessageDTO,
} from "#/features/chat/chat.functions.ts";
import { getNotebook } from "#/features/notebooks/notebooks.functions.ts";
import {
  buildLearningRoadmap,
  type LearningRoadmap,
} from "#/features/roadmap/roadmap.functions.ts";
import {
  createPdfSource,
  createTextSource,
  createUrlSource,
  createVttSource,
  createYoutubeSource,
  deleteSource,
  listSources,
  reindexSource,
  type SourceDTO,
} from "#/features/sources/sources.functions.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
  formatBytes,
  friendlyIngestError,
  INGEST_LIMITS,
} from "#/lib/ingest/limits.ts";

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const Route = createFileRoute("/_authenticated/notebooks/$notebookId")({
  loader: async ({ params }) => {
    const [notebook, sources, messages] = await Promise.all([
      getNotebook({ data: { id: params.notebookId } }),
      listSources({ data: { notebookId: params.notebookId } }),
      listMessages({ data: { notebookId: params.notebookId } }),
    ]);

    return { notebook, sources, messages };
  },
  component: NotebookWorkspacePage,
});

function isPendingStatus(status: SourceDTO["status"]) {
  return status === "uploading" || status === "indexing";
}

function citationKey(messageId: string, citation: MessageCitation) {
  return `${messageId}:${citation.chunkId}:${citation.citationNumber ?? ""}`;
}

function renderAnswerWithCitations(
  content: string,
  citations: MessageCitation[],
  messageId: string,
  activeCitationKey: string | null,
  onCitationClick: (citation: MessageCitation, messageId: string) => void,
) {
  const parts = content.split(/(\[\d+\])/g);

  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    const citationNumber = Number(match[1]);
    const citation =
      citations.find((item) => item.citationNumber === citationNumber) ??
      citations[citationNumber - 1];

    if (!citation) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    const key = citationKey(messageId, citation);
    const isActive = activeCitationKey === key;

    return (
      <button
        key={`${part}-${index}`}
        type="button"
        onClick={() => onCitationClick(citation, messageId)}
        className={
          isActive
            ? "mx-0.5 inline-flex -translate-y-px items-center rounded-full bg-[color-mix(in_oklab,var(--lagoon)_32%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--lagoon-deep)] ring-2 ring-[var(--lagoon)] transition"
            : "mx-0.5 inline-flex -translate-y-px items-center rounded-full bg-[color-mix(in_oklab,var(--lagoon)_18%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--lagoon-deep)] ring-1 ring-[color-mix(in_oklab,var(--lagoon)_30%,transparent)] transition hover:bg-[color-mix(in_oklab,var(--lagoon)_28%,transparent)]"
        }
        title={citation.sourceTitle ?? "Open source"}
      >
        {citationNumber}
      </button>
    );
  });
}

function NotebookWorkspacePage() {
  const { notebook, sources: initialSources, messages: initialMessages } =
    Route.useLoaderData();
  const router = useRouter();

  const createTextSourceFn = useServerFn(createTextSource);
  const createPdfSourceFn = useServerFn(createPdfSource);
  const createUrlSourceFn = useServerFn(createUrlSource);
  const createVttSourceFn = useServerFn(createVttSource);
  const createYoutubeSourceFn = useServerFn(createYoutubeSource);
  const deleteSourceFn = useServerFn(deleteSource);
  const reindexSourceFn = useServerFn(reindexSource);
  const listSourcesFn = useServerFn(listSources);
  const askNotebookFn = useServerFn(askNotebook);
  const getSourceViewerFn = useServerFn(getSourceViewer);
  const buildLearningRoadmapFn = useServerFn(buildLearningRoadmap);

  const [sources, setSources] = useState(initialSources);
  const [messages, setMessages] = useState(initialMessages);
  const [centerMode, setCenterMode] = useState<"chat" | "roadmap">("chat");
  const [roadmap, setRoadmap] = useState<LearningRoadmap | null>(null);
  const [roadmapFocus, setRoadmapFocus] = useState("");
  const [isGeneratingRoadmap, setIsGeneratingRoadmap] = useState(false);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<
    "text" | "pdf" | "url" | "vtt" | "youtube"
  >("text");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [vttFile, setVttFile] = useState<File | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [citationNav, setCitationNav] = useState<CitationNavItem[]>([]);
  const [activeCitationKey, setActiveCitationKey] = useState<string | null>(
    null,
  );

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

  const hasPendingSources = useMemo(
    () => sources.some((source) => isPendingStatus(source.status)),
    [sources],
  );

  useEffect(() => {
    if (!hasPendingSources) {
      return;
    }

    const streamUrl = `/api/notebooks/${notebook.id}/source-events`;
    const events = new EventSource(streamUrl);
    let fallbackTimer: number | undefined;

    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          sources?: SourceDTO[];
        };
        if (payload.type === "sources" && Array.isArray(payload.sources)) {
          setSources(payload.sources);
        }
        if (payload.type === "done") {
          events.close();
          void router.invalidate();
        }
      } catch {
        // ignore malformed frames
      }
    };

    events.onerror = () => {
      events.close();
      // Fallback polling if the stream drops
      fallbackTimer = window.setInterval(() => {
        void listSourcesFn({ data: { notebookId: notebook.id } })
          .then(setSources)
          .catch(() => undefined);
      }, 2000);
    };

    return () => {
      events.close();
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    };
  }, [hasPendingSources, notebook.id, listSourcesFn, router]);

  const readyCount = useMemo(
    () => sources.filter((source) => source.status === "ready").length,
    [sources],
  );

  const youtubeReadyCount = useMemo(
    () =>
      sources.filter(
        (source) => source.type === "youtube" && source.status === "ready",
      ).length,
    [sources],
  );

  async function loadViewer(options: {
    sourceId: string;
    chunkId?: string;
  }) {
    setViewerOpen(true);
    setViewerLoading(true);

    try {
      const data = await getSourceViewerFn({
        data: {
          sourceId: options.sourceId,
          chunkId: options.chunkId,
        },
      });
      setViewer(data);
    } catch {
      setViewer(null);
    } finally {
      setViewerLoading(false);
    }
  }

  async function openCitation(
    citation: MessageCitation,
    messageId: string,
  ) {
    const message = messages.find((item) => item.id === messageId);
    const nav = (message?.citations ?? [citation]).map((item) => ({
      ...item,
      key: citationKey(messageId, item),
    }));
    const key = citationKey(messageId, citation);

    setCitationNav(nav);
    setActiveCitationKey(key);
    await loadViewer({
      sourceId: citation.sourceId,
      chunkId: citation.chunkId,
    });
  }

  async function navigateCitation(citation: CitationNavItem) {
    setActiveCitationKey(citation.key);
    await loadViewer({
      sourceId: citation.sourceId,
      chunkId: citation.chunkId,
    });
  }

  async function openSource(sourceId: string) {
    setCitationNav([]);
    setActiveCitationKey(null);
    await loadViewer({ sourceId });
  }

  async function openRoadmapClip(citation: MessageCitation) {
    const key = citationKey("roadmap", citation);
    setCitationNav([{ ...citation, key }]);
    setActiveCitationKey(key);
    await loadViewer({
      sourceId: citation.sourceId,
      chunkId: citation.chunkId,
    });
  }

  async function handleGenerateRoadmap() {
    setRoadmapError(null);
    setIsGeneratingRoadmap(true);
    try {
      const next = await buildLearningRoadmapFn({
        data: {
          notebookId: notebook.id,
          focus: roadmapFocus.trim() || undefined,
        },
      });
      setRoadmap(next);
    } catch (err) {
      setRoadmapError(
        err instanceof Error ? err.message : "Failed to generate roadmap",
      );
    } finally {
      setIsGeneratingRoadmap(false);
    }
  }

  async function handleAddSource(event: React.FormEvent) {
    event.preventDefault();
    setSourceError(null);
    setIsAddingSource(true);

    try {
      let created: SourceDTO;

      if (addMode === "text") {
        created = await createTextSourceFn({
          data: {
            notebookId: notebook.id,
            title: sourceTitle.trim(),
            content: sourceContent.trim(),
          },
        });
      } else if (addMode === "pdf") {
        if (!pdfFile) {
          throw new Error("Choose a PDF file");
        }
        if (pdfFile.type !== "application/pdf") {
          throw new Error("File must be a PDF");
        }
        if (pdfFile.size > INGEST_LIMITS.maxPdfBytes) {
          throw new Error(
            `PDF must be ${formatBytes(INGEST_LIMITS.maxPdfBytes)} or smaller`,
          );
        }
        const fileBase64 = await fileToBase64(pdfFile);
        created = await createPdfSourceFn({
          data: {
            notebookId: notebook.id,
            title:
              sourceTitle.trim() ||
              pdfFile.name.replace(/\.pdf$/i, "") ||
              "PDF source",
            fileName: pdfFile.name,
            fileBase64,
          },
        });
      } else if (addMode === "url") {
        created = await createUrlSourceFn({
          data: {
            notebookId: notebook.id,
            url: sourceUrl.trim(),
            title: sourceTitle.trim() || undefined,
          },
        });
      } else if (addMode === "vtt") {
        if (!vttFile) {
          throw new Error("Choose a VTT file");
        }
        const isVtt =
          vttFile.name.toLowerCase().endsWith(".vtt") ||
          vttFile.type === "text/vtt" ||
          vttFile.type === "text/plain";
        if (!isVtt) {
          throw new Error("File must be a .vtt transcript");
        }
        if (vttFile.size > INGEST_LIMITS.maxVttBytes) {
          throw new Error(
            `VTT must be ${formatBytes(INGEST_LIMITS.maxVttBytes)} or smaller`,
          );
        }
        const fileBase64 = await fileToBase64(vttFile);
        created = await createVttSourceFn({
          data: {
            notebookId: notebook.id,
            title:
              sourceTitle.trim() ||
              vttFile.name.replace(/\.vtt$/i, "") ||
              "Transcript",
            fileName: vttFile.name,
            fileBase64,
          },
        });
      } else {
        created = await createYoutubeSourceFn({
          data: {
            notebookId: notebook.id,
            url: youtubeUrl.trim(),
            title: sourceTitle.trim() || undefined,
          },
        });
      }

      setSourceTitle("");
      setSourceContent("");
      setSourceUrl("");
      setYoutubeUrl("");
      setPdfFile(null);
      setVttFile(null);
      setShowAddSource(false);
      setSources((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      // Indexing continues in the background; SSE updates status/progress
    } catch (err) {
      setSourceError(friendlyIngestError(err, "Failed to add source"));
    } finally {
      setIsAddingSource(false);
    }
  }

  async function handleReindex(sourceId: string) {
    setBusySourceId(sourceId);
    setSourceError(null);

    try {
      const updated = await reindexSourceFn({ data: { sourceId } });
      setSources((prev) =>
        prev.map((source) => (source.id === sourceId ? updated : source)),
      );
    } catch (err) {
      setSourceError(friendlyIngestError(err, "Failed to re-index source"));
    } finally {
      setBusySourceId(null);
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!confirm("Remove this source and its indexed chunks?")) {
      return;
    }

    setBusySourceId(sourceId);
    setSourceError(null);

    try {
      await deleteSourceFn({ data: { sourceId } });
      setSources((prev) => prev.filter((source) => source.id !== sourceId));
      if (viewer?.id === sourceId) {
        setViewer(null);
        setViewerOpen(false);
      }
      await router.invalidate();
    } catch (err) {
      setSourceError(
        err instanceof Error ? err.message : "Failed to delete source",
      );
    } finally {
      setBusySourceId(null);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isAsking) {
      return;
    }

    setChatError(null);
    setIsAsking(true);
    setQuestion("");

    const optimistic: ChatMessageDTO = {
      id: `temp-${Date.now()}`,
      notebookId: notebook.id,
      role: "user",
      content: trimmed,
      citations: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const result = await askNotebookFn({
        data: { notebookId: notebook.id, question: trimmed },
      });

      setMessages((prev) => [
        ...prev.filter((message) => message.id !== optimistic.id),
        result.userMessage,
        result.assistantMessage,
      ]);
    } catch (err) {
      setMessages((prev) =>
        prev.filter((message) => message.id !== optimistic.id),
      );
      setQuestion(trimmed);
      setChatError(err instanceof Error ? err.message : "Failed to ask question");
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur-md">
        <Link
          to="/notebooks"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--sea-ink-soft)] transition-colors hover:text-[var(--sea-ink)]"
        >
          <ArrowLeft className="size-4" />
          Notebooks
        </Link>
        <div className="h-4 w-px bg-[var(--line)]" />
        <div className="min-w-0">
          <h1 className="truncate font-[Fraunces,serif] text-lg font-semibold text-[var(--sea-ink)]">
            {notebook.title}
          </h1>
          <p className="text-xs text-[var(--sea-ink-soft)]">
            {readyCount} ready source{readyCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(280px,340px)]">
        {/* Sources */}
        <aside className="flex min-h-0 flex-col border-b border-[var(--line)] lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--sea-ink)]">
              Sources
            </h2>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setShowAddSource((open) => !open)}
            >
              <Plus />
              Add
            </Button>
          </div>

          {showAddSource ? (
            <form
              onSubmit={handleAddSource}
              className="space-y-3 border-b border-[var(--line)] px-4 py-3"
            >
              <div className="flex gap-1 rounded-lg bg-[var(--chip-bg)] p-1 ring-1 ring-[var(--chip-line)]">
                {(
                  [
                    ["text", "Text"],
                    ["pdf", "PDF"],
                    ["url", "URL"],
                    ["vtt", "VTT"],
                    ["youtube", "YT"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAddMode(mode)}
                    className={
                      addMode === mode
                        ? "flex-1 rounded-md bg-[var(--surface-strong)] px-2 py-1 text-xs font-medium text-[var(--sea-ink)]"
                        : "flex-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--sea-ink-soft)]"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="source-title">Title</Label>
                <Input
                  id="source-title"
                  value={sourceTitle}
                  onChange={(e) => setSourceTitle(e.target.value)}
                  required={addMode === "text"}
                  placeholder={
                    addMode === "pdf" || addMode === "vtt"
                      ? "Optional — defaults to file name"
                      : addMode === "url"
                        ? "Optional — defaults to page title"
                        : addMode === "youtube"
                          ? "Optional — defaults to video title"
                          : undefined
                  }
                  maxLength={200}
                />
              </div>

              {addMode === "text" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="source-content">Text</Label>
                  <Textarea
                    id="source-content"
                    value={sourceContent}
                    onChange={(e) => setSourceContent(e.target.value)}
                    required
                    rows={5}
                    maxLength={200_000}
                  />
                </div>
              ) : null}

              {addMode === "pdf" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="source-pdf">PDF file</Label>
                  <Input
                    id="source-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    required
                  />
                  {pdfFile ? (
                    <p className="text-xs text-[var(--sea-ink-soft)]">
                      {pdfFile.name} ·{" "}
                      {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  ) : null}
                </div>
              ) : null}

              {addMode === "url" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="source-url">Website URL</Label>
                  <Input
                    id="source-url"
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://example.com/article"
                    required
                  />
                </div>
              ) : null}

              {addMode === "vtt" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="source-vtt">VTT transcript</Label>
                  <Input
                    id="source-vtt"
                    type="file"
                    accept=".vtt,text/vtt"
                    onChange={(e) => setVttFile(e.target.files?.[0] ?? null)}
                    required
                  />
                  {vttFile ? (
                    <p className="text-xs text-[var(--sea-ink-soft)]">
                      {vttFile.name} ·{" "}
                      {(vttFile.size / 1024).toFixed(1)} KB
                    </p>
                  ) : null}
                </div>
              ) : null}

              {addMode === "youtube" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="source-youtube">YouTube URL</Label>
                  <Input
                    id="source-youtube"
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    required
                  />
                  <p className="text-xs text-[var(--sea-ink-soft)]">
                    Uses captions when available. Videos without captions will
                    fail indexing.
                  </p>
                </div>
              ) : null}

              {sourceError ? (
                <p className="text-xs text-destructive">{sourceError}</p>
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={
                  isAddingSource ||
                  (addMode === "text"
                    ? !sourceTitle.trim() || !sourceContent.trim()
                    : addMode === "pdf"
                      ? !pdfFile
                      : addMode === "url"
                        ? !sourceUrl.trim()
                        : addMode === "vtt"
                          ? !vttFile
                          : !youtubeUrl.trim())
                }
              >
                {addMode === "pdf" || addMode === "vtt" ? (
                  <Upload />
                ) : (
                  <FileText />
                )}
                {isAddingSource ? "Indexing…" : "Add & index"}
              </Button>
            </form>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sources.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
                Add a text source to start asking grounded questions.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {sources.map((source) => (
                  <li key={source.id} className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => openSource(source.id)}
                      className="w-full rounded-lg px-1 py-1 text-left transition hover:bg-[color-mix(in_oklab,var(--surface)_80%,white)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-[var(--sea-ink)]">
                          {source.title}
                        </p>
                        <SourceStatusBadge
                          status={source.status}
                          progressLabel={
                            isPendingStatus(source.status) &&
                            source.indexProgress
                              ? `${source.indexProgress.percent}%`
                              : null
                          }
                        />
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--sea-ink-soft)]">
                        {source.type}
                        {source.pageCount != null
                          ? ` · ${source.pageCount} pages`
                          : ""}
                        {source.chunkCount != null
                          ? ` · ${source.chunkCount} chunks`
                          : ""}
                        {source.originalUrl
                          ? ` · ${source.originalUrl.replace(/^https?:\/\//, "")}`
                          : ""}
                      </p>
                      {isPendingStatus(source.status) &&
                      source.indexProgress?.message ? (
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--lagoon-deep)]">
                          {source.indexProgress.message}
                        </p>
                      ) : null}
                      {source.status === "failed" && source.errorMessage ? (
                        <p
                          className="mt-1 line-clamp-3 text-xs text-destructive"
                          role="alert"
                        >
                          {source.errorMessage}
                        </p>
                      ) : null}
                    </button>
                    <div className="mt-1 flex gap-1 px-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Re-index ${source.title}`}
                        disabled={
                          busySourceId === source.id ||
                          isPendingStatus(source.status)
                        }
                        onClick={() => handleReindex(source.id)}
                      >
                        <RefreshCw
                          className={
                            busySourceId === source.id ||
                            isPendingStatus(source.status)
                              ? "animate-spin"
                              : undefined
                          }
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${source.title}`}
                        disabled={busySourceId === source.id}
                        onClick={() => handleDeleteSource(source.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Chat / Roadmap */}
        <section className="flex min-h-0 flex-col bg-[color-mix(in_oklab,var(--foam)_70%,transparent)]">
          <div className="flex items-center gap-1 border-b border-[var(--line)] px-4 py-2">
            <button
              type="button"
              onClick={() => setCenterMode("chat")}
              className={
                centerMode === "chat"
                  ? "inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--lagoon)_18%,transparent)] px-3 py-1.5 text-sm font-medium text-[var(--sea-ink)]"
                  : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
              }
            >
              <MessageSquare className="size-3.5" />
              Chat
            </button>
            <button
              type="button"
              onClick={() => setCenterMode("roadmap")}
              className={
                centerMode === "roadmap"
                  ? "inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--lagoon)_18%,transparent)] px-3 py-1.5 text-sm font-medium text-[var(--sea-ink)]"
                  : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
              }
            >
              <Map className="size-3.5" />
              Learn
            </button>
          </div>

          {centerMode === "roadmap" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <LearningRoadmapPanel
                youtubeReadyCount={youtubeReadyCount}
                focus={roadmapFocus}
                onFocusChange={setRoadmapFocus}
                roadmap={roadmap}
                isGenerating={isGeneratingRoadmap}
                error={roadmapError}
                onGenerate={() => void handleGenerateRoadmap()}
                onOpenClip={(citation) => void openRoadmapClip(citation)}
              />
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {messages.length === 0 ? (
                  <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
                    <h2 className="font-[Fraunces,serif] text-2xl font-semibold text-[var(--sea-ink)]">
                      Ask this notebook
                    </h2>
                    <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                      Answers are grounded in your sources and always include
                      citations you can open.
                    </p>
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-3xl flex-col gap-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={
                          message.role === "user"
                            ? "ml-auto max-w-[85%] rounded-2xl bg-[var(--sea-ink)] px-4 py-3 text-sm text-white"
                            : "mr-auto max-w-[90%] rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--sea-ink)] shadow-sm"
                        }
                      >
                        {message.role === "assistant" ? (
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {renderAnswerWithCitations(
                              message.content,
                              message.citations,
                              message.id,
                              activeCitationKey,
                              openCitation,
                            )}
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {message.content}
                          </p>
                        )}

                        {message.role === "assistant" &&
                        message.citations.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
                            {message.citations.map((citation) => {
                              const key = citationKey(message.id, citation);
                              const isActive = activeCitationKey === key;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() =>
                                    openCitation(citation, message.id)
                                  }
                                  className={
                                    isActive
                                      ? "rounded-full bg-[color-mix(in_oklab,var(--lagoon)_22%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--sea-ink)] ring-2 ring-[var(--lagoon)] transition"
                                      : "rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-medium text-[var(--sea-ink-soft)] ring-1 ring-[var(--chip-line)] transition hover:text-[var(--sea-ink)]"
                                  }
                                >
                                  [{citation.citationNumber}]{" "}
                                  {citation.sourceTitle ?? "Source"}
                                  {citation.locator?.page != null
                                    ? ` · p.${citation.locator.page}`
                                    : ""}
                                  {citation.locator?.tStart != null
                                    ? ` · ${Math.floor(citation.locator.tStart / 60)}:${String(
                                        Math.floor(
                                          citation.locator.tStart % 60,
                                        ),
                                      ).padStart(2, "0")}`
                                    : ""}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {isAsking ? (
                      <div className="mr-auto inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--sea-ink-soft)]">
                        <LoaderCircle className="size-4 animate-spin" />
                        Searching sources…
                      </div>
                    ) : null}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              <form
                onSubmit={handleAsk}
                className="border-t border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 sm:px-6"
              >
                {chatError ? (
                  <p className="mb-2 text-sm text-destructive" role="alert">
                    {chatError}
                  </p>
                ) : null}
                <div className="mx-auto flex max-w-3xl gap-2">
                  <Textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={
                      readyCount > 0
                        ? "Ask a question about your sources…"
                        : "Add a ready source before asking…"
                    }
                    rows={2}
                    className="min-h-[44px] resize-none"
                    disabled={isAsking}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleAsk(event as unknown as React.FormEvent);
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    size="icon-lg"
                    disabled={isAsking || !question.trim()}
                    aria-label="Send question"
                  >
                    {isAsking ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Send />
                    )}
                  </Button>
                </div>
              </form>
            </>
          )}
        </section>

        {/* Viewer */}
        <aside
          className={
            viewerOpen
              ? "flex min-h-0 flex-col border-t border-[var(--line)] bg-[var(--surface)] lg:border-t-0 lg:border-l"
              : "hidden min-h-0 flex-col border-t border-[var(--line)] bg-[var(--surface)] lg:flex lg:border-t-0 lg:border-l"
          }
        >
          <SourceViewerPanel
            source={viewer}
            loading={viewerLoading}
            citations={citationNav}
            activeCitationKey={activeCitationKey}
            onNavigateCitation={navigateCitation}
            onClose={() => {
              setViewerOpen(false);
              setViewer(null);
              setCitationNav([]);
              setActiveCitationKey(null);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
