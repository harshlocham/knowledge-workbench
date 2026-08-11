/**
 * Inspect what a real URL becomes once indexed.
 *
 * Usage:
 *   bun run inspect:url -- <url> [--full] [--chunks]
 *
 * Runs the exact ingestion path a URL source takes (fetch → extract → chunk)
 * without touching the database, so extraction quality and citation locators
 * can be checked against a live page.
 */

import { chunkArticleText } from "#/lib/rag/chunk-article.ts";
import { extractUrlArticle } from "#/lib/rag/extract-url.server.ts";
import { sectionLabel, sectionUrl } from "#/lib/locator.ts";

const args = process.argv.slice(2);
const url = args.find((arg) => !arg.startsWith("--"));
const showFull = args.includes("--full");
const showChunks = args.includes("--chunks");

if (!url) {
	console.error("Usage: bun run inspect:url -- <url> [--full] [--chunks]");
	process.exit(1);
}

/** Noise that used to leak in from theme pickers, cookie bars and nav rails. */
const CHROME_SIGNALS = [
	"Site Colours",
	"Code Font",
	"Skip to content",
	"Accept all cookies",
	"Subscribe to our newsletter",
	"Table of contents",
];

const article = await extractUrlArticle(url);
const chunks = chunkArticleText(article.content, {
	url: article.canonicalUrl,
	headings: article.headingDetails,
});

console.log("─".repeat(72));
console.log(`title         ${article.title}`);
console.log(`canonicalUrl  ${article.canonicalUrl}`);
console.log(`siteName      ${article.siteName ?? "—"}`);
console.log(`chars         ${article.content.length}`);
console.log(`headings      ${article.headingDetails.length}`);
console.log(`chunks        ${chunks.length}`);

const codeFences = (article.content.match(/^```/gm) ?? []).length / 2;
const listItems = (article.content.match(/^(?:\s*)(?:-|\d+\.) /gm) ?? []).length;
const tableRows = (article.content.match(/^[^\n]+ \| [^\n]+$/gm) ?? []).length;
console.log(
	`structure     ${codeFences} code blocks, ${listItems} list items, ${tableRows} table rows`,
);

const withAnchor = chunks.filter((chunk) => chunk.locator.anchor).length;
const withHeading = chunks.filter((chunk) => chunk.locator.heading).length;
console.log(
	`locators      ${withHeading}/${chunks.length} chunks have a section, ${withAnchor} have an anchor`,
);

const found = CHROME_SIGNALS.filter((signal) =>
	article.content.includes(signal),
);
console.log(
	`chrome        ${found.length === 0 ? "none detected" : `LEAKED: ${found.join(", ")}`}`,
);

console.log("─".repeat(72));
console.log("Outline");
for (const heading of article.headingDetails) {
	const indent = "  ".repeat(Math.max(heading.level - 1, 0));
	const anchor = heading.id ? `  #${heading.id}` : "";
	console.log(`${indent}${heading.text}${anchor}`);
}

if (showChunks) {
	console.log("─".repeat(72));
	console.log("Chunks");
	for (const chunk of chunks) {
		const { startOffset, endOffset, anchor } = chunk.locator;
		const exact =
			article.content.slice(startOffset, endOffset) === chunk.content;
		console.log(
			`\n[${chunk.chunkIndex}] ${startOffset}–${endOffset} ${
				exact ? "offsets ok" : "OFFSET MISMATCH"
			}`,
		);
		console.log(`     section  ${sectionLabel(chunk.locator) ?? "—"}`);
		console.log(
			`     link     ${sectionUrl(article.canonicalUrl, anchor) ?? "—"}`,
		);
		console.log(`     ${chunk.content.slice(0, 160).replace(/\n/g, " ⏎ ")}…`);
	}
}

console.log("─".repeat(72));
console.log(showFull ? article.content : `${article.content.slice(0, 2000)}…`);
