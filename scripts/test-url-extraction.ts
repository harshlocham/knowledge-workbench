/**
 * URL extraction + chunk locator tests.
 *
 * Usage:
 *   bun run test:url
 *
 * Guards the representation URL sources are indexed as: article prose survives,
 * page chrome does not, structure (headings / code / lists / tables) is legible,
 * and chunk offsets still index the exact string persisted as
 * `sources.metadata.content`.
 *
 * Fixtures are synthetic so assertions describe behaviour, not one site's wording.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chunkArticleText } from "#/lib/rag/chunk-article.ts";
import { chunkPlainText } from "#/lib/rag/chunk.ts";
import {
	extractArticleFromHtml,
	htmlToPlainText,
} from "#/lib/rag/extract-url.server.ts";

const FIXTURES = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"url-extraction",
);

function fixture(name: string) {
	return readFileSync(join(FIXTURES, `${name}.html`), "utf8");
}

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
	try {
		fn();
		passed += 1;
		console.log(`  ok   ${name}`);
	} catch (error) {
		failures.push(name);
		const message = error instanceof Error ? error.message : String(error);
		console.log(`  FAIL ${name}`);
		console.log(`       ${message.split("\n").join("\n       ")}`);
	}
}

function group(name: string) {
	console.log(`\n${name}`);
}

/** Every heading offset must land on the marker line for that heading. */
function assertHeadingOffsetsAreExact(article: {
	content: string;
	headingDetails: Array<{ text: string; level: number; offset: number }>;
}) {
	for (const heading of article.headingDetails) {
		const at = article.content.slice(
			heading.offset,
			heading.offset + heading.level + 1 + heading.text.length,
		);
		assert.equal(
			at,
			`${"#".repeat(heading.level)} ${heading.text}`,
			`heading "${heading.text}" offset ${heading.offset} does not point at its marker`,
		);
	}
}

// ---------------------------------------------------------------------------

group("docs page (navigation, sidebar, theme controls)");

{
	const article = extractArticleFromHtml(
		fixture("docs-page"),
		"https://docs.example.com/guide/query-caching",
	);
	const { content } = article;

	test("article prose survives", () => {
		assert.match(content, /cache stores the result of every resolved query/);
		assert.match(content, /Invalidation marks entries as stale/);
	});

	test("theme / settings widget text does not survive", () => {
		assert.doesNotMatch(content, /Site Colours/i);
		assert.doesNotMatch(content, /Code Font/i);
		assert.doesNotMatch(content, /System Mono/i);
		assert.doesNotMatch(content, /Toggle contrast/i);
	});

	test("navigation, header, footer and dialog chrome do not survive", () => {
		assert.doesNotMatch(content, /Skip to content/i);
		assert.doesNotMatch(content, /API Reference/);
		assert.doesNotMatch(content, /Copyright 2019/);
		assert.doesNotMatch(content, /We use cookies/i);
		assert.doesNotMatch(content, /Press slash to focus/i);
		assert.doesNotMatch(content, /Placeholder row/i);
	});

	test("sidebar link list does not survive", () => {
		assert.doesNotMatch(content, /Deployment/);
		assert.doesNotMatch(content, /Mutations/);
	});

	test("heading hierarchy is retained with levels", () => {
		// Readability demotes an in-article h1 to h2, so relative depth is what
		// survives, not the original absolute level.
		const levels = article.headingDetails.map((h) => `${h.level}:${h.text}`);
		assert.deepEqual(levels, [
			"2:Query Caching",
			"2:Cache Keys",
			"3:Key Stability",
			"3:Key Collisions",
			"2:Invalidation",
		]);
	});

	test("heading DOM ids are retained", () => {
		const ids = article.headingDetails.map((h) => h.id);
		assert.deepEqual(ids, [
			"query-caching",
			"cache-keys",
			"key-stability",
			"key-collisions",
			"invalidation",
		]);
	});

	test("flat headings list is kept for compatibility", () => {
		assert.deepEqual(
			article.headings,
			article.headingDetails.map((h) => h.text),
		);
	});

	test("heading offsets point at the exact marker in content", () => {
		assertHeadingOffsetsAreExact(article);
	});

	test("canonical url is resolved", () => {
		assert.equal(
			article.canonicalUrl,
			"https://docs.example.com/guide/query-caching",
		);
	});
}

// ---------------------------------------------------------------------------

group("article page (lists, links, blockquote)");

