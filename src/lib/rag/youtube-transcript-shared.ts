/** Shared YouTube transcript parsing (safe for client + server). */

export type YoutubeTranscriptItem = {
	text: string;
	duration: number;
	offset: number;
	lang?: string;
};

export type YoutubeCueInput = {
	cueIndex: number;
	tStart: number;
	tEnd: number;
	text: string;
};

const RE_XML_TRANSCRIPT =
	/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

export function decodeTranscriptEntities(text: string) {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec) =>
			String.fromCodePoint(Number.parseInt(dec, 10)),
		);
}

/** Parse srv3 (`<p t d>`) or classic (`<text start dur>`) caption XML. */
export function parseTranscriptXml(
	xml: string,
	lang?: string,
): YoutubeTranscriptItem[] {
	const results: YoutubeTranscriptItem[] = [];
	const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
	let match: RegExpExecArray | null;

	while ((match = pRegex.exec(xml)) !== null) {
		const startMs = Number.parseInt(match[1]!, 10);
		const durMs = Number.parseInt(match[2]!, 10);
		const inner = match[3]!;
		let text = "";
		const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
		let sMatch: RegExpExecArray | null;
		while ((sMatch = sRegex.exec(inner)) !== null) {
			text += sMatch[1];
		}
		if (!text) {
			text = inner.replace(/<[^>]+>/g, "");
		}
		text = decodeTranscriptEntities(text).trim();
		if (text) {
			results.push({ text, duration: durMs, offset: startMs, lang });
		}
	}

	if (results.length > 0) {
		return results;
	}

	return [...xml.matchAll(RE_XML_TRANSCRIPT)].map((result) => ({
		text: decodeTranscriptEntities(result[3]!),
		duration: Number.parseFloat(result[2]!),
		offset: Number.parseFloat(result[1]!),
		lang,
	}));
}

export function transcriptItemsToCues(
	items: YoutubeTranscriptItem[],
): YoutubeCueInput[] {
	if (items.length === 0) {
		return [];
	}

	const maxOffset = Math.max(
		...items.map((item) => Number(item.offset) || 0),
		0,
	);
	const offsetUnit = maxOffset >= 100_000 ? "ms" : "s";

	return items
		.map((item, cueIndex) => {
			const rawStart = Math.max(0, Number(item.offset) || 0);
			const rawDuration = Math.max(0, Number(item.duration) || 0);
			const tStart = offsetUnit === "ms" ? rawStart / 1000 : rawStart;
			const duration = offsetUnit === "ms" ? rawDuration / 1000 : rawDuration;
			return {
				cueIndex,
				tStart,
				tEnd: tStart + (duration > 0 ? duration : 2),
				text: item.text.replace(/\s+/g, " ").trim(),
			};
		})
		.filter((cue) => cue.text.length > 0);
}

export type CaptionTrack = {
	baseUrl: string;
	languageCode: string;
};

export function captionTracksFromPlayerResponse(
	player: Record<string, unknown>,
): CaptionTrack[] {
	const captions = player.captions as
		| {
				playerCaptionsTracklistRenderer?: {
					captionTracks?: Array<{
						baseUrl?: string;
						languageCode?: string;
					}>;
				};
		  }
		| undefined;

	const tracks = captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

	return tracks
		.filter((t) => typeof t.baseUrl === "string" && t.baseUrl.length > 0)
		.map((t) => ({
			baseUrl: t.baseUrl!,
			languageCode: t.languageCode || "en",
		}));
}

/** Parse `var ytInitialPlayerResponse = {...}` from a watch-page HTML body. */
export function parseYtInitialPlayerResponse(
	html: string,
): Record<string, unknown> | null {
	const startToken = "var ytInitialPlayerResponse = ";
	const startIndex = html.indexOf(startToken);
	if (startIndex === -1) {
		// Some embeds use bare assignment without `var`.
		const alt = "ytInitialPlayerResponse = ";
		const altIndex = html.indexOf(alt);
		if (altIndex === -1) return null;
		return parseBalancedJsonObject(html, altIndex + alt.length);
	}
	return parseBalancedJsonObject(html, startIndex + startToken.length);
}

function parseBalancedJsonObject(
	source: string,
	jsonStart: number,
): Record<string, unknown> | null {
	let depth = 0;
	for (let i = jsonStart; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) {
				try {
					return JSON.parse(source.slice(jsonStart, i + 1)) as Record<
						string,
						unknown
					>;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

/** Prefer English tracks, then keep original order. */
export function sortCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
	return [...tracks].sort((a, b) => {
		const score = (code: string) =>
			code === "en" || code.startsWith("en-") ? 0 : 1;
		return score(a.languageCode) - score(b.languageCode);
	});
}

/** Candidate caption URLs — default + srv3 (library often gets empty XML otherwise). */
export function captionFetchUrls(baseUrl: string): string[] {
	const urls = [baseUrl];
	try {
		const withSrv3 = new URL(baseUrl);
		if (!withSrv3.hostname.endsWith("youtube.com")) {
			return urls;
		}
		withSrv3.searchParams.set("fmt", "srv3");
		urls.push(withSrv3.toString());
	} catch {
		// keep base only
	}
	return [...new Set(urls)];
}

export function titleFromPlayerResponse(
	player: Record<string, unknown>,
): string | null {
	const details = player.videoDetails as { title?: string } | undefined;
	const title = details?.title?.trim();
	return title || null;
}

export const YOUTUBE_CAPTURE_MESSAGE_SOURCE = "kw-yt-capture" as const;

export type YoutubeCaptureMessage = {
	source: typeof YOUTUBE_CAPTURE_MESSAGE_SOURCE;
	videoId: string;
	title: string;
	language?: string;
	cues: YoutubeCueInput[];
	error?: string;
};
