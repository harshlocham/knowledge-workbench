import { useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";

import {
  SourceViewerPanel,
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
  createTextSource,
  deleteSource,
  listSources,
  reindexSource,
  type SourceDTO,
} from "#/features/sources/sources.functions.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";

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

function renderAnswerWithCitations(
  content: string,
  citations: MessageCitation[],
  onCitationClick: (citation: MessageCitation) => void,
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

    return (
      <button
        key={`${part}-${index}`}
        type="button"
        onClick={() => onCitationClick(citation)}
        className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-full bg-[color-mix(in_oklab,var(--lagoon)_18%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--lagoon-deep)] ring-1 ring-[color-mix(in_oklab,var(--lagoon)_30%,transparent)] transition hover:bg-[color-mix(in_oklab,var(--lagoon)_28%,transparent)]"
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
  const deleteSourceFn = useServerFn(deleteSource);
  const reindexSourceFn = useServerFn(reindexSource);
  const listSourcesFn = useServerFn(listSources);
  const askNotebookFn = useServerFn(askNotebook);
  const getSourceViewerFn = useServerFn(getSourceViewer);

  const [sources, setSources] = useState(initialSources);
  const [messages, setMessages] = useState(initialMessages);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
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

  useEffect(() => {
    const hasPending = sources.some((source) => isPendingStatus(source.status));
    if (!hasPending) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const next = await listSourcesFn({
          data: { notebookId: notebook.id },
        });
        setSources(next);
      } catch {
        // keep last known state
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [sources, notebook.id, listSourcesFn]);

  const readyCount = useMemo(
    () => sources.filter((source) => source.status === "ready").length,
    [sources],
  );

  async function openCitation(citation: MessageCitation) {
    setViewerOpen(true);
    setViewerLoading(true);

    try {
      const data = await getSourceViewerFn({
        data: {
          sourceId: citation.sourceId,
          chunkId: citation.chunkId,
        },
      });
      setViewer(data);
    } catch {
      setViewer(null);
    } finally {
      setViewerLoading(false);
    }
  }

  async function openSource(sourceId: string) {
    setViewerOpen(true);
    setViewerLoading(true);

    try {
      const data = await getSourceViewerFn({
        data: { sourceId },
      });
      setViewer(data);
    } catch {
      setViewer(null);
    } finally {
      setViewerLoading(false);
    }
  }

  async function handleAddTextSource(event: React.FormEvent) {
    event.preventDefault();
    setSourceError(null);
    setIsAddingSource(true);

    try {
      const created = await createTextSourceFn({
        data: {
          notebookId: notebook.id,
          title: sourceTitle.trim(),
          content: sourceContent.trim(),
        },
      });

      setSourceTitle("");
      setSourceContent("");
      setShowAddSource(false);
      setSources((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      await router.invalidate();
    } catch (err) {
      setSourceError(
        err instanceof Error ? err.message : "Failed to add text source",
      );
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
      setSourceError(
        err instanceof Error ? err.message : "Failed to re-index source",
      );
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
              onSubmit={handleAddTextSource}
              className="space-y-3 border-b border-[var(--line)] px-4 py-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="source-title">Title</Label>
                <Input
                  id="source-title"
                  value={sourceTitle}
                  onChange={(e) => setSourceTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>
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
              {sourceError ? (
                <p className="text-xs text-destructive">{sourceError}</p>
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={
                  isAddingSource || !sourceTitle.trim() || !sourceContent.trim()
                }
              >
                <FileText />
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
                        <SourceStatusBadge status={source.status} />
                      </div>
                      <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
                        {source.type}
                        {source.chunkCount != null
                          ? ` · ${source.chunkCount} chunks`
                          : ""}
                      </p>
                      {source.status === "failed" && source.errorMessage ? (
                        <p className="mt-1 line-clamp-2 text-xs text-destructive">
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

        {/* Chat */}
        <section className="flex min-h-0 flex-col bg-[color-mix(in_oklab,var(--foam)_70%,transparent)]">
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
                        {message.citations.map((citation) => (
                          <button
                            key={`${message.id}-${citation.chunkId}-${citation.citationNumber}`}
                            type="button"
                            onClick={() => openCitation(citation)}
                            className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-medium text-[var(--sea-ink-soft)] ring-1 ring-[var(--chip-line)] transition hover:text-[var(--sea-ink)]"
                          >
                            [{citation.citationNumber}]{" "}
                            {citation.sourceTitle ?? "Source"}
                          </button>
                        ))}
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
            onClose={() => {
              setViewerOpen(false);
              setViewer(null);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
