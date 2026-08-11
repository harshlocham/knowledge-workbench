import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Menu, PanelRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Breadcrumbs } from "#/components/layout/Breadcrumbs.tsx";
import { ResizablePanel } from "#/components/layout/ResizablePanel.tsx";
import { TopNavigation } from "#/components/layout/TopNavigation.tsx";
import type {
	CitationNavItem,
	ViewerSource,
} from "#/components/notebook/source-viewer/types.ts";
import {
	type SeekCommand,
	YoutubePlayerStage,
} from "#/components/notebook/source-viewer/youtube-player-stage.tsx";
import { SourceViewerPanel } from "#/components/notebook/source-viewer-panel.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/ui/tabs.tsx";
import { AddSourceSheet } from "#/components/workspace/AddSourceSheet.tsx";
import { ChatPanel } from "#/components/workspace/ChatPanel.tsx";
import { EditableNotebookTitle } from "#/components/workspace/EditableNotebookTitle.tsx";
import { KnowledgeToolsPanel } from "#/components/workspace/KnowledgeToolsPanel.tsx";
import { citationKey } from "#/components/workspace/MarkdownWithCitations.tsx";
import { SourcesSidebar } from "#/components/workspace/SourcesSidebar.tsx";
import type { StudioArtifactType } from "#/components/workspace/studio/ArtifactTypeCards.tsx";
import { StudioPanel } from "#/components/workspace/studio/StudioPanel.tsx";
import type { ToolsTab } from "#/components/workspace/ViewerTabs.tsx";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	type ChatMessageDTO,
	getSourceViewer,
	listMessages,
} from "#/features/chat/chat.functions.ts";
import {
	type NotebookDTO,
	updateNotebook,
} from "#/features/notebooks/notebooks.functions.ts";
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
import { getArtifact } from "#/features/studio/artifacts.functions.ts";
import type {
	ArtifactDTO,
	ArtifactSummaryDTO,
} from "#/features/studio/artifacts.types.ts";
import { generateLearningRoadmapArtifact } from "#/features/studio/learning-roadmap.functions.ts";
import { generateResearchBriefArtifact } from "#/features/studio/research-brief.functions.ts";
import { generateStudyGuideArtifact } from "#/features/studio/study-guide.functions.ts";
import { useWorkspaceLayout } from "#/hooks/use-workspace-layout.ts";
import { askNotebookStream } from "#/lib/chat/ask-stream.ts";
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

/** The center workspace is either the chat thread or the Research Studio. */
type CenterMode = "chat" | "studio";

function isPendingStatus(status: SourceDTO["status"]) {
	return status === "uploading" || status === "indexing";
}

/** Optimistic list row for an artifact we just created, before the loader refreshes. */
function toArtifactSummary(artifact: ArtifactDTO): ArtifactSummaryDTO {
	const { content, citations, ...rest } = artifact;
	return {
		...rest,
		citationCount: citations.length,
		sectionCount: content?.sections.length ?? 0,
	};
}

