import type { ChunkLocator } from "#/db/schema/chunks.ts";

export const HEADING_PATH_SEPARATOR = " › ";

/**
 * The section of a web page a chunk sits in, as a readable path.
 *
 * This is the URL equivalent of a PDF page number or a transcript timestamp,
 * so it is shared by the prompt-side evidence labels and the citation UI.
 */
export function sectionLabel(locator: ChunkLocator | null | undefined) {
	if (!locator) return undefined;

	const path = locator.headingPath;
	if (path && path.length > 0) {
		return path.join(HEADING_PATH_SEPARATOR);
	}
	return locator.heading || undefined;
}

/** Deep-link into a page section when the heading carried a real DOM id. */
export function sectionUrl(
	url: string | null | undefined,
	anchor: string | null | undefined,
) {
	if (!url) return undefined;
	if (!anchor) return url;

	try {
		const target = new URL(url);
		target.hash = anchor;
		return target.toString();
	} catch {
		return url;
	}
}
