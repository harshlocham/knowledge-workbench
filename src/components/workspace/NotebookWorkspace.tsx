import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Menu, PanelRight } from "lucide-react";

import { Breadcrumbs } from "#/components/layout/Breadcrumbs.tsx";
import { ResizablePanel } from "#/components/layout/ResizablePanel.tsx";
import { TopNavigation } from "#/components/layout/TopNavigation.tsx";
import { ChatPanel } from "#/components/workspace/ChatPanel.tsx";
import { EditableNotebookTitle } from "#/components/workspace/EditableNotebookTitle.tsx";
import { KnowledgeToolsPanel } from "#/components/workspace/KnowledgeToolsPanel.tsx";
import { SourcesSidebar } from "#/components/workspace/SourcesSidebar.tsx";
import type { ToolsTab } from "#/components/workspace/ViewerTabs.tsx";
import type {
  CitationNavItem,
  ViewerSource,
} from "#/components/notebook/source-viewer/types.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
  askNotebook,
  getSourceViewer,
  listMessages,
  type ChatMessageDTO,
} from "#/features/chat/chat.functions.ts";
import {
  updateNotebook,
  type NotebookDTO,
} from "#/features/notebooks/notebooks.functions.ts";
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
import { useWorkspaceLayout } from "#/hooks/use-workspace-layout.ts";
import { fileToBase64 } from "#/lib/file-to-base64.ts";
import {
  formatBytes,
  friendlyIngestError,
  INGEST_LIMITS,
} from "#/lib/ingest/limits.ts";
import {
  deriveNotebookDescriptionFromSources,
  deriveNotebookTitleFromSources,
  isEmptyNotebookDescription,
  isUntitledNotebookTitle,
  shouldAutoUpdateNotebookDescription,
} from "#/lib/notebook-title.ts";

function isPendingStatus(status: SourceDTO["status"]) {
  return status === "uploading" || status === "indexing";
}

function citationKey(messageId: string, citation: MessageCitation) {
  return `${messageId}:${citation.chunkId}:${citation.citationNumber ?? ""}`;
}