export function NotebookWorkspace({
	notebook,
	initialSources,
	initialMessages,
	initialArtifacts,
}: {
	notebook: NotebookDTO;
	initialSources: SourceDTO[];
	initialMessages: ChatMessageDTO[];
	initialArtifacts: ArtifactSummaryDTO[];
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
	const listMessagesFn = useServerFn(listMessages);
	const getSourceViewerFn = useServerFn(getSourceViewer);
	const updateNotebookFn = useServerFn(updateNotebook);
	const getArtifactFn = useServerFn(getArtifact);
	const generateResearchBriefFn = useServerFn(generateResearchBriefArtifact);
	const generateStudyGuideFn = useServerFn(generateStudyGuideArtifact);
	const generateLearningRoadmapFn = useServerFn(
		generateLearningRoadmapArtifact,
	);

	const [notebookState, setNotebookState] = useState(notebook);
	const [sources, setSources] = useState(initialSources);
	const [messages, setMessages] = useState(initialMessages);
	const [toolsTab, setToolsTab] = useState<ToolsTab>("source");
	const [centerMode, setCenterMode] = useState<CenterMode>("chat");
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

	const [artifacts, setArtifacts] = useState(initialArtifacts);
	const [activeArtifact, setActiveArtifact] = useState<ArtifactDTO | null>(
		null,
	);
	const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
		() => initialArtifacts[0]?.id ?? null,
	);
	const [activeArtifactLoading, setActiveArtifactLoading] = useState(false);
	const [studioFocus, setStudioFocus] = useState("");
	const [generatingType, setGeneratingType] =
		useState<StudioArtifactType | null>(null);
	const [studioError, setStudioError] = useState<string | null>(null);

	const [isAddingSource, setIsAddingSource] = useState(false);
	const [sourceError, setSourceError] = useState<string | null>(null);
	const [busySourceId, setBusySourceId] = useState<string | null>(null);

	const [question, setQuestion] = useState("");
	const [isAsking, setIsAsking] = useState(false);
	const [askStatus, setAskStatus] = useState<string | null>(null);
	const [chatError, setChatError] = useState<string | null>(null);

	const [viewer, setViewer] = useState<ViewerSource | null>(null);
	const [viewerLoading, setViewerLoading] = useState(false);
	const [sourceExpanded, setSourceExpanded] = useState(false);
	const playbackResumeRef = useRef({ seconds: 0, playing: false });
	const [playback, setPlayback] = useState({ seconds: 0, playing: false });
	const [seekCommand, setSeekCommand] = useState<SeekCommand | null>(null);
	const seekNonceRef = useRef(0);
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
		setArtifacts(initialArtifacts);
		setActiveArtifactId(
			(current) => current ?? initialArtifacts[0]?.id ?? null,
		);
	}, [initialArtifacts]);

	function openAddSources() {
		setSourceError(null);
		setAddSourcesOpen(true);
		layout.setLeftCollapsed(false);
		const isMobileViewport =
			typeof window !== "undefined" &&
			window.matchMedia("(max-width: 1023px)").matches;
		if (isMobileViewport) {
			setMobileSourcesOpen(true);
		}
	}

	useEffect(() => {
		if (sources.length !== 0) return;
		setAddSourcesOpen(true);
		layout.setLeftCollapsed(false);
	}, [sources.length, layout.setLeftCollapsed]);

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

	// Stay subscribed after indexing finishes — playlist overview is written later.
	const [watchSourceEvents, setWatchSourceEvents] = useState(hasPendingSources);
	useEffect(() => {
		if (hasPendingSources) setWatchSourceEvents(true);
	}, [hasPendingSources]);

	useEffect(() => {
		if (!watchSourceEvents) return;

		const events = new EventSource(
			`/api/notebooks/${notebook.id}/source-events`,
		);
		let fallbackTimer: number | undefined;
		const overviewPollTimers: number[] = [];

		const refreshMessages = () =>
			listMessagesFn({ data: { notebookId: notebook.id } })
				.then(setMessages)
				.catch(() => undefined);

		events.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data) as {
					type: string;
					sources?: SourceDTO[];
					messages?: typeof messages;
				};
				if (payload.type === "sources" && Array.isArray(payload.sources)) {
					setSources(payload.sources);
				}
				if (payload.type === "messages" && Array.isArray(payload.messages)) {
					setMessages(payload.messages);
				}
				if (payload.type === "done") {
					events.close();
					setWatchSourceEvents(false);
					void refreshMessages();
					// Safety net if overview lands right after the stream closes.
					for (const ms of [2_000, 6_000, 15_000]) {
						overviewPollTimers.push(
							window.setTimeout(() => {
								void refreshMessages();
							}, ms),
						);
					}
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
					.then((next) => {
						setSources(next);
						if (!next.some((source) => isPendingStatus(source.status))) {
							if (fallbackTimer) {
								window.clearInterval(fallbackTimer);
								fallbackTimer = undefined;
							}
							setWatchSourceEvents(false);
						}
					})
					.catch(() => undefined);
				void refreshMessages();
			}, 2000);
		};

		return () => {
			events.close();
			if (fallbackTimer) window.clearInterval(fallbackTimer);
			for (const timer of overviewPollTimers) window.clearTimeout(timer);
		};
	}, [watchSourceEvents, notebook.id, listSourcesFn, listMessagesFn, router]);

	// When a source newly becomes ready, refresh chat so single-source overviews show.
	useEffect(() => {
		const readyIds = sources
			.filter((source) => source.status === "ready")
			.map((source) => source.id);
		const newlyReady = readyIds.some(
			(id) => !readySourceIdsRef.current.has(id),
		);
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

	async function openCitation(citation: MessageCitation, messageId: string) {
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

	useEffect(() => {
		if (!activeArtifactId) {
			setActiveArtifact(null);
			return;
		}

		let cancelled = false;
		setActiveArtifactLoading(true);
		void getArtifactFn({ data: { id: activeArtifactId } })
			.then((artifact) => {
				if (!cancelled) setActiveArtifact(artifact);
			})
			.catch(() => {
				if (!cancelled) setActiveArtifact(null);
			})
			.finally(() => {
				if (!cancelled) setActiveArtifactLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [activeArtifactId, getArtifactFn]);

	// Generation runs in a background job, so poll every pending row until it
	// settles - not just the selected one, so a switch away does not stall it.
	const pendingArtifactIds = artifacts
		.filter((row) => row.status === "pending")
		.map((row) => row.id)
		.join(",");

	useEffect(() => {
		if (!pendingArtifactIds) return;
		const ids = pendingArtifactIds.split(",");

		const timer = window.setInterval(() => {
			for (const id of ids) {
				void getArtifactFn({ data: { id } })
					.then((artifact) => {
						setActiveArtifact((current) =>
							current?.id === artifact.id ? artifact : current,
						);
						if (artifact.status === "pending") return;
						setArtifacts((prev) =>
							prev.map((row) =>
								row.id === artifact.id ? toArtifactSummary(artifact) : row,
							),
						);
						void router.invalidate();
					})
					.catch(() => undefined);
			}
		}, 2500);

		return () => window.clearInterval(timer);
	}, [pendingArtifactIds, getArtifactFn, router]);

	async function handleGenerateArtifact(type: StudioArtifactType) {
		setStudioError(null);
		setGeneratingType(type);
		try {
			const data = {
				notebookId: notebook.id,
				focus: studioFocus.trim() || undefined,
			};
			const generateFn = {
				research_brief: generateResearchBriefFn,
				study_guide: generateStudyGuideFn,
				learning_roadmap: generateLearningRoadmapFn,
			}[type];
			const created = await generateFn({ data });

			setArtifacts((prev) => [
				toArtifactSummary(created),
				...prev.filter((row) => row.id !== created.id),
			]);
			setActiveArtifact(created);
			setActiveArtifactId(created.id);
		} catch (err) {
			setStudioError(
				err instanceof Error ? err.message : "Failed to start generation",
			);
		} finally {
			setGeneratingType(null);
		}
	}

	async function openArtifactCitation(
		citation: MessageCitation,
		ownerId: string,
	) {
		const nav = (activeArtifact?.citations ?? [citation]).map((item) => ({
			...item,
			key: citationKey(ownerId, item),
		}));
		setCitationNav(nav);
		setActiveCitationKey(citationKey(ownerId, citation));
		await loadViewer({
			sourceId: citation.sourceId,
			chunkId: citation.chunkId,
		});
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
				const result = await createYoutubeSourceFn({
					data: {
						notebookId: notebook.id,
						url: payload.youtubeUrl.trim(),
						title: payload.title.trim() || undefined,
					},
				});
				const createdSources = result.sources;
				setSources((prev) => {
					const ids = new Set(createdSources.map((s) => s.id));
					return [...createdSources, ...prev.filter((s) => !ids.has(s.id))];
				});
				return;
			}
			setSources((prev) => [
				created,
				...prev.filter((s) => s.id !== created.id),
			]);
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
		setAskStatus("Understanding your question…");
		setQuestion("");

		const optimisticUser: ChatMessageDTO = {
			id: `optimistic-user-${Date.now()}`,
			notebookId: notebook.id,
			role: "user",
			content: trimmed,
			citations: [],
			createdAt: new Date().toISOString(),
		};
		const streamingAssistantId = `optimistic-assistant-${Date.now()}`;
		setMessages((prev) => [...prev, optimisticUser]);

		try {
			const result = await askNotebookStream(notebook.id, trimmed, {
				onPhase: (_phase, message) => {
					setAskStatus(message);
					// Once writing starts, show a streaming assistant bubble.
					if (_phase === "writing") {
						setMessages((prev) => {
							if (prev.some((m) => m.id === streamingAssistantId)) {
								return prev;
							}
							return [
								...prev,
								{
									id: streamingAssistantId,
									notebookId: notebook.id,
									role: "assistant" as const,
									content: "",
									citations: [],
									createdAt: new Date().toISOString(),
								},
							];
						});
						setAskStatus(null);
					}
				},
				onToken: (token) => {
					setAskStatus(null);
					setMessages((prev) => {
						const existing = prev.find((m) => m.id === streamingAssistantId);
						if (!existing) {
							return [
								...prev,
								{
									id: streamingAssistantId,
									notebookId: notebook.id,
									role: "assistant" as const,
									content: token,
									citations: [],
									createdAt: new Date().toISOString(),
								},
							];
						}
						return prev.map((message) =>
							message.id === streamingAssistantId
								? { ...message, content: message.content + token }
								: message,
						);
					});
				},
			});
			setMessages((prev) => [
				...prev.filter(
					(message) =>
						message.id !== optimisticUser.id &&
						message.id !== streamingAssistantId,
				),
				result.userMessage,
				result.assistantMessage,
			]);
		} catch (err) {
			setMessages((prev) =>
				prev.filter(
					(message) =>
						message.id !== optimisticUser.id &&
						message.id !== streamingAssistantId,
				),
			);
			setQuestion(trimmed);
			setChatError(
				err instanceof Error ? err.message : "Failed to ask question",
			);
		} finally {
			setIsAsking(false);
			setAskStatus(null);
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

	const breadcrumbItems = [{ label: "Knowledge Workbench", to: "/notebooks" }];

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
			setSourceExpanded(false);
			playbackResumeRef.current = { seconds: 0, playing: false };
			setPlayback({ seconds: 0, playing: false });
			setSeekCommand(null);
		},
		sourceExpanded,
		onToggleSourceExpanded: () => setSourceExpanded((open) => !open),
		resumeAt: playbackResumeRef.current.seconds,
		resumePlaying: playbackResumeRef.current.playing,
		onPlaybackSync: (seconds: number, playing: boolean) => {
			playbackResumeRef.current = { seconds, playing };
			setPlayback({ seconds, playing });
		},
		playbackTime: playback.seconds,
		playbackPlaying: playback.playing,
		onSeekPlayback: (seconds: number) => {
			seekNonceRef.current += 1;
			setSeekCommand({
				nonce: seekNonceRef.current,
				seconds,
				play: true,
			});
			setPlayback((prev) => ({ ...prev, seconds }));
			playbackResumeRef.current = {
				seconds,
				playing: true,
			};
		},
		selectedSource,
	};

	const studioProps = {
		readyCount,
		focus: studioFocus,
		onFocusChange: setStudioFocus,
		artifacts,
		activeArtifact,
		activeArtifactId,
		activeArtifactLoading,
		generatingType,
		error: studioError,
		onGenerate: (type: StudioArtifactType) => void handleGenerateArtifact(type),
		onSelectArtifact: (id: string) => {
			setStudioError(null);
			setActiveArtifactId(id);
		},
		activeCitationKey,
		onCitationClick: (c: MessageCitation, ownerId: string) =>
			void openArtifactCitation(c, ownerId),
	};

	const sourcesSidebarProps = {
		sources,
		selectedSourceId: viewer?.id,
		busySourceId,
		sourceError,
		onOpenSource: (id: string) => void openSource(id),
		onReindex: (id: string) => void handleReindex(id),
		onDelete: (id: string) => void handleDeleteSource(id),
		onAddClick: openAddSources,
	};

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
						<span
							className="hidden text-muted-foreground sm:inline"
							aria-hidden
						>
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
				{sourceExpanded && (viewer || viewerLoading) ? (
					<section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--workspace-bg)]">
						{viewer?.videoId &&
						(viewer.type === "youtube" || viewer.type === "vtt") ? (
							<>
								<div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-foreground">
											{viewer.title}
										</p>
										<p className="truncate text-xs text-muted-foreground">
											Video across left + center · transcript on the right
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<Button
											type="button"
											variant="outline"
											size="xs"
											onClick={() => setSourceExpanded(false)}
										>
											Dock
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label="Close focused video"
											onClick={() => {
												setViewer(null);
												setCitationNav([]);
												setActiveCitationKey(null);
												setSourceExpanded(false);
												playbackResumeRef.current = {
													seconds: 0,
													playing: false,
												};
												setPlayback({ seconds: 0, playing: false });
												setSeekCommand(null);
											}}
										>
											<X />
										</Button>
									</div>
								</div>
								<div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
									<YoutubePlayerStage
										videoId={viewer.videoId}
										resumeAt={playbackResumeRef.current.seconds}
										resumePlaying={playbackResumeRef.current.playing}
										seekCommand={seekCommand}
										onPlaybackSync={(seconds, playing) => {
											playbackResumeRef.current = { seconds, playing };
											setPlayback({ seconds, playing });
										}}
										framed
										className="w-full max-w-6xl shadow-lg"
									/>
								</div>
							</>
						) : (
							<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border bg-card">
								<SourceViewerPanel
									source={viewer}
									loading={viewerLoading}
									citations={citationNav}
									activeCitationKey={activeCitationKey}
									onNavigateCitation={(c) => void navigateCitation(c)}
									onClose={() => {
										setViewer(null);
										setCitationNav([]);
										setActiveCitationKey(null);
										setSourceExpanded(false);
									}}
									expanded
									onToggleExpanded={() => setSourceExpanded(false)}
									resumeAt={playbackResumeRef.current.seconds}
									resumePlaying={playbackResumeRef.current.playing}
									onPlaybackSync={(seconds, playing) => {
										playbackResumeRef.current = { seconds, playing };
										setPlayback({ seconds, playing });
									}}
								/>
							</div>
						)}
					</section>
				) : (
					<>
						<ResizablePanel
							side="left"
							label="Sources"
							width={layout.leftWidth}
							collapsed={layout.leftCollapsed}
							onWidthChange={layout.setLeftWidth}
							onCollapsedChange={layout.setLeftCollapsed}
						>
							<SourcesSidebar {...sourcesSidebarProps} />
						</ResizablePanel>

						<Tabs
							value={centerMode}
							onValueChange={(value) => setCenterMode(value as CenterMode)}
							className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 bg-[var(--workspace-bg)]"
						>
							<div className="border-b border-border bg-card px-3 pt-2">
								<TabsList className="h-9 justify-start bg-transparent p-0">
									<TabsTrigger value="chat" className="text-xs">
										Chat
									</TabsTrigger>
									<TabsTrigger value="studio" className="text-xs">
										Studio
									</TabsTrigger>
								</TabsList>
							</div>

							{/* Both panes stay mounted so chat scroll survives a switch. */}
							<TabsContent
								value="chat"
								className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
							>
								<ChatPanel
									messages={messages}
									isAsking={isAsking}
									askStatus={askStatus}
									question={question}
									onQuestionChange={setQuestion}
									onAsk={() => void runAsk(question)}
									onRegenerate={handleRegenerate}
									chatError={chatError}
									readyCount={readyCount}
									sourceCount={sources.length}
									onAddSources={openAddSources}
									activeCitationKey={activeCitationKey}
									onCitationClick={(citation, messageId) =>
										void openCitation(citation, messageId)
									}
									onFollowUpAsk={(followUp) => {
										setQuestion(followUp);
										void runAsk(followUp);
									}}
								/>
							</TabsContent>
							<TabsContent
								value="studio"
								className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
							>
								<StudioPanel {...studioProps} />
							</TabsContent>
						</Tabs>
					</>
				)}

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
					<SourcesSidebar {...sourcesSidebarProps} />
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

			<AddSourceSheet
				open={addSourcesOpen}
				onOpenChange={setAddSourcesOpen}
				onSubmit={async (payload) => {
					await handleAddSource(payload);
					setAddSourcesOpen(false);
					setMobileSourcesOpen(false);
				}}
				isAdding={isAddingSource}
				error={sourceError}
			/>
		</div>
	);
}
