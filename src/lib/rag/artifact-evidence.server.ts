import {
	type ArtifactEvidence,
	evidenceLabel,
} from "#/lib/rag/artifact-citations.ts";
import { spreadHitsAcrossSources } from "#/lib/rag/diversify-by-source.ts";
import type { ScoredChunkHit } from "#/lib/rag/diversify-hits.ts";
import { retrieveHybridNotebookChunks } from "#/lib/rag/hybrid-retrieve.server.ts";

export type { ArtifactEvidence };

const DEFAULT_PROBE_FINAL_LIMIT = 8;
const DEFAULT_MAX_EVIDENCE_TOTAL = 32;
const MIN_EVIDENCE_PER_SOURCE = 4;
const MAX_EVIDENCE_PER_SOURCE = 12;

/**
 * An even share of the evidence budget per source. Combined with round-robin
 * selection this means one source can only exceed its share once the others
 * have run out of relevant chunks — i.e. only when it genuinely holds most of
 * the evidence. A lone source still gets enough excerpts for a useful artifact.
 */
function evidenceBudgetPerSource(sourceCount: number, maxTotal: number) {
	const share = Math.ceil(maxTotal / Math.max(sourceCount, 1));
	return Math.min(
		MAX_EVIDENCE_PER_SOURCE,
		Math.max(MIN_EVIDENCE_PER_SOURCE, share),
	);
}

/**
 * An artifact needs evidence about the notebook as a whole, not one question,
 * so we run complementary probes through the existing retrieval pipeline and
 * merge the results. Retrieval behaviour itself is untouched.
 */
export async function collectArtifactEvidence(options: {
	notebookId: string;
	ownerId: string;
	probes: readonly string[];
	sourceTitleById: Map<string, string>;
	maxTotal?: number;
	probeFinalLimit?: number;
	/** Logged when a probe fails, to tell artifact types apart in the output. */
	label?: string;
}): Promise<ArtifactEvidence[]> {
	const maxTotal = options.maxTotal ?? DEFAULT_MAX_EVIDENCE_TOTAL;
	const label = options.label ?? "artifact-evidence";

	const lists = await Promise.all(
		options.probes.map(async (probe) => {
			try {
				const { hits } = await retrieveHybridNotebookChunks({
					notebookId: options.notebookId,
					ownerId: options.ownerId,
					question: probe,
					finalLimit: options.probeFinalLimit ?? DEFAULT_PROBE_FINAL_LIMIT,
				});
				return hits;
			} catch (error) {
				console.error(`[${label}] probe failed`, probe, error);
				return [] as ScoredChunkHit[];
			}
		}),
	);

	const spread = spreadHitsAcrossSources(lists, {
		maxPerSource: evidenceBudgetPerSource(
			options.sourceTitleById.size,
			maxTotal,
		),
		maxTotal,
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

/** The numbered evidence block every artifact prompt shares. */
export function formatEvidenceBlock(evidence: ArtifactEvidence[]) {
	return evidence
		.map(
			(item) =>
				`[${item.index}] "${item.sourceTitle}"${evidenceLabel(item.locator)}\n${item.text}`,
		)
		.join("\n\n");
}

/**
 * A convincing-looking artifact built from two excerpts is worse than an honest
 * failure, so generators refuse to run below their evidence floor.
 */
export function insufficientEvidenceError(
	count: number,
	artifactLabel: string,
) {
	if (count === 0) {
		return new Error(
			"No indexed evidence was found in this notebook. Add or re-index sources, then try again.",
		);
	}

	return new Error(
		`Only ${count} usable excerpt${count === 1 ? "" : "s"} could be retrieved, which is not enough for a trustworthy ${artifactLabel}. Add more sources (or longer ones) and try again.`,
	);
}
