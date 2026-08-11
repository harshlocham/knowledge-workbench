import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sources } from "#/db/schema/sources.ts";
import { friendlyIngestError } from "#/lib/ingest/limits.ts";
import { spreadHitsAcrossSources } from "#/lib/rag/diversify-by-source.ts";
import type { ScoredChunkHit } from "#/lib/rag/diversify-hits.ts";
import {
	type BriefEvidenceInput,
	generateResearchBrief,
} from "#/lib/rag/generate-research-brief.server.ts";
import { retrieveHybridNotebookChunks } from "#/lib/rag/hybrid-retrieve.server.ts";
import {
	getArtifactRowById,
	updateArtifactById,
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
const MIN_EVIDENCE_PER_SOURCE = 4;
const MAX_EVIDENCE_PER_SOURCE = 12;

/**
 * An even share of the evidence budget per source. Combined with round-robin
 * selection this means one source can only exceed its share once the others
 * have run out of relevant chunks — i.e. only when it genuinely holds most of
 * the evidence. A lone source still gets enough excerpts for a useful brief.
 */
function evidenceBudgetPerSource(sourceCount: number) {
	const share = Math.ceil(MAX_EVIDENCE_TOTAL / Math.max(sourceCount, 1));
	return Math.min(
		MAX_EVIDENCE_PER_SOURCE,
		Math.max(MIN_EVIDENCE_PER_SOURCE, share),
	);
}

export async function listReadyNotebookSources(notebookId: string) {
	return db
		.select({ id: sources.id, title: sources.title })
		.from(sources)
		.where(
			and(eq(sources.notebookId, notebookId), eq(sources.status, "ready")),
		);
}

async function collectBriefEvidence(options: {
	notebookId: string;
	ownerId: string;
	focus?: string;
	sourceTitleById: Map<string, string>;
}): Promise<BriefEvidenceInput[]> {
	const focus = options.focus?.trim();
	const probes = focus ? [focus, ...BRIEF_PROBES] : [...BRIEF_PROBES];

	const lists = await Promise.all(
		probes.map(async (probe) => {
			try {
				const { hits } = await retrieveHybridNotebookChunks({
					notebookId: options.notebookId,
					ownerId: options.ownerId,
					question: probe,
					finalLimit: PROBE_FINAL_LIMIT,
				});
				return hits;
			} catch (error) {
				console.error("[research-brief] probe failed", probe, error);
				return [] as ScoredChunkHit[];
			}
		}),
	);

	const spread = spreadHitsAcrossSources(lists, {
		maxPerSource: evidenceBudgetPerSource(options.sourceTitleById.size),
		maxTotal: MAX_EVIDENCE_TOTAL,
	});

	return spread.map((hit, i) => ({
		index: i + 1,
		chunkId: hit.chunkId,
		sourceId: hit.sourceId,
		sourceTitle: options.sourceTitleById.get(hit.sourceId) ?? "Untitled source",
		text: hit.text,
		locator: hit.locator,
	}));
}

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

	const markFailed = async (message: string) => {
		try {
			const row = await getArtifactRowById(artifactId);
			if (!row) return;
			await updateArtifactById(
				artifactId,
				{ status: "failed", errorMessage: message },
				row,
			);
		} catch (error) {
			console.error("[research-brief] failed to record failure", error);
		}
	};

	try {
		const readySources = await listReadyNotebookSources(options.notebookId);
		if (readySources.length === 0) {
			await markFailed(
				"This notebook has no ready sources yet. Add and index at least one source, then generate again.",
			);
			return;
		}

		const sourceTitleById = new Map(
			readySources.map((source) => [source.id, source.title]),
		);

		const evidence = await collectBriefEvidence({
			notebookId: options.notebookId,
			ownerId: options.ownerId,
			focus: options.focus,
			sourceTitleById,
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

		await updateArtifactById(
			artifactId,
			{
				status: "ready",
				title: brief.title,
				content: brief.content,
				citations: brief.citations,
				errorMessage: null,
			},
			row,
		);
	} catch (error) {
		console.error("[research-brief] generation failed", error);
		await markFailed(
			friendlyIngestError(error, "Failed to generate research brief"),
		);
	}
}