{
	const article = extractArticleFromHtml(
		fixture("article-page"),
		"https://notes.example.org/review-practice",
	);
	const { content } = article;

	test("article prose survives", () => {
		assert.match(content, /Code review used to be a gate/);
		assert.match(content, /size limit did most of the work/);
	});

	test("an h1 duplicating the page title is removed by Readability", () => {
		// Worth pinning because it is the common case on blogs, and it means the
		// lede has no section: everything downstream must tolerate a bare chunk.
		assert.equal(article.headingDetails.at(0)?.text, "What We Changed");

		const lede = chunkArticleText(content, {
			url: article.canonicalUrl,
			headings: article.headingDetails,
		}).at(0);
		assert.equal(lede?.locator.heading, undefined);
		assert.equal(lede?.locator.headingPath, undefined);
		assert.equal(lede?.locator.anchor, undefined);
		assert.equal(lede?.locator.url, article.canonicalUrl);
	});

	test("site navigation does not survive", () => {
		assert.doesNotMatch(content, /^\s*Archive\s*$/m);
		assert.doesNotMatch(content, /Feed/);
	});

	test("ordered list items stay distinguishable", () => {
		assert.match(content, /^1\. Reviews were requested from a draft/m);
		assert.match(content, /^2\. Any change over four hundred lines/m);
		assert.match(content, /^3\. Reviewers were assigned by area/m);
	});

	test("unordered list items stay distinguishable", () => {
		assert.match(content, /^- Time from request to first substantive/m);
		assert.match(content, /^- Total review comments per change/m);
		assert.match(content, /^- Revert rate did not change/m);
	});

	test("blockquote is marked", () => {
		assert.match(content, /^> A review that arrives after the author/m);
	});

	test("link text is kept and hrefs are dropped", () => {
		assert.match(content, /latency report/);
		assert.doesNotMatch(content, /https:\/\/example\.org/);
	});

	test("link text does not swallow the surrounding sentence", () => {
		assert.match(content, /See the latency report for the measurements/);
	});
}

// ---------------------------------------------------------------------------

group("developer docs (code blocks, tables)");

