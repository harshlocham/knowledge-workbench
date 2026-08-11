import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/**
 * A heading kept with enough detail to build chunk locators.
 *
 * `offset` points at the `#` marker of this heading inside the final `content`
 * string, so it can be compared directly against chunk `startOffset`s.
 */
export type ArticleHeading = {
	text: string;
	level: number;
	/** DOM id, when the page provides one. Used as a deep-link anchor. */
	id?: string;
	offset: number;
};

/** Signals used to decide whether an extraction candidate is worth keeping. */
export type ExtractionStats = {
	chars: number;
	/** Characters contributed by text inside `<a>` elements. */
	linkChars: number;
	/** Non-empty lines, a rough proxy for how much real block content survived. */
	blockCount: number;
};

export type ExtractedText = {
	text: string;
	headings: string[];
	headingDetails: ArticleHeading[];
	stats: ExtractionStats;
};

export type ExtractedUrlArticle = {
	title: string;
	canonicalUrl: string;
	content: string;
	excerpt: string | null;
	siteName: string | null;
	/** Flat heading list, kept for existing consumers. */
	headings: string[];
	headingDetails: ArticleHeading[];
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function normalizeUrl(input: string) {
	const trimmed = input.trim();
	const withProtocol = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	return new URL(withProtocol).toString();
}

/* -------------------------------------------------------------------------- */
/* Chrome detection                                                            */
/* -------------------------------------------------------------------------- */

/** Never article content, regardless of where they appear. */
const SKIP_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"template",
	"svg",
	"math",
	"iframe",
	"canvas",
	"audio",
	"video",
	"object",
	"embed",
	"dialog",
	"form",
	"menu",
	"nav",
	"select",
	"option",
	"optgroup",
	"input",
	"textarea",
	"progress",
	"meter",
]);

const CHROME_ROLES = new Set([
	"navigation",
	"banner",
	"contentinfo",
	"search",
	"dialog",
	"tablist",
	"menu",
]);

/** Longer button text is more likely to be prose than a UI affordance. */
const UI_BUTTON_TEXT_LIMIT = 60;
const ASIDE_LINK_DENSITY_LIMIT = 0.5;

