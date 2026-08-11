import { chunkPlainText, type TextChunk } from "#/lib/rag/chunk.ts";
import type { ArticleHeading } from "#/lib/rag/extract-url.server.ts";

/**
 * Reuse the shared plain-text chunker, then attach the URL and the section the
 * chunk sits in.
 *
 * Headings come from extraction rather than from re-parsing the flattened text,
 * so a chunk keeps the heading level and DOM id needed to label a citation and
 * to link back into the live page.
 */
export function chunkArticleText(
	content: string,
	options: { url: string; headings?: readonly ArticleHeading[] },
): TextChunk[] {
	const headings = [...(options.headings ?? [])].sort(
		(a, b) => a.offset - b.offset,
	);

	return chunkPlainText(content).map((chunk) => {
		const heading = headingAt(headings, chunk.locator.startOffset ?? 0);

		return {
			...chunk,
			locator: {
				...chunk.locator,
				url: options.url,
				heading: heading?.text,
				headingPath: heading ? headingPath(headings, heading) : undefined,
				anchor: heading?.id,
			},
		};
	});
}

/** The last heading that opens at or before `offset`. */
function headingAt(headings: ArticleHeading[], offset: number) {
	let match: ArticleHeading | undefined;
	for (const heading of headings) {
		if (heading.offset > offset) break;
		match = heading;
	}
	return match;
}

/** Walk back through progressively shallower headings to build the ancestry. */
function headingPath(headings: ArticleHeading[], heading: ArticleHeading) {
	const path = [heading.text];
	let level = heading.level;

	for (let i = headings.indexOf(heading) - 1; i >= 0; i--) {
		const candidate = headings[i];
		if (!candidate || candidate.level >= level) continue;
		path.unshift(candidate.text);
		level = candidate.level;
		if (level === 1) break;
	}

	return path;
}