{
	const article = extractArticleFromHtml(
		fixture("dev-docs"),
		"https://docs.example.com/api/create-cache",
	);
	const { content } = article;

	test("code blocks preserve line breaks", () => {
		assert.match(
			content,
			/export function createCache\(options: CacheOptions\): Cache \{\n/,
		);
		assert.match(content, /\n\t\tget\(key\) \{\n/);
	});

	test("code blocks are fenced with their language", () => {
		assert.match(content, /```ts\n/);
		assert.match(content, /```tsx\n/);
	});

	test("html entities inside code are decoded", () => {
		assert.match(content, /new Map<string, Entry>\(\)/);
		assert.match(content, /<CacheProvider value=\{cache\}>/);
	});

	test("inline code stays inline", () => {
		assert.match(content, /Call createCache once\s+per application/);
	});

	test("table cells stay distinguishable", () => {
		assert.match(content, /^Option \| Type \| Default \| Description$/m);
		assert.match(content, /^maxEntries \| number \| 500 \| /m);
		assert.match(content, /^staleTime \| number \| 0 \| /m);
	});

	test("breadcrumb navigation does not survive", () => {
		assert.doesNotMatch(content, /^\s*API \| Cache\s*$/m);
	});
}

// ---------------------------------------------------------------------------

group("walker chrome rules");

{
	test("a prose aside is kept, a link-heavy aside is dropped", () => {
		const kept = htmlToPlainText(
			`<aside><p>Invalidation is asynchronous and does not await refetches.</p></aside>`,
		);
		assert.match(kept.text, /Invalidation is asynchronous/);

		const dropped = htmlToPlainText(
			`<aside><a href="/a">Installation</a> <a href="/b">Routing</a> <a href="/c">Testing</a></aside>`,
		);
		assert.equal(dropped.text, "");
	});

	test("a header inside an article is kept, a page header is dropped", () => {
		const kept = htmlToPlainText(
			`<article><header><h1 id="t">Article Title</h1></header><p>Body copy.</p></article>`,
		);
		assert.match(kept.text, /# Article Title/);
		assert.equal(kept.headingDetails.at(0)?.id, "t");

		const dropped = htmlToPlainText(
			`<header><a href="/">Brand</a><p>Tagline</p></header><p>Body copy.</p>`,
		);
		assert.equal(dropped.text, "Body copy.");
	});

	test("a footer carrying a heading is kept", () => {
		const kept = htmlToPlainText(
			`<footer><h2>Related reading</h2><p>Further material on caching.</p></footer>`,
		);
		assert.match(kept.text, /Further material on caching/);
	});

	test("a UI button is dropped and a prose button is kept", () => {
		const dropped = htmlToPlainText(
			`<div><button type="button" aria-expanded="false">Show more</button></div>`,
		);
		assert.equal(dropped.text, "");

		const kept = htmlToPlainText(
			`<div><button type="button">${"Accept the revised data processing terms for this workspace".padEnd(
				70,
				".",
			)}</button></div>`,
		);
		assert.match(kept.text, /Accept the revised data processing terms/);
	});

	test("a control label is dropped and a bare label is kept", () => {
		const dropped = htmlToPlainText(
			`<div><label for="x">Site Colours</label><select id="x"><option>Dark</option></select></div>`,
		);
		assert.equal(dropped.text, "");

		const kept = htmlToPlainText(`<div><label>Definition of done</label></div>`);
		assert.match(kept.text, /Definition of done/);
	});

	test("aria-hidden and hidden subtrees are dropped", () => {
		const result = htmlToPlainText(
			`<div aria-hidden="true">Tooltip</div><div hidden>Offscreen</div><p>Body copy.</p>`,
		);
		assert.equal(result.text, "Body copy.");
	});

	test("highlighted code is rebuilt from its line elements", () => {
		// Shiki / Prism style markup: no newlines in the DOM, one block per line,
		// plus a language chip and a playground link that are not part of the code.
		const result = htmlToPlainText(
			`<pre class="shiki" data-language="ts"><div class="language-id">ts</div>` +
				`<div class="code-container"><code>` +
				`<div class="line"><span>function padLeft(padding: number) {</span></div>` +
				`<div class="line"><span>  return padding;</span></div>` +
				`<div class="line"><span>}</span></div>` +
				`</code><a href="/play">Try</a></div></pre>`,
		);

		assert.equal(
			result.text,
			"```ts\nfunction padLeft(padding: number) {\n  return padding;\n}\n```",
		);
	});

	test("a plain pre keeps its own whitespace", () => {
		const result = htmlToPlainText(
			`<pre><code class="language-py">def add(a, b):\n    return a + b</code></pre>`,
		);
		assert.equal(result.text, "```py\ndef add(a, b):\n    return a + b\n```");
	});

	test("nested lists are indented", () => {
		const result = htmlToPlainText(
			`<ul><li>Outer<ul><li>Inner</li></ul></li></ul>`,
		);
		assert.match(result.text, /^- Outer$/m);
		assert.match(result.text, /^ {2}- Inner$/m);
	});
}

// ---------------------------------------------------------------------------

group("normalization and offsets");

for (const name of ["docs-page", "article-page", "dev-docs"]) {
	const article = extractArticleFromHtml(
		fixture(name),
		"https://docs.example.com/page",
	);
	const { content } = article;

	test(`${name}: output has normalized line endings`, () => {
		assert.doesNotMatch(content, /\r/);
	});

	test(`${name}: output has no leading or trailing whitespace`, () => {
		assert.equal(content, content.trim());
	});

	test(`${name}: output has no runs of blank lines`, () => {
		assert.doesNotMatch(content, /\n{3,}/);
	});

	test(`${name}: chunker normalization is the identity on extracted content`, () => {
		// `chunkPlainText` re-normalizes internally; if that were not a no-op every
		// chunk offset would be shifted relative to `sources.metadata.content`.
		assert.equal(content.replace(/\r\n/g, "\n").trim(), content);
	});

	test(`${name}: chunk offsets index the persisted content exactly`, () => {
		const chunks = chunkArticleText(content, {
			url: article.canonicalUrl,
			headings: article.headingDetails,
		});
		assert.ok(chunks.length > 0, "expected at least one chunk");

		for (const chunk of chunks) {
			const { startOffset, endOffset } = chunk.locator;
			assert.equal(
				typeof startOffset,
				"number",
				`chunk ${chunk.chunkIndex} has no startOffset`,
			);
			assert.equal(
				typeof endOffset,
				"number",
				`chunk ${chunk.chunkIndex} has no endOffset`,
			);
			assert.equal(
				content.slice(startOffset, endOffset),
				chunk.content,
				`chunk ${chunk.chunkIndex} offsets do not match its content`,
			);
		}
	});

	test(`${name}: chunkArticleText only adds locator fields`, () => {
		const base = chunkPlainText(content);
		const enriched = chunkArticleText(content, {
			url: article.canonicalUrl,
			headings: article.headingDetails,
		});

		assert.equal(enriched.length, base.length);
		for (const [index, chunk] of enriched.entries()) {
			assert.equal(chunk.content, base[index]?.content);
			assert.equal(chunk.locator.startOffset, base[index]?.locator.startOffset);
			assert.equal(chunk.locator.endOffset, base[index]?.locator.endOffset);
			assert.equal(chunk.locator.url, article.canonicalUrl);
		}
	});
}

// ---------------------------------------------------------------------------

group("chunk heading locators");

{
	const article = extractArticleFromHtml(
		fixture("docs-page"),
		"https://docs.example.com/guide/query-caching",
	);
	const chunks = chunkArticleText(article.content, {
		url: article.canonicalUrl,
		headings: article.headingDetails,
	});

	test("every chunk resolves to a heading", () => {
		for (const chunk of chunks) {
			assert.ok(
				chunk.locator.heading,
				`chunk ${chunk.chunkIndex} has no heading`,
			);
		}
	});

	test("a chunk's heading is the nearest heading at or before it", () => {
		for (const chunk of chunks) {
			const start = chunk.locator.startOffset ?? 0;
			const expected = [...article.headingDetails]
				.filter((heading) => heading.offset <= start)
				.at(-1);
			assert.equal(chunk.locator.heading, expected?.text);
		}
	});

	test("anchor comes from the heading DOM id", () => {
		for (const chunk of chunks) {
			const expected = article.headingDetails.find(
				(heading) => heading.text === chunk.locator.heading,
			);
			assert.equal(chunk.locator.anchor, expected?.id);
		}
		assert.ok(
			chunks.some((chunk) => chunk.locator.anchor === "cache-keys"),
			"expected at least one chunk anchored to a real DOM id",
		);
	});

	test("heading path walks up through parent levels", () => {
		// Built directly so real h1/h2/h3 levels are exercised; Readability
		// demotes h1 and would flatten the top of the tree.
		const filler = "Sentences of ordinary prose about the topic at hand. ";
		const extracted = htmlToPlainText(
			`<h1 id="guide">Guide</h1><p>${filler.repeat(20)}</p>
			 <h2 id="routing">Routing</h2><p>${filler.repeat(20)}</p>
			 <h3 id="loaders">Loaders</h3><p>${filler.repeat(20)}</p>`,
		);
		const built = chunkArticleText(extracted.text, {
			url: "https://example.com/guide",
			headings: extracted.headingDetails,
		});

		const deep = built.find((chunk) => chunk.locator.heading === "Loaders");
		assert.ok(deep, "expected a chunk under the level 3 heading");
		assert.deepEqual(deep.locator.headingPath, ["Guide", "Routing", "Loaders"]);
		assert.equal(deep.locator.anchor, "loaders");

		const shallow = built.find((chunk) => chunk.locator.heading === "Routing");
		assert.deepEqual(shallow?.locator.headingPath, ["Guide", "Routing"]);
	});

	test("headings are optional for callers that have none", () => {
		const chunks = chunkArticleText(article.content, {
			url: article.canonicalUrl,
		});
		assert.ok(chunks.length > 0);
		assert.equal(chunks[0]?.locator.heading, undefined);
		assert.equal(chunks[0]?.locator.anchor, undefined);
		assert.equal(chunks[0]?.locator.url, article.canonicalUrl);
	});
}

// ---------------------------------------------------------------------------

group("extraction quality gate");

{
	const navHeavy = `<!doctype html><html><head><title>Portal</title></head><body>
		<main>
			<div class="links">
				${Array.from(
					{ length: 40 },
					(_, i) =>
						`<p><a href="/topic-${i}">Topic number ${i} in the directory</a></p>`,
				).join("")}
			</div>
		</main>
		<div class="entry-content">
			<h1 id="the-real-article">The Real Article</h1>
			<p>${"This paragraph is genuine prose that carries no links at all and should win the quality comparison against a wall of directory links. ".repeat(6)}</p>
		</div>
	</body></html>`;

	test("a link-heavy candidate loses to a prose candidate", () => {
		const article = extractArticleFromHtml(
			navHeavy,
			"https://portal.example.com/",
		);
		assert.match(article.content, /genuine prose that carries no links/);
		assert.doesNotMatch(article.content, /Topic number 12/);
	});

	test("link density is reported for a link-heavy fragment", () => {
		const linky = htmlToPlainText(
			`<div><p><a href="/a">alpha</a> <a href="/b">bravo</a></p></div>`,
		);
		assert.ok(
			linky.stats.linkChars / Math.max(linky.stats.chars, 1) > 0.8,
			"expected a high link density",
		);
	});

	test("empty documents still fail loudly", () => {
		assert.throws(
			() =>
				extractArticleFromHtml(
					"<!doctype html><html><body><nav><a href='/'>Home</a></nav></body></html>",
					"https://example.com/",
				),
			/readable article content/i,
		);
	});
}

// ---------------------------------------------------------------------------

console.log(
	`\n${passed} passed, ${failures.length} failed${
		failures.length > 0 ? `\n  - ${failures.join("\n  - ")}` : ""
	}`,
);

process.exit(failures.length > 0 ? 1 : 0);
