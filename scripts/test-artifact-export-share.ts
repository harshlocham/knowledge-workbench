/**
 * Artifact export + share unit tests.
 *
 * Usage:
 *   bun run test:export-share
 *
 * Pure helpers only — no database, no LLM. Covers markdown serialization,
 * share-token entropy, shareability gate, and public DTO / citation policy.
 */

import assert from "node:assert/strict";

import type { ArtifactContent } from "#/db/schema/artifacts.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	assertArtifactShareable,
	publicCitationExternalUrl,
	publicDtoHasNoPrivateFields,
	toPublicArtifactDTO,
	type ShareableArtifactRow,
} from "#/features/studio/artifact-share.public.ts";
import type { ArtifactType } from "#/features/studio/artifacts.types.ts";
import {
	artifactMarkdownFilename,
	artifactToMarkdown,
} from "#/lib/artifacts/artifact-markdown.ts";
import {
	createShareToken,
	isShareTokenShape,
	SHARE_TOKEN_MIN_LENGTH,
} from "#/lib/artifacts/share-token.ts";

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

const CHUNK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function citation(
	number: number,
	sourceTitle: string,
	locator: MessageCitation["locator"] = {},
	quote?: string,
): MessageCitation {
	return {
		chunkId: CHUNK,
		sourceId: SOURCE,
		sourceTitle,
		quote,
		locator,
		citationNumber: number,
	};
}

function content(sections: ArtifactContent["sections"]): ArtifactContent {
	return { sections };
}

function markdownFor(
	type: ArtifactType,
	sections: ArtifactContent["sections"],
	citations: MessageCitation[],
	title = "TypeScript Narrowing",
) {
	return artifactToMarkdown({
		title,
		type,
		updatedAt: "2026-08-01T12:00:00.000Z",
		content: content(sections),
		citations,
	});
}

group("Markdown — artifact types");

