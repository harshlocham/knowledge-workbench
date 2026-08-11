import type { ArtifactContent } from "#/db/schema/artifacts.ts";
import type { ChunkLocator } from "#/db/schema/chunks.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import type {
	ArtifactStatus,
	ArtifactType,
} from "#/features/studio/artifacts.types.ts";
import { sectionUrl } from "#/lib/locator.ts";

export type PublicCitation = {
	citationNumber: number;
	sourceTitle: string;
	quote?: string;
	locator?: ChunkLocator;
	/** Safe external link only — never a private storage URI. */
	externalUrl?: string;
};

/**
 * What the unauthenticated share page is allowed to see. Deliberately omits
 * ownerId, notebookId, artifact id, shareToken, chunkId and sourceId.
 */
export type PublicArtifactDTO = {
	title: string;
	type: ArtifactType;
	updatedAt: string;
	content: ArtifactContent;
	citations: PublicCitation[];
};

export type ShareableArtifactRow = {
	title: string;
	type: ArtifactType;
	status: ArtifactStatus;
	content: ArtifactContent | null;
	citations: MessageCitation[] | null;
	updatedAt: Date | string;
	shareToken?: string | null;
	ownerId?: string;
	notebookId?: string;
	id?: string;
	errorMessage?: string | null;
};

/** Pure gate used by createArtifactShare and unit tests. */
export function assertArtifactShareable(status: ArtifactStatus) {
	if (status === "pending") {
		throw new Error(
			"This artifact is still generating. Wait until it is ready before sharing.",
		);
	}
	if (status === "failed") {
		throw new Error(
			"This artifact failed to generate and cannot be shared. Regenerate it first.",
		);
	}
	if (status !== "ready") {
		throw new Error("Only ready artifacts can be shared.");
	}
}

/**
 * Builds an external open-link for public citations. Private uploads (PDF, VTT)
 * intentionally return undefined so the share page never becomes a file CDN.
 */
export function publicCitationExternalUrl(
	locator: ChunkLocator | null | undefined,
): string | undefined {
	if (!locator) return undefined;

	if (locator.videoId) {
		const seconds =
			typeof locator.tStart === "number"
				? Math.max(
						0,
						Math.floor(
							locator.tStart >= 100_000
								? locator.tStart / 1000
								: locator.tStart,
						),
					)
				: undefined;
		const base = `https://www.youtube.com/watch?v=${encodeURIComponent(locator.videoId)}`;
		return seconds !== undefined ? `${base}&t=${seconds}s` : base;
	}

	if (locator.url) {
		return sectionUrl(locator.url, locator.anchor);
	}

	return undefined;
}

export function toPublicCitation(citation: MessageCitation): PublicCitation {
	const locator = citation.locator
		? {
				page: citation.locator.page,
				url: citation.locator.url,
				heading: citation.locator.heading,
				headingPath: citation.locator.headingPath,
				anchor: citation.locator.anchor,
				videoId: citation.locator.videoId,
				tStart: citation.locator.tStart,
				tEnd: citation.locator.tEnd,
			}
		: undefined;

	return {
		citationNumber: citation.citationNumber ?? 0,
		sourceTitle: citation.sourceTitle?.trim() || "Source",
		quote: citation.quote,
		locator,
		externalUrl: publicCitationExternalUrl(citation.locator),
	};
}

export function toPublicArtifactDTO(
	row: ShareableArtifactRow,
): PublicArtifactDTO {
	if (!row.content) {
		throw new Error("Shared artifact has no content");
	}

	return {
		title: row.title,
		type: row.type,
		updatedAt:
			typeof row.updatedAt === "string"
				? row.updatedAt
				: row.updatedAt.toISOString(),
		content: row.content,
		citations: (row.citations ?? []).map(toPublicCitation),
	};
}

/** Ensures a public DTO never leaks private fields (used by tests). */
export function publicDtoHasNoPrivateFields(dto: Record<string, unknown>) {
	const forbidden = [
		"ownerId",
		"notebookId",
		"shareToken",
		"id",
		"errorMessage",
		"chunkId",
		"sourceId",
	];
	for (const key of forbidden) {
		if (key in dto) return false;
	}
	for (const citation of (dto.citations as PublicCitation[] | undefined) ??
		[]) {
		const record = citation as unknown as Record<string, unknown>;
		if ("chunkId" in record || "sourceId" in record) return false;
	}
	return true;
}
