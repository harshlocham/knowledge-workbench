import type { ChunkLocator } from "#/db/schema/chunks.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import { sectionLabel } from "#/lib/locator.ts";
import { formatChunkClock } from "#/lib/rag/chunk-vtt.ts";

/** One numbered excerpt handed to the model. Shared by every artifact generator. */
export type ArtifactEvidence = {
	/** 1-based number shown to the model. */
	index: number;
	chunkId: string;
	sourceId: string;
	sourceTitle: string;
	text: string;
	locator: ChunkLocator;
};

const MAX_QUOTE_LENGTH = 280;
const DEFAULT_MAX_EVIDENCE_PER_ITEM = 4;

/** Human-readable position hint appended to an excerpt header. */
export function evidenceLabel(locator: ChunkLocator) {
	if (typeof locator.tStart === "number") {
		return typeof locator.tEnd === "number"
			? ` @ ${formatChunkClock(locator.tStart)}–${formatChunkClock(locator.tEnd)}`
			: ` @ ${formatChunkClock(locator.tStart)}`;
	}
	if (typeof locator.page === "number") {
		return ` (p. ${locator.page})`;
	}
	const section = sectionLabel(locator);
	if (section) {
		return ` — ${section}`;
	}
	return "";
}

/**
 * Model-written `[n]` markers are discarded and rebuilt from the validated
 * evidence indexes, so rendered numbers can never point at missing evidence.
 */
export function stripCitationMarkers(text: string) {
	return text
		.replace(/\[\d+\]/g, "")
		.replace(/\s+([.,;:!?])/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export function withCitationMarkers(text: string, numbers: number[]) {
	return numbers.length > 0
		? `${text} ${numbers.map((n) => `[${n}]`).join(" ")}`
		: text;
}

export type ValidatedEvidence = {
	/** Evidence indexes that exist, de-duplicated and capped. */
	indexes: number[];
	/** Distinct sources those indexes come from. */
	sourceIds: Set<string>;
};

export type CitationMapper = {
	/**
	 * Checks the model's evidence indexes without numbering them. Numbering is
	 * deferred so an item we later drop leaves no orphan citation behind.
	 */
	validate(
		indexes: number[] | undefined,
		maxPerItem?: number,
	): ValidatedEvidence;
	/** Turns a kept item's evidence into rendered citation numbers. */
	commit(indexes: number[]): number[];
	/** Only the evidence actually referenced by kept items, in citation order. */
	citations(): MessageCitation[];
};

/**
 * Maps model-supplied evidence indexes onto `MessageCitation`s, which is what
 * gives artifacts the same jump-to-source behaviour as chat answers.
 */
export function createCitationMapper(
	evidence: ArtifactEvidence[],
): CitationMapper {
	const evidenceByIndex = new Map(evidence.map((item) => [item.index, item]));
	const citationNumberByEvidence = new Map<number, number>();
	const citations: MessageCitation[] = [];

	return {
		validate(indexes, maxPerItem = DEFAULT_MAX_EVIDENCE_PER_ITEM) {
			const validated: number[] = [];
			const sourceIds = new Set<string>();

			for (const index of [...new Set(indexes ?? [])]) {
				if (validated.length >= maxPerItem) break;
				const item = evidenceByIndex.get(index);
				if (!item) continue;
				validated.push(index);
				sourceIds.add(item.sourceId);
			}

			return { indexes: validated, sourceIds };
		},

		commit(indexes) {
			const numbers: number[] = [];

			for (const index of indexes) {
				const item = evidenceByIndex.get(index);
				if (!item) continue;

				const existing = citationNumberByEvidence.get(index);
				if (existing !== undefined) {
					numbers.push(existing);
					continue;
				}

				const citationNumber = citations.length + 1;
				citationNumberByEvidence.set(index, citationNumber);
				citations.push({
					chunkId: item.chunkId,
					sourceId: item.sourceId,
					sourceTitle: item.sourceTitle,
					quote: item.text.slice(0, MAX_QUOTE_LENGTH),
					locator: item.locator,
					citationNumber,
				});
				numbers.push(citationNumber);
			}

			return numbers;
		},

		citations() {
			return citations;
		},
	};
}
