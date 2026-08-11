import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import { collectArtifactEvidence } from "#/lib/rag/artifact-evidence.server.ts";
import { generateResearchBrief } from "#/lib/rag/generate-research-brief.server.ts";
import { markArtifactFailed } from "./artifact-generation.server.ts";
import { listReadyNotebookSources } from "./artifact-sources.server.ts";
import {
	getArtifactRowById,
	markArtifactReady,
} from "./artifacts.store.server.ts";

/**
 * A brief needs evidence about the notebook as a whole, not one question, so we
 * run a few complementary probes through the existing retrieval pipeline and
 * merge the results. Retrieval behaviour itself is untouched.
 */
const BRIEF_PROBES = [
	"main claims, findings and conclusions",
	"methods, data and evidence used to support the conclusions",
	"limitations, caveats, risks and unanswered questions",
	"disagreements, contradictions and competing explanations",
	"practical recommendations and next steps",
] as const;

const PROBE_FINAL_LIMIT = 8;
const MAX_EVIDENCE_TOTAL = 32;

/**
 * Runs generation for an existing pending artifact and moves it to `ready` or
 * `failed`. Safe to call from a background job: it never throws.
 */
export async function runResearchBriefGeneration(options: {
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
			probes: focus ? [focus, ...BRIEF_PROBES] : BRIEF_PROBES,
			sourceTitleById,
			maxTotal: MAX_EVIDENCE_TOTAL,
			probeFinalLimit: PROBE_FINAL_LIMIT,
			label: "research-brief",
		});

		const brief = await generateResearchBrief({
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
			title: brief.title,
			content: brief.content,
			citations: brief.citations,
		});
	} catch (error) {
		console.error("[research-brief] generation failed", error);
		await markArtifactFailed(
			artifactId,
			friendlyIngestError(error, "Failed to generate research brief"),
		);
	}
}
