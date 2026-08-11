import type { ArtifactContent } from "#/db/schema/artifacts.ts";
import type { ChunkLocator } from "#/db/schema/chunks.ts";
import type { MessageCitation } from "#/db/schema/messages.ts";
import {
	ARTIFACT_TYPE_LABELS,
	type ArtifactType,
} from "#/features/studio/artifacts.types.ts";
import { sectionLabel } from "#/lib/locator.ts";

export type ArtifactMarkdownInput = {
	title: string;
	type: ArtifactType;
	updatedAt: string;
	content: ArtifactContent | null;
	citations: MessageCitation[];
};

/** Compact clock for markdown footers (seconds or legacy ms). */
function formatClock(tStart: number): string {
	const seconds = Math.floor(tStart >= 100_000 ? tStart / 1000 : tStart);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	}
	return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function citationLocationSuffix(locator: ChunkLocator | null | undefined) {
	if (!locator) return "";

	const parts: string[] = [];
	if (locator.page != null) {
		parts.push(`p.${locator.page}`);
	}
	if (typeof locator.tStart === "number") {
		parts.push(formatClock(locator.tStart));
	}
	const section = sectionLabel(locator);
	if (section) {
		parts.push(section);
	}

	if (parts.length === 0) return "";
	// Page/time use " · "; section path uses " — " to match CitationChips.
	const pageOrTime = parts.filter(
		(part) => part.startsWith("p.") || /^\d/.test(part),
	);
	const sectionPart = section ? ` — ${section}` : "";
	const prefix = pageOrTime.length > 0 ? ` · ${pageOrTime.join(" · ")}` : "";
	return `${prefix}${sectionPart}`;
}

function formatGeneratedDate(iso: string) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

/**
 * Canonical artifact → Markdown serializer. Reads persisted sections and
 * citations only — never renumbers citations, never invents content.
 */
export function artifactToMarkdown(input: ArtifactMarkdownInput): string {
	const lines: string[] = [];
	const title = input.title.trim() || ARTIFACT_TYPE_LABELS[input.type];

	lines.push(`# ${title}`);
	lines.push("");
	lines.push(ARTIFACT_TYPE_LABELS[input.type]);
	lines.push("");
	lines.push(`Generated ${formatGeneratedDate(input.updatedAt)}`);
	lines.push("");

	const sections = input.content?.sections ?? [];
	for (const section of sections) {
		const body = section.body?.trim() ?? "";
		const bullets = (section.bullets ?? [])
			.map((bullet) => bullet.trim())
			.filter(Boolean);
		// Heading alone is not useful export content.
		if (!body && bullets.length === 0) {
			continue;
		}

		lines.push(`## ${section.heading.trim() || "Section"}`);
		lines.push("");
		if (body) {
			lines.push(body);
			lines.push("");
		}
		for (const bullet of bullets) {
			lines.push(`- ${bullet}`);
		}
		if (bullets.length > 0) {
			lines.push("");
		}
	}

	const citations = [...input.citations].sort(
		(a, b) => (a.citationNumber ?? 0) - (b.citationNumber ?? 0),
	);

	if (citations.length > 0) {
		lines.push("## Sources");
		lines.push("");
		for (const citation of citations) {
			const number = citation.citationNumber ?? 0;
			const source = citation.sourceTitle?.trim() || "Source";
			const suffix = citationLocationSuffix(citation.locator);
			lines.push(`[${number}] ${source}${suffix}`);
		}
		lines.push("");
	}

	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

const TYPE_SLUG: Record<ArtifactType, string> = {
	research_brief: "research-brief",
	study_guide: "study-guide",
	learning_roadmap: "learning-roadmap",
	compare_sources: "compare-sources",
};

/** Safe download filename from title + type — never includes internal IDs. */
export function artifactMarkdownFilename(title: string, type: ArtifactType) {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);

	const base = slug || TYPE_SLUG[type];
	const suffix = TYPE_SLUG[type];
	const stem = base.endsWith(suffix) ? base : `${base}-${suffix}`;
	return `${stem}.md`;
}