function collapse(value: string | null | undefined) {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function linkDensity(el: Element) {
	const total = collapse(el.textContent).length;
	if (total === 0) return 1;

	let linked = 0;
	for (const anchor of Array.from(el.querySelectorAll("a"))) {
		linked += collapse(anchor.textContent).length;
	}
	return Math.min(linked / total, 1);
}

/**
 * `header`/`footer` are page chrome at the document level but are also used for
 * an article's own title block, so only drop the ones that carry no heading and
 * do not belong to an article.
 */
function isPageChrome(el: Element) {
	if (el.closest("article")) return false;
	return el.querySelector("h1, h2, h3, h4, h5, h6") === null;
}

function labelsAControl(el: Element) {
	return (
		el.hasAttribute("for") ||
		el.querySelector("input, select, textarea") !== null
	);
}

function isUiButton(el: Element) {
	const text = collapse(el.textContent);
	if (!text) return true;
	if (
		el.hasAttribute("aria-expanded") ||
		el.hasAttribute("aria-controls") ||
		el.hasAttribute("aria-pressed")
	) {
		return true;
	}
	return text.length <= UI_BUTTON_TEXT_LIMIT;
}

/**
 * Conservative on purpose: `aside`, `button` and `label` carry real content on
 * some pages, so they are dropped only on evidence that they are UI.
 */
function shouldSkip(el: Element, tag: string) {
	if (SKIP_TAGS.has(tag)) return true;
	if (el.getAttribute("aria-hidden") === "true") return true;
	if (el.hasAttribute("hidden")) return true;

	const role = collapse(el.getAttribute("role")).toLowerCase();
	if (role && CHROME_ROLES.has(role)) return true;

	if (tag === "header" || tag === "footer") return isPageChrome(el);
	if (tag === "label") return labelsAControl(el);
	if (tag === "button" || role === "button") return isUiButton(el);
	if (tag === "aside") return linkDensity(el) > ASIDE_LINK_DENSITY_LIMIT;

	return false;
}

/* -------------------------------------------------------------------------- */
/* Structural plain-text emitter                                               */
/* -------------------------------------------------------------------------- */

const PARAGRAPH_TAGS = new Set([
	"p",
	"div",
	"section",
	"article",
	"main",
	"header",
	"footer",
	"aside",
	"figure",
	"figcaption",
	"address",
	"details",
	"summary",
	"dl",
	"dt",
	"dd",
	"hr",
	"fieldset",
]);

function codeLanguage(el: Element) {
	const code = el.querySelector("code");
	const attribute =
		el.getAttribute("data-language") ?? code?.getAttribute("data-language");
	if (attribute?.trim()) return attribute.trim();

	const source = `${el.getAttribute("class") ?? ""} ${
		code?.getAttribute("class") ?? ""
	}`;
	return /(?:language|lang)-([\w#+.-]+)/.exec(source)?.[1] ?? "";
}

/**
 * Syntax highlighters render each line as its own block element, so newlines
 * live in the markup rather than in `textContent`. When line elements are
 * present the sample is rebuilt from them, which also drops the annotations and
 * affordances highlighters interleave between lines (error overlays, "copy",
 * "run in playground"). Everything is scoped to `<code>` so language chips
 * outside it are left behind.
 */
function preText(el: Element) {
	const scope = el.querySelector("code") ?? el;
	const lines = Array.from(scope.querySelectorAll("div, p")).filter(
		(line) => line.querySelector("div, p") === null,
	);
	if (lines.length > 1) {
		return lines.map((line) => line.textContent ?? "").join("\n");
	}

	return scope.textContent ?? el.textContent ?? "";
}

function needsSpaceBetween(previous: string, next: string) {
	if (/\s/.test(previous)) return false;
	if (/^[.,;:!?)\]}%»”’]/.test(next)) return false;
	if (/[([{$«“‘#/]$/.test(previous)) return false;
	return true;
}

/**
 * Flattens an element to plain text while keeping the structure a reader (and a
 * language model) needs: heading markers, verbatim code, list markers, table
 * cell separators and quote markers.
 *
 * Offsets are the point of this design. Text is normalized as it is appended
 * and never rewritten afterwards, so every recorded heading offset indexes the
 * returned string exactly. Only trailing whitespace is stripped at the end,
 * which cannot move an earlier offset.
 */
function elementToPlainText(root: Element): ExtractedText {
	const out: string[] = [];
	const headingDetails: ArticleHeading[] = [];

	let length = 0;
	/** `Infinity` until the first write, which suppresses leading blank lines. */
	let trailingNewlines = Number.POSITIVE_INFINITY;
	let pendingNewlines = 0;
	let pendingPrefix = "";
	let lastChar = "";
	let quoteDepth = 0;
	let anchorDepth = 0;
	let linkChars = 0;

	function pushRaw(value: string) {
		if (!value) return;
		out.push(value);
		length += value.length;
		trailingNewlines = 0;
		lastChar = value.slice(-1);
	}

	function ensureNewlines(count: number) {
		if (trailingNewlines >= count) return;
		const needed = count - trailingNewlines;
		out.push("\n".repeat(needed));
		length += needed;
		trailingNewlines += needed;
		lastChar = "\n";
	}

	function requestBreak(lines: number) {
		pendingNewlines = Math.max(pendingNewlines, lines);
	}

	/** Opens a line for content written with `pushRaw` rather than `writeText`. */
	function startBlock(lines: number) {
		ensureNewlines(Math.max(lines, pendingNewlines));
		pendingNewlines = 0;
		pendingPrefix = "";
	}

	function writeText(value: string) {
		if (!value) return;

		if (pendingNewlines > 0) {
			ensureNewlines(pendingNewlines);
			pendingNewlines = 0;
		}

		if (trailingNewlines > 0) {
			pushRaw("> ".repeat(quoteDepth) + pendingPrefix);
			pendingPrefix = "";
		} else if (needsSpaceBetween(lastChar, value)) {
			pushRaw(" ");
		}

		pushRaw(value);
		if (anchorDepth > 0) {
			linkChars += value.length;
		}
	}

	function walkChildren(el: Element, listDepth: number) {
		for (const child of Array.from(el.childNodes)) {
			walk(child as unknown as Node, listDepth);
		}
	}

	function walkList(el: Element, ordered: boolean, listDepth: number) {
		const outerBreak = listDepth === 0 ? 2 : 1;
		requestBreak(outerBreak);

		let ordinal = Number.parseInt(el.getAttribute("start") ?? "1", 10);
		if (!Number.isFinite(ordinal)) ordinal = 1;

		for (const child of Array.from(el.children)) {
			const childTag = child.tagName.toLowerCase();
			if (childTag !== "li") {
				walk(child as unknown as Node, listDepth);
				continue;
			}
			if (shouldSkip(child, childTag)) continue;

			startBlock(1);
			pendingPrefix = `${"  ".repeat(listDepth)}${
				ordered ? `${ordinal++}. ` : "- "
			}`;
			walkChildren(child, listDepth + 1);
		}

		requestBreak(outerBreak);
	}

	function walkTable(el: Element, listDepth: number) {
		requestBreak(2);

		for (const row of Array.from(el.querySelectorAll("tr"))) {
			if (shouldSkip(row, "tr")) continue;

			const cells = Array.from(row.children).filter((cell) => {
				const cellTag = cell.tagName.toLowerCase();
				return cellTag === "td" || cellTag === "th";
			});
			if (cells.length === 0) continue;

			startBlock(1);
			cells.forEach((cell, index) => {
				if (index > 0) pushRaw(" | ");
				walkChildren(cell, listDepth);
			});
		}

		requestBreak(2);
	}

	function walkPre(el: Element) {
		const code = preText(el).replace(/^\n+/, "").replace(/\s+$/, "");
		if (!code) return;

		startBlock(2);
		const language = codeLanguage(el);
		pushRaw(`\`\`\`${language}\n${code}\n\`\`\``);
		requestBreak(2);
	}

	function walkHeading(el: Element, level: number) {
		const text = collapse(el.textContent);
		if (!text) return;

		startBlock(2);
		const offset = length;
		pushRaw(`${"#".repeat(level)} ${text}`);
		headingDetails.push({
			text,
			level,
			id: el.getAttribute("id")?.trim() || undefined,
			offset,
		});
		requestBreak(2);
	}

	function walk(node: Node, listDepth: number) {
		if (node.nodeType === TEXT_NODE) {
			writeText(collapse(node.textContent));
			return;
		}
		if (node.nodeType !== ELEMENT_NODE) return;

		const el = node as Element;
		const tag = el.tagName.toLowerCase();
		if (shouldSkip(el, tag)) return;

		if (tag === "br") {
			requestBreak(1);
			return;
		}

		if (/^h[1-6]$/.test(tag)) {
			walkHeading(el, Number(tag.slice(1)));
			return;
		}

		if (tag === "pre") {
			walkPre(el);
			return;
		}

		if (tag === "ul" || tag === "ol") {
			walkList(el, tag === "ol", listDepth);
			return;
		}

		if (tag === "table") {
			walkTable(el, listDepth);
			return;
		}

		if (tag === "blockquote") {
			requestBreak(2);
			quoteDepth += 1;
			walkChildren(el, listDepth);
			quoteDepth -= 1;
			requestBreak(2);
			return;
		}

		if (tag === "a") {
			anchorDepth += 1;
			walkChildren(el, listDepth);
			anchorDepth -= 1;
			return;
		}

		if (PARAGRAPH_TAGS.has(tag)) {
			requestBreak(2);
			walkChildren(el, listDepth);
			requestBreak(2);
			return;
		}

		walkChildren(el, listDepth);
	}

	walk(root as unknown as Node, 0);

	const text = out.join("").replace(/\s+$/, "");
	const blockCount = text
		.split("\n")
		.filter((line) => line.trim().length > 0).length;

	return {
		text,
		headings: headingDetails.map((heading) => heading.text),
		headingDetails,
		stats: { chars: text.length, linkChars, blockCount },
	};
}

/** Flatten an HTML fragment. Used for Readability output, which is a string. */
export function htmlToPlainText(html: string): ExtractedText {
	// linkedom needs a full document shell; a bare <body> fragment leaves content outside body.
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	return elementToPlainText(document.body as unknown as Element);
}

/* -------------------------------------------------------------------------- */
/* Candidate selection                                                         */
/* -------------------------------------------------------------------------- */

const FALLBACK_CONTENT_SELECTORS = [
	"article",
	"[role='main']",
	"main",
	".article--viewer_content",
	".article--viewer",
	".entry-content",
	".post-content",
	".article_content",
	"#content",
	".content",
];

/** Below this, a Readability result is treated as a stub worth second-guessing. */
const MIN_ARTICLE_CHARS = 500;
/** Above this share of link text, a candidate reads as navigation. */
const MAX_ARTICLE_LINK_DENSITY = 0.35;

function candidateLinkDensity(stats: ExtractionStats) {
	return stats.chars > 0 ? stats.linkChars / stats.chars : 1;
}

/**
 * Prefer long, prose-heavy, structured candidates. Link text is discounted
 * twice (subtracted, then applied as a density penalty) because navigation is
 * the failure mode this is guarding against.
 */
function candidateScore(extracted: ExtractedText) {
	const { chars, linkChars, blockCount } = extracted.stats;
	if (chars === 0) return 0;

	const proseChars = Math.max(chars - linkChars, 0);
	const density = candidateLinkDensity(extracted.stats);
	const structure = 1 + Math.min(blockCount, 20) / 20;
	return proseChars * (1 - density) * structure;
}

function isGoodEnough(extracted: ExtractedText) {
	return (
		extracted.stats.chars >= MIN_ARTICLE_CHARS &&
		candidateLinkDensity(extracted.stats) <= MAX_ARTICLE_LINK_DENSITY
	);
}

function fallbackCandidates(document: Document): ExtractedText[] {
	const candidates: ExtractedText[] = [];
	const seen = new Set<Element>();

	for (const selector of FALLBACK_CONTENT_SELECTORS) {
		const el = document.querySelector(selector);
		if (!el || seen.has(el)) continue;
		seen.add(el);
		candidates.push(elementToPlainText(el));
	}

	if (document.body) {
		candidates.push(elementToPlainText(document.body));
	}

	return candidates;
}

function resolveCanonicalUrl(document: Document, url: string) {
	const canonical =
		document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
		url;
	try {
		return new URL(canonical, url).toString();
	} catch {
		return url;
	}
}

/**
 * Extract readable article content from an HTML document.
 *
 * Readability is tried first, but its result is accepted only when it looks
 * like an article rather than a navigation stub; otherwise the selector
 * candidates compete on the same score and the best one wins.
 */
export function extractArticleFromHtml(
	rawHtml: string,
	url: string,
): ExtractedUrlArticle {
	// The one and only line-ending normalization in the URL pipeline.
	const html = rawHtml.replace(/\r\n/g, "\n");

	const { document } = parseHTML(html);
	// Readability rewrites the document it is given, so read metadata first.
	const documentTitle = collapse(document.title);
	const canonicalUrl = resolveCanonicalUrl(document as Document, url);

	// Readability uses document.baseURI for relative URL resolution.
	Object.defineProperty(document, "baseURI", {
		configurable: true,
		value: url,
	});
	if (!document.documentURI) {
		Object.defineProperty(document, "documentURI", {
			configurable: true,
			value: url,
		});
	}

	// `keepClasses` keeps `language-*` hints on code blocks; we read classes but
	// never render Readability's HTML, so there is no styling risk.
	const article = new Readability(document as unknown as Document, {
		keepClasses: true,
	}).parse();
	const title = collapse(article?.title) || documentTitle;
	const excerpt = collapse(article?.excerpt) || null;
	const siteName = collapse(article?.siteName) || null;

	const candidates: ExtractedText[] = [];
	if (article?.content?.trim()) {
		candidates.push(htmlToPlainText(article.content));
	} else if (article?.textContent?.trim()) {
		const text = collapse(article.textContent);
		candidates.push({
			text,
			headings: [],
			headingDetails: [],
			stats: { chars: text.length, linkChars: 0, blockCount: 1 },
		});
	}

	let best = candidates[0];

	// Tutorial / docs sites often fail Readability outright, and portal pages
	// make it return a wall of links. Both are handled the same way.
	if (!best || !isGoodEnough(best)) {
		// Re-parse: the document above was consumed by Readability.
		const { document: pristine } = parseHTML(html);
		candidates.push(...fallbackCandidates(pristine as Document));

		best = candidates.reduce((winner, candidate) =>
			candidateScore(candidate) > candidateScore(winner) ? candidate : winner,
		);
	}

	if (!best?.text.trim()) {
		throw new Error("Could not extract readable article content from URL");
	}

	return {
		title: title || canonicalUrl,
		canonicalUrl,
		content: best.text,
		excerpt,
		siteName,
		headings: best.headings,
		headingDetails: best.headingDetails,
	};
}

/** Fetch a page and extract readable article content via Mozilla Readability. */
export async function extractUrlArticle(
	rawUrl: string,
): Promise<ExtractedUrlArticle> {
	const url = normalizeUrl(rawUrl);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20_000);

	let response: Response;
	try {
		response = await fetch(url, {
			redirect: "follow",
			signal: controller.signal,
			headers: {
				"User-Agent":
					"KnowledgeWorkbenchBot/1.0 (+https://localhost; research assistant)",
				Accept: "text/html,application/xhtml+xml",
			},
		});
	} catch (error) {
		clearTimeout(timeout);
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error("Timed out while fetching the URL");
		}
		throw new Error(
			error instanceof Error ? error.message : "Failed to fetch URL",
		);
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		throw new Error(`Failed to fetch URL (HTTP ${response.status})`);
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (
		contentType &&
		!contentType.includes("text/html") &&
		!contentType.includes("application/xhtml")
	) {
		throw new Error("URL did not return an HTML page");
	}

	const html = await response.text();
	return extractArticleFromHtml(html, response.url || url);
}

export { normalizeUrl };
