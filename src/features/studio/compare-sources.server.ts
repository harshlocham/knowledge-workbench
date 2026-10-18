import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import { collectArtifactEvidence } from "#/lib/rag/artifact-evidence.server.ts";
import { generateCompareSources } from "#/lib/rag/generate-compare-sources.server.ts";
import { markArtifactFailed } from "./artifact-generation.server.ts";
import { listReadyNotebookSources } from "./artifact-sources.server.ts";
import {
	getArtifactRowById,
	markArtifactReady,
} from "./artifacts.store.server.ts";

/**
 * Comparison-oriented probes. Keep this list short: each probe is a full hybrid
 * retrieval, and the evidence budget already spreads hits across sources.
 */
const COMPARE_SOURCES_PROBES = [
	"central claims, thesis and main arguments",
	"definitions of key terms and how each source defines them",
	"recommended practices, workflows and approaches",
	"implementation approaches, techniques and examples",
	"limitations, tradeoffs, caveats and constraints",
	"disagreements, contradictions and competing explanations",
	"concrete examples, walkthroughs and case studies",
] as const;

const PROBE_FINAL_LIMIT = 8;
const MAX_EVIDENCE_TOTAL = 40;

/**
 * Runs generation for an existing pending artifact and moves it to `ready` or
 * `failed`. Safe to call from a background job: it never throws.
 */
export async function runCompareSourcesGeneration(options: {
	artifactId: string;
	notebookId: string;
	ownerId: string;
	notebookTitle: string;
	focus?: string;
}) {
	const { artifactId } = options;

	try {
		const readySources = await listReadyNotebookSources(options.notebookId);
		if (readySources.length < 2) {
			await markArtifactFailed(
				artifactId,
				"Compare Sources requires at least two ready sources.",
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
			probes: focus
				? [focus, ...COMPARE_SOURCES_PROBES]
				: COMPARE_SOURCES_PROBES,
			sourceTitleById,
			maxTotal: MAX_EVIDENCE_TOTAL,
			probeFinalLimit: PROBE_FINAL_LIMIT,
			label: "compare-sources",
		});

		const comparison = await generateCompareSources({
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
			title: comparison.title,
			content: comparison.content,
			citations: comparison.citations,
		});
	} catch (error) {
		console.error("[compare-sources] generation failed", error);
		await markArtifactFailed(
			artifactId,
			friendlyIngestError(error, "Failed to generate source comparison"),
		);
	}
}