export function NotebookWorkspace({
  notebook,
  initialSources,
  initialMessages,
}: {
  notebook: NotebookDTO;
  initialSources: SourceDTO[];
  initialMessages: ChatMessageDTO[];
}) {
  const router = useRouter();
  const layout = useWorkspaceLayout();

  const createTextSourceFn = useServerFn(createTextSource);
  const createPdfSourceFn = useServerFn(createPdfSource);
  const createUrlSourceFn = useServerFn(createUrlSource);
  const createVttSourceFn = useServerFn(createVttSource);
  const createYoutubeSourceFn = useServerFn(createYoutubeSource);
  const deleteSourceFn = useServerFn(deleteSource);
  const reindexSourceFn = useServerFn(reindexSource);
  const listSourcesFn = useServerFn(listSources);
  const askNotebookFn = useServerFn(askNotebook);
  const listMessagesFn = useServerFn(listMessages);
  const getSourceViewerFn = useServerFn(getSourceViewer);
  const buildLearningRoadmapFn = useServerFn(buildLearningRoadmap);
  const updateNotebookFn = useServerFn(updateNotebook);

  const [notebookState, setNotebookState] = useState(notebook);
  const [sources, setSources] = useState(initialSources);
  const [messages, setMessages] = useState(initialMessages);
  const [toolsTab, setToolsTab] = useState<ToolsTab>("source");
  const [addSourcesOpen, setAddSourcesOpen] = useState(
    () => initialSources.length === 0,
  );
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const autoTitleEnabledRef = useRef(isUntitledNotebookTitle(notebook.title));
  const autoDescriptionEnabledRef = useRef(
    isEmptyNotebookDescription(notebook.description),
  );
  const titleSyncInFlightRef = useRef(false);
  const readySourceIdsRef = useRef(
    new Set(
      initialSources
        .filter((source) => source.status === "ready")
        .map((source) => source.id),
    ),
  );

  const [roadmap, setRoadmap] = useState<LearningRoadmap | null>(null);
  const [roadmapFocus, setRoadmapFocus] = useState("");
  const [isGeneratingRoadmap, setIsGeneratingRoadmap] = useState(false);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);

  const [isAddingSource, setIsAddingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [viewer, setViewer] = useState<ViewerSource | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [citationNav, setCitationNav] = useState<CitationNavItem[]>([]);
  const [activeCitationKey, setActiveCitationKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setNotebookState(notebook);
    if (isUntitledNotebookTitle(notebook.title)) {
      autoTitleEnabledRef.current = true;
    }
    if (isEmptyNotebookDescription(notebook.description)) {
      autoDescriptionEnabledRef.current = true;
    }
  }, [notebook]);

  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (sources.length === 0) {
      setAddSourcesOpen(true);
    }
  }, [sources.length]);

  useEffect(() => {
    if (titleSyncInFlightRef.current) {
      return;
    }

    const nextTitle = autoTitleEnabledRef.current
      ? deriveNotebookTitleFromSources(sources)
      : null;
    const canAutoDescription =
      autoDescriptionEnabledRef.current &&
      shouldAutoUpdateNotebookDescription(
        notebookState.description,
        notebookState.title,
      );
    const nextDescription = canAutoDescription
      ? deriveNotebookDescriptionFromSources(sources)
      : null;

    const titleChanged =
      Boolean(nextTitle) && nextTitle !== notebookState.title;
    // Never mirror the title into description.
    const descriptionChanged =
      Boolean(nextDescription) &&
      nextDescription !== (notebookState.description ?? "") &&
      nextDescription !== notebookState.title;

    if (!titleChanged && !descriptionChanged) {
      return;
    }

    titleSyncInFlightRef.current = true;
    void updateNotebookFn({
      data: {
        id: notebookState.id,
        ...(titleChanged ? { title: nextTitle! } : {}),
        ...(descriptionChanged ? { description: nextDescription! } : {}),
      },
    })
      .then((updated) => {
        setNotebookState(updated);
        return router.invalidate();
      })
      .catch(() => undefined)
      .finally(() => {
        titleSyncInFlightRef.current = false;
      });
  }, [
    sources,
    notebookState.id,
    notebookState.title,
    notebookState.description,
    updateNotebookFn,
    router,
  ]);

  const hasPendingSources = useMemo(
    () => sources.some((source) => isPendingStatus(source.status)),
    [sources],
  );

  useEffect(() => {
    if (!hasPendingSources) return;

    const events = new EventSource(
      `/api/notebooks/${notebook.id}/source-events`,
    );
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
          void listMessagesFn({ data: { notebookId: notebook.id } })
            .then(setMessages)
            .catch(() => undefined);
          void router.invalidate();
        }
      } catch {
        // ignore
      }
    };

    events.onerror = () => {
      events.close();
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
  }, [hasPendingSources, notebook.id, listSourcesFn, listMessagesFn, router]);

  // When a source newly becomes ready, refresh chat so the auto overview shows.
  useEffect(() => {
    const readyIds = sources
      .filter((source) => source.status === "ready")
      .map((source) => source.id);
    const newlyReady = readyIds.some((id) => !readySourceIdsRef.current.has(id));
    readySourceIdsRef.current = new Set(readyIds);
    if (!newlyReady) return;

    void listMessagesFn({ data: { notebookId: notebook.id } })
      .then(setMessages)
      .catch(() => undefined);
  }, [sources, notebook.id, listMessagesFn]);

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

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === viewer?.id) ?? null,
    [sources, viewer?.id],
  );

  function revealKnowledgeTools() {
    layout.setRightCollapsed(false);
    setToolsTab("source");
    // Desktop already has the docked right panel — only open the mobile sheet
    // below the `lg` breakpoint so we don't stack two source viewers.
    const isMobileViewport =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches;
    setMobileToolsOpen(isMobileViewport);
  }

  async function loadViewer(options: { sourceId: string; chunkId?: string }) {
    setViewerLoading(true);
    revealKnowledgeTools();
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
    setCitationNav(nav);
    setActiveCitationKey(citationKey(messageId, citation));
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
    setMobileSourcesOpen(false);
    await loadViewer({ sourceId });
  }

  async function openRoadmapClip(citation: MessageCitation) {
    const key = citationKey("roadmap", citation);
    setCitationNav([{ ...citation, key }]);
    setActiveCitationKey(key);
    setToolsTab("source");
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

  async function handleAddSource(payload: {
    mode: "text" | "pdf" | "url" | "vtt" | "youtube";
    title: string;
    content: string;
    url: string;
    youtubeUrl: string;
    pdfFile: File | null;
    vttFile: File | null;
  }) {
    setSourceError(null);
    setIsAddingSource(true);
    try {
      let created: SourceDTO;
      if (payload.mode === "text") {
        created = await createTextSourceFn({
          data: {
            notebookId: notebook.id,
            title: payload.title.trim() || "Text source",
            content: payload.content.trim(),
          },
        });
      } else if (payload.mode === "pdf") {
        if (!payload.pdfFile) throw new Error("Choose a PDF file");
        if (payload.pdfFile.type !== "application/pdf") {
          throw new Error("File must be a PDF");
        }
        if (payload.pdfFile.size > INGEST_LIMITS.maxPdfBytes) {
          throw new Error(
            `PDF must be ${formatBytes(INGEST_LIMITS.maxPdfBytes)} or smaller`,
          );
        }
        const fileBase64 = await fileToBase64(payload.pdfFile);
        created = await createPdfSourceFn({
          data: {
            notebookId: notebook.id,
            title:
              payload.title.trim() ||
              payload.pdfFile.name.replace(/\.pdf$/i, "") ||
              "PDF source",
            fileName: payload.pdfFile.name,
            fileBase64,
          },
        });
      } else if (payload.mode === "url") {
        created = await createUrlSourceFn({
          data: {
            notebookId: notebook.id,
            url: payload.url.trim(),
            title: payload.title.trim() || undefined,
          },
        });
      } else if (payload.mode === "vtt") {
        if (!payload.vttFile) throw new Error("Choose a VTT file");
        if (payload.vttFile.size > INGEST_LIMITS.maxVttBytes) {
          throw new Error(
            `VTT must be ${formatBytes(INGEST_LIMITS.maxVttBytes)} or smaller`,
          );
        }
        const fileBase64 = await fileToBase64(payload.vttFile);
        created = await createVttSourceFn({
          data: {
            notebookId: notebook.id,
            title:
              payload.title.trim() ||
              payload.vttFile.name.replace(/\.vtt$/i, "") ||
              "Transcript",
            fileName: payload.vttFile.name,
            fileBase64,
          },
        });
      } else {
        created = await createYoutubeSourceFn({
          data: {
            notebookId: notebook.id,
            url: payload.youtubeUrl.trim(),
            title: payload.title.trim() || undefined,
          },
        });
      }
      setSources((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
    } catch (err) {
      setSourceError(friendlyIngestError(err, "Failed to add source"));
      throw err;
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
    if (!confirm("Remove this source and its indexed chunks?")) return;
    setBusySourceId(sourceId);
    setSourceError(null);
    try {
      await deleteSourceFn({ data: { sourceId } });
      setSources((prev) => prev.filter((source) => source.id !== sourceId));
      if (viewer?.id === sourceId) {
        setViewer(null);
        setCitationNav([]);
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

  async function runAsk(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || isAsking) return;

    setChatError(null);
    setIsAsking(true);
    setQuestion("");

    const optimistic: ChatMessageDTO = {
      id: `optimistic-${Date.now()}`,
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
      setChatError(
        err instanceof Error ? err.message : "Failed to ask question",
      );
    } finally {
      setIsAsking(false);
    }
  }

  function handleRegenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    void runAsk(lastUser.content);
  }

  async function handleRename(title: string) {
    autoTitleEnabledRef.current = false;
    const updated = await updateNotebookFn({
      data: { id: notebookState.id, title },
    });
    setNotebookState(updated);
    await router.invalidate();
  }

  const breadcrumbItems = [
    { label: "Knowledge Workbench", to: "/notebooks" },
  ];

  const toolsProps = {
    tab: toolsTab,
    onTabChange: setToolsTab,
    notebook: notebookState,
    sources,
    messages,
    viewer,
    viewerLoading,
    citationNav,
    activeCitationKey,
    onNavigateCitation: (c: CitationNavItem) => void navigateCitation(c),
    onCloseViewer: () => {
      setViewer(null);
      setCitationNav([]);
      setActiveCitationKey(null);
    },
    selectedSource,
    youtubeReadyCount,
    roadmapFocus,
    onRoadmapFocusChange: setRoadmapFocus,
    roadmap,
    isGeneratingRoadmap,
    roadmapError,
    onGenerateRoadmap: () => void handleGenerateRoadmap(),
    onOpenClip: (c: MessageCitation) => void openRoadmapClip(c),
  };

  const sourcesSidebar = (
    <SourcesSidebar
      sources={sources}
      selectedSourceId={viewer?.id}
      busySourceId={busySourceId}
      sourceError={sourceError}
      isAddingSource={isAddingSource}
      onOpenSource={(id) => void openSource(id)}
      onReindex={(id) => void handleReindex(id)}
      onDelete={(id) => void handleDeleteSource(id)}
      onAddSource={handleAddSource}
      addOpen={addSourcesOpen}
      onAddOpenChange={setAddSourcesOpen}
    />
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[var(--workspace-bg)]">
      <TopNavigation
        compact
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileSourcesOpen(true)}
              aria-label="Open sources"
            >
              <Menu />
              Sources
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileToolsOpen(true)}
              aria-label="Open knowledge tools"
            >
              <PanelRight />
              Tools
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 sm:gap-3 sm:px-6">
        <Breadcrumbs items={breadcrumbItems} className="shrink-0" />
        <span className="text-muted-foreground" aria-hidden>
          /
        </span>
        <EditableNotebookTitle
          title={notebookState.title}
          onSave={handleRename}
          className="min-w-0 flex-1 text-sm"
        />
        {viewer ? (
          <>
            <span className="hidden text-muted-foreground sm:inline" aria-hidden>
              /
            </span>
            <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline">
              {viewer.title}
            </span>
          </>
        ) : null}
        <p className="hidden shrink-0 text-xs text-muted-foreground md:block">
          {readyCount} ready
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        <ResizablePanel
          side="left"
          label="Sources"
          width={layout.leftWidth}
          collapsed={layout.leftCollapsed}
          onWidthChange={layout.setLeftWidth}
          onCollapsedChange={layout.setLeftCollapsed}
        >
          {sourcesSidebar}
        </ResizablePanel>

        <ChatPanel
          messages={messages}
          isAsking={isAsking}
          question={question}
          onQuestionChange={setQuestion}
          onAsk={() => void runAsk(question)}
          onRegenerate={handleRegenerate}
          chatError={chatError}
          readyCount={readyCount}
          sourceCount={sources.length}
          onAddSources={() => setAddSourcesOpen(true)}
          activeCitationKey={activeCitationKey}
          onCitationClick={(citation, messageId) =>
            void openCitation(citation, messageId)
          }
        />

        <ResizablePanel
          side="right"
          label="Knowledge Tools"
          width={layout.rightWidth}
          collapsed={layout.rightCollapsed}
          onWidthChange={layout.setRightWidth}
          onCollapsedChange={layout.setRightCollapsed}
        >
          <KnowledgeToolsPanel {...toolsProps} />
        </ResizablePanel>
      </div>

      <Sheet open={mobileSourcesOpen} onOpenChange={setMobileSourcesOpen}>
        <SheetContent side="left" className="w-[min(100%,20rem)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Sources</SheetTitle>
          </SheetHeader>
          {sourcesSidebar}
        </SheetContent>
      </Sheet>

      <Sheet open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
        <SheetContent side="right" className="w-[min(100%,24rem)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Knowledge Tools</SheetTitle>
          </SheetHeader>
          <KnowledgeToolsPanel {...toolsProps} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
