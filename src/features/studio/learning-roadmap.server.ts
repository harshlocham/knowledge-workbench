import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import type { ArtifactEvidence } from "#/lib/rag/artifact-citations.ts";
import { collectArtifactEvidence } from "#/lib/rag/artifact-evidence.server.ts";
import { generateLearningRoadmap } from "#/lib/rag/generate-roadmap.server.ts";
import { markArtifactFailed } from "./artifact-generation.server.ts";
import { listReadyNotebookSources } from "./artifact-sources.server.ts";
import {
	getArtifactRowById,
	updateArtifactById,
} from "./artifacts.store.server.ts";

/**
 * A roadmap needs to know where the material starts, what it assumes and how
 * its topics depend on each other — ordering signal rather than the brief's
 * claim-and-conclusion evidence — so it runs its own probes through the
 * existing retrieval pipeline.
 */
const ROADMAP_PROBES = [
	"introduction, getting started and where to begin",
	"foundational concepts everything else builds on",
	"prerequisites, assumed background knowledge and required setup",
	"how the topics build on, extend or depend on each other",
	"core topics, terminology and techniques covered",
	"hands-on examples, exercises and practice steps",
	"advanced, later-stage or optional material",
	"recommended order, progression or next steps",
] as const;

const PROBE_FINAL_LIMIT = 8;
const MAX_EVIDENCE_TOTAL = 36;

/**
 * Retrieval returns evidence in relevance order, which hides the progression a
 * roadmap is built from. Grouping each source's excerpts together and putting
 * them in the order that source presents them (video timestamp, page number)
 * gives the model the sequencing signal the old transcript-walk had, without
 * touching retrieval itself. Groups stay in relevance order, so the most
 * relevant source still leads.
 */
function orderEvidenceForProgression(
	evidence: ArtifactEvidence[],
): ArtifactEvidence[] {
	const bySource = new Map<string, ArtifactEvidence[]>();
	for (const item of evidence) {
		const group = bySource.get(item.sourceId) ?? [];
		group.push(item);
		bySource.set(item.sourceId, group);
	}

	const positionOf = (item: ArtifactEvidence) =>
		item.locator.tStart ?? item.locator.page ?? 0;

	return (
		[...bySource.values()]
			// Sort is stable, so excerpts without a position keep their relevance order.
			.flatMap((group) =>
				[...group].sort((a, b) => positionOf(a) - positionOf(b)),
			)
			.map((item, i) => ({ ...item, index: i + 1 }))
	);
}

/**
 * Runs generation for an existing pending artifact and moves it to `ready` or
 * `failed`. Safe to call from a background job: it never throws.
 */
export async function runLearningRoadmapGeneration(options: {
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
		const retrieved = await collectArtifactEvidence({
			notebookId: options.notebookId,
			ownerId: options.ownerId,
			probes: focus ? [focus, ...ROADMAP_PROBES] : ROADMAP_PROBES,
			sourceTitleById,
			maxTotal: MAX_EVIDENCE_TOTAL,
			probeFinalLimit: PROBE_FINAL_LIMIT,
			label: "learning-roadmap",
		});

		const roadmap = await generateLearningRoadmap({
			evidence: orderEvidenceForProgression(retrieved),
			readySourceCount: sourceTitleById.size,
			notebookTitle: options.notebookTitle,
			focus: options.focus,
		});

		const row = await getArtifactRowById(artifactId);
		if (!row) {
			return;
		}

		await updateArtifactById(
			artifactId,
			{
				status: "ready",
				title: roadmap.title,
				content: roadmap.content,
				citations: roadmap.citations,
				errorMessage: null,
			},
			row,
		);
	} catch (error) {
		console.error("[learning-roadmap] generation failed", error);
		await markArtifactFailed(
			artifactId,
			friendlyIngestError(error, "Failed to generate learning roadmap"),
		);
	}
}
