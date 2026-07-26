import type { SourceDTO } from "#/features/sources/sources.functions.ts";

const UNTITLED = /^untitled(\s+notebook)?$/i;

const WEAK_TITLES = [
	/^text source$/i,
	/^pdf source$/i,
	/^transcript$/i,
	/^website$/i,
	/^youtube\s+[a-zA-Z0-9_-]{6,}$/i,
];

const TYPE_LABELS: Record<SourceDTO["type"], string> = {
	youtube: "YouTube video",
	pdf: "PDF document",
	url: "Web page",
	text: "Text note",
	vtt: "Transcript",
};

const PLACEHOLDER_DESCRIPTION =
	/^(YouTube video|PDF document|Web page|Text note|Transcript|Source)\b/i;
const PLACEHOLDER_NOTEBOOK = /^Notebook with \d+ sources\b/i;

export function isUntitledNotebookTitle(title: string) {
	return UNTITLED.test(title.trim());
}

function isWeakSourceTitle(title: string) {
	const trimmed = title.trim();
	if (!trimmed) return true;
	return WEAK_TITLES.some((pattern) => pattern.test(trimmed));
}

function rankedSources(sources: SourceDTO[]) {
	return [...sources].sort((a, b) => {
		const aReady = a.status === "ready" ? 0 : 1;
		const bReady = b.status === "ready" ? 0 : 1;
		if (aReady !== bReady) return aReady - bReady;
		const aWeak = isWeakSourceTitle(a.title) ? 1 : 0;
		const bWeak = isWeakSourceTitle(b.title) ? 1 : 0;
		if (aWeak !== bWeak) return aWeak - bWeak;
		return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
	});
}

function rankedSourceTitles(sources: SourceDTO[]) {
	return rankedSources(sources)
		.map((source) => source.title.trim())
		.filter((title) => title.length > 0);
}

/** Prefer ready sources with stronger titles (e.g. after YouTube/URL fetch). */
export function deriveNotebookTitleFromSources(sources: SourceDTO[]) {
	const titles = rankedSourceTitles(sources);
	if (titles.length === 0) return null;

	if (titles.length === 1) {
		return titles[0]!.slice(0, 200);
	}

	const combined = `${titles[0]} · ${titles[1]}`;
	return combined.slice(0, 200);
}

/**
 * Short catalog blurb for the card — never a copy of the source/notebook title.
 * A richer topic sentence is written server-side after the first source indexes.
 */
export function deriveNotebookDescriptionFromSources(sources: SourceDTO[]) {
	if (sources.length === 0) return null;

	const ranked = rankedSources(sources);
	if (ranked.length === 1) {
		const source = ranked[0]!;
		const label = TYPE_LABELS[source.type] ?? "Source";
		return `${label} ready for grounded Q&A.`;
	}

	const labels = [
		...new Set(ranked.map((source) => TYPE_LABELS[source.type] ?? source.type)),
	];
	return `Notebook with ${ranked.length} sources (${labels.join(", ")}).`;
}

export function isEmptyNotebookDescription(
	description: string | null | undefined,
) {
	return !description || description.trim().length === 0;
}

/** True for empty, title-duplicate, or temporary catalog blurbs we may upgrade. */
export function shouldAutoUpdateNotebookDescription(
	description: string | null | undefined,
	title: string,
) {
	if (isEmptyNotebookDescription(description)) return true;
	const trimmed = description!.trim();
	if (trimmed === title.trim()) return true;
	return (
		PLACEHOLDER_DESCRIPTION.test(trimmed) || PLACEHOLDER_NOTEBOOK.test(trimmed)
	);
}

export function notebookDescriptionFromSummary(
	summary: string,
	sourceTitle: string,
	sourceType: string,
) {
	const lines = summary
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean);

	const candidates = lines.filter((line) => {
		const plain = line.replace(/\*+/g, "").trim();
		if (!plain) return false;
		if (/^i['’]?ve added\b/i.test(plain)) return false;
		if (
			/^(what happens|follow-up questions|key points)\b/i.test(plain) ||
			/^#{1,6}\s*(what happens|follow-up questions|key points)\b/i.test(plain)
		) {
			return false;
		}
		if (/^#{1,6}\s/.test(plain)) return false;
		if (/^[-*•]/.test(plain)) return false;
		if (/^\d+[.)]\s/.test(plain)) return false;
		return true;
	});

	let text = (candidates[0] ?? "").replace(/\[\d+\]/g, "").replace(/\*+/g, "");
	text = text.replace(/\s+/g, " ").trim();

	if (!text || text.toLowerCase() === sourceTitle.trim().toLowerCase()) {
		const label = TYPE_LABELS[sourceType as SourceDTO["type"]] ?? "source";
		return `Research notes grounded in this ${label.toLowerCase()}.`;
	}

	// Keep card copy short.
	if (text.length > 280) {
		const cut = text.slice(0, 277);
		const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
		text = `${(at > 120 ? cut.slice(0, at + 1) : cut).trim()}…`;
	}

	return text.slice(0, 2000);
}