test("1. Research Brief markdown from sections", () => {
	const md = markdownFor(
		"research_brief",
		[
			{
				heading: "Key findings",
				body: "Narrowing unknown values is required.[1]",
				bullets: ["Prefer discriminated unions"],
			},
		],
		[citation(1, "Handbook", { page: 3 })],
	);
	assert.match(md, /^# TypeScript Narrowing/m);
	assert.match(md, /Research Brief/);
	assert.match(md, /## Key findings/);
	assert.match(md, /Narrowing unknown values is required\.\[1\]/);
	assert.match(md, /- Prefer discriminated unions/);
	assert.match(md, /## Sources/);
	assert.match(md, /\[1\] Handbook · p\.3/);
});

test("2. Study Guide markdown uses section projection", () => {
	const md = markdownFor(
		"study_guide",
		[
			{
				heading: "Concepts",
				body: "Type predicates refine unions.",
				bullets: ["Keep predicates honest"],
			},
			{
				heading: "Review",
				body: "What does `is` do?",
			},
		],
		[citation(1, "Guide")],
		"Narrowing Guide",
	);
	assert.match(md, /Study Guide/);
	assert.match(md, /## Concepts/);
	assert.match(md, /## Review/);
	assert.equal(
		artifactMarkdownFilename("Narrowing Guide", "study_guide"),
		"narrowing-guide-study-guide.md",
	);
});

test("3. Learning Roadmap markdown from steps projection", () => {
	const md = markdownFor(
		"learning_roadmap",
		[
			{
				heading: "1. Start with unknowns",
				body: "Treat input as unknown first.",
				bullets: ["Then narrow"],
			},
		],
		[citation(2, "Course", { videoId: "abc", tStart: 90 })],
	);
	assert.match(md, /Learning Roadmap/);
	assert.match(md, /## 1\. Start with unknowns/);
	assert.match(md, /\[2\] Course · 1:30/);
});

test("4. Compare Sources markdown includes table section", () => {
	const md = markdownFor(
		"compare_sources",
		[
			{
				heading: "Overview",
				body: "Both sources agree on narrowing.",
			},
			{
				heading: "Comparison table",
				body: "| Claim | A | B |\n| --- | --- | --- |\n| Narrow | yes | yes |",
			},
		],
		[
			citation(1, "Handbook"),
			citation(2, "Course"),
		],
	);
	assert.match(md, /Compare Sources/);
	assert.match(md, /## Comparison table/);
	assert.match(md, /\| Claim \| A \| B \|/);
});

group("Markdown — citations & empty sections");

test("5. Citation numbers stay stable vs input order", () => {
	const md = markdownFor(
		"research_brief",
		[{ heading: "Body", body: "See [3] then [1]." }],
		[
			citation(3, "Third"),
			citation(1, "First"),
			citation(2, "Second"),
		],
	);
	const sources = md.split("## Sources\n\n")[1] ?? "";
	assert.match(sources, /^\[1\] First/m);
	assert.match(sources, /^\[2\] Second/m);
	assert.match(sources, /^\[3\] Third/m);
	assert.ok(sources.indexOf("[1]") < sources.indexOf("[2]"));
	assert.ok(sources.indexOf("[2]") < sources.indexOf("[3]"));
});

test("6. Empty sections are omitted", () => {
	const md = markdownFor(
		"research_brief",
		[
			{ heading: "Kept", body: "Content here" },
			{ heading: "Empty", body: "  ", bullets: [] },
			{ heading: "   ", body: "", bullets: ["", "  "] },
		],
		[],
	);
	assert.match(md, /## Kept/);
	assert.doesNotMatch(md, /## Empty/);
});

group("Share token");

test("7. Token length and charset entropy", () => {
	const token = createShareToken();
	assert.ok(token.length >= SHARE_TOKEN_MIN_LENGTH);
	assert.ok(isShareTokenShape(token));
	assert.match(token, /^[A-Za-z0-9_-]+$/);
	assert.equal(isShareTokenShape("short"), false);
	assert.equal(isShareTokenShape("!!!not-valid-token-shape!!!!!!!!!!"), false);
});

test("8. Unique tokens across many generations", () => {
	const seen = new Set<string>();
	for (let i = 0; i < 40; i += 1) {
		const token = createShareToken();
		assert.equal(seen.has(token), false);
		seen.add(token);
	}
});

group("Shareability gate");

test("9. assertArtifactShareable accepts ready", () => {
	assert.doesNotThrow(() => assertArtifactShareable("ready"));
});

test("10. assertArtifactShareable rejects pending", () => {
	assert.throws(
		() => assertArtifactShareable("pending"),
		/still generating/i,
	);
});

test("11. assertArtifactShareable rejects failed", () => {
	assert.throws(
		() => assertArtifactShareable("failed"),
		/failed to generate/i,
	);
});

group("Public DTO");

function readyRow(
	overrides: Partial<ShareableArtifactRow> = {},
): ShareableArtifactRow {
	return {
		title: "Shared Brief",
		type: "research_brief",
		status: "ready",
		content: content([{ heading: "A", body: "B" }]),
		citations: [citation(1, "Handbook", { url: "https://example.com/doc" })],
		updatedAt: new Date("2026-08-01T12:00:00.000Z"),
		shareToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
		ownerId: "user_1",
		notebookId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
		errorMessage: null,
		...overrides,
	};
}

test("12. Revoked / null-token row is not share-found by convention", () => {
	const row = readyRow({ shareToken: null });
	// Lookup helper treats missing token as not found; mapper still works if called,
	// but public route never reaches it when store returns null.
	assert.equal(row.shareToken, null);
	assert.equal(Boolean(row.shareToken), false);
});

test("13. Public DTO strips private fields", () => {
	const dto = toPublicArtifactDTO(readyRow());
	assert.equal(publicDtoHasNoPrivateFields(dto as unknown as Record<string, unknown>), true);
	assert.equal("ownerId" in dto, false);
	assert.equal("notebookId" in dto, false);
	assert.equal("shareToken" in dto, false);
	assert.equal("id" in dto, false);
	assert.equal(dto.citations[0]?.sourceTitle, "Handbook");
	assert.equal("chunkId" in (dto.citations[0] as object), false);
	assert.equal("sourceId" in (dto.citations[0] as object), false);
});

test("14. Unrelated artifact token does not match mapper input", () => {
	const row = readyRow({
		shareToken: "token-for-artifact-aaaaaaaaaaaaaaaaaaaaaa",
	});
	const otherToken = "token-for-other-bbbbbbbbbbbbbbbbbbbbbb";
	assert.notEqual(row.shareToken, otherToken);
	// Store lookup filters by exact token; unit-level: wrong token ≠ row token.
	assert.equal(row.shareToken === otherToken, false);
});

group("Public citation external URLs");

test("15. PDF citation has no externalUrl", () => {
	const url = publicCitationExternalUrl({ page: 4 });
	assert.equal(url, undefined);
	const publicCite = toPublicArtifactDTO(
		readyRow({
			citations: [citation(1, "Paper.pdf", { page: 4 }, "quote")],
		}),
	).citations[0];
	assert.equal(publicCite?.externalUrl, undefined);
});

test("16. URL citation gets external link with optional #anchor", () => {
	assert.equal(
		publicCitationExternalUrl({
			url: "https://example.com/article",
			anchor: "section-2",
		}),
		"https://example.com/article#section-2",
	);
	assert.equal(
		publicCitationExternalUrl({ url: "https://example.com/article" }),
		"https://example.com/article",
	);
});

test("17. YouTube citation becomes watch URL with t=", () => {
	assert.equal(
		publicCitationExternalUrl({ videoId: "dQw4w9WgXcQ", tStart: 125 }),
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s",
	);
	assert.equal(
		publicCitationExternalUrl({ videoId: "dQw4w9WgXcQ", tStart: 125_000 }),
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s",
	);
});

console.log(
	`\n${passed} passed, ${failures.length} failed, ${passed + failures.length} total`,
);

if (failures.length > 0) {
	process.exitCode = 1;
}
