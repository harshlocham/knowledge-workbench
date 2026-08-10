export type DetectedSource =
	| { kind: "youtube"; url: string }
	| { kind: "url"; url: string }
	| { kind: "pdf"; file: File }
	| { kind: "vtt"; file: File }
	| { kind: "text"; content: string };

const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtu.be",
	"www.youtu.be",
]);

function looksLikeUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed || /\s/.test(trimmed)) return false;
	try {
		const withProtocol = /^https?:\/\//i.test(trimmed)
			? trimmed
			: `https://${trimmed}`;
		const url = new URL(withProtocol);
		return Boolean(url.hostname) && url.hostname.includes(".");
	} catch {
		return false;
	}
}

export function isYoutubeUrl(value: string) {
	const trimmed = value.trim();
	if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return true;
	try {
		const withProtocol = /^https?:\/\//i.test(trimmed)
			? trimmed
			: `https://${trimmed}`;
		const url = new URL(withProtocol);
		const host = url.hostname.replace(/^www\./, "");
		return (
			host === "youtu.be" ||
			host === "youtube.com" ||
			host === "m.youtube.com" ||
			host === "music.youtube.com" ||
			YOUTUBE_HOSTS.has(url.hostname)
		);
	} catch {
		return false;
	}
}

export function classifyFile(file: File): "pdf" | "vtt" | null {
	const name = file.name.toLowerCase();
	if (file.type === "application/pdf" || name.endsWith(".pdf")) {
		return "pdf";
	}
	if (
		name.endsWith(".vtt") ||
		file.type === "text/vtt" ||
		(file.type === "text/plain" && name.endsWith(".vtt"))
	) {
		return "vtt";
	}
	return null;
}

/** Infer source kind from pasted text / URL or a dropped file. */
export function detectSourceInput(options: {
	text?: string;
	file?: File | null;
}): DetectedSource | null {
	if (options.file) {
		const kind = classifyFile(options.file);
		if (kind === "pdf") return { kind: "pdf", file: options.file };
		if (kind === "vtt") return { kind: "vtt", file: options.file };
		return null;
	}

	const text = options.text?.trim() ?? "";
	if (!text) return null;

	if (looksLikeUrl(text) || isYoutubeUrl(text)) {
		const normalized = /^https?:\/\//i.test(text) ? text : `https://${text}`;
		if (isYoutubeUrl(text)) {
			return { kind: "youtube", url: normalized };
		}
		return { kind: "url", url: normalized };
	}

	return { kind: "text", content: text };
}
