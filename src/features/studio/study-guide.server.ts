import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import { collectArtifactEvidence } from "#/lib/rag/artifact-evidence.server.ts";
import { generateStudyGuide } from "#/lib/rag/generate-study-guide.server.ts";
import { markArtifactFailed } from "./artifact-generation.server.ts";
import { listReadyNotebookSources } from "./artifact-sources.server.ts";
import {
	getArtifactRowById,
	markArtifactReady,
} from "./artifacts.store.server.ts";

/**
 * A study guide needs teaching material — definitions, dependencies, worked
 * examples, gotchas — rather than the brief's claim-and-conclusion evidence, so
 * it runs its own probes through the existing retrieval pipeline.
 */
const STUDY_GUIDE_PROBES = [
	"core concepts, definitions and what each one means",
	"key terminology, jargon and acronyms explained",
	"how the concepts relate to, build on or depend on each other",
	"prerequisites, assumed background knowledge and required setup",
	"worked examples, code walkthroughs and step-by-step demonstrations",
	"common mistakes, gotchas, misconceptions and debugging advice",
	"rules, constraints, defaults and facts worth memorising",
] as const;

const PROBE_FINAL_LIMIT = 8;
/** Larger than a brief's budget: a guide covers a syllabus, not a thesis. */
const MAX_EVIDENCE_TOTAL = 40;

/**
 * Runs generation for an existing pending artifact and moves it to `ready` or
 * `failed`. Safe to call from a background job: it never throws.
 */
export async function runStudyGuideGeneration(options: {
	artifactId: string;
	notebookId: string;
	ownerId: string;
	notebookTitle: string;
	focus?: string;
}) {
	const { artifactId } = options;

	try {
		const readySources = await listReadyNotebookSources(options.notebookId);
		if (readySources.length === 0) {
			await markArtifactFailed(
				artifactId,
				"This notebook has no ready sources yet. Add and index at least one source, then generate again.",
			);
			return;
		}

		const sourceTitleById = new Map(
			readySources.map((source) => [source.id, source.title]),
		);

		const focus = options.focus?.trim();
		const evidence = await collectArtifactEvidence({
			notebookId: options.notebookId,
			ownerId: options.ownerId,
			probes: focus ? [focus, ...STUDY_GUIDE_PROBES] : STUDY_GUIDE_PROBES,
			sourceTitleById,
			maxTotal: MAX_EVIDENCE_TOTAL,
			probeFinalLimit: PROBE_FINAL_LIMIT,
			label: "study-guide",
		});

		const guide = await generateStudyGuide({
			evidence,
			readySourceCount: sourceTitleById.size,
			notebookTitle: options.notebookTitle,
			focus: options.focus,
		});

		const row = await getArtifactRowById(artifactId);
		if (!row) {
			return;
		}

		await markArtifactReady(artifactId, {
			title: guide.title,
			content: guide.content,
			citations: guide.citations,
		});
	} catch (error) {
		console.error("[study-guide] generation failed", error);
		await markArtifactFailed(
			artifactId,
			friendlyIngestError(error, "Failed to generate study guide"),
		);
	}
}
