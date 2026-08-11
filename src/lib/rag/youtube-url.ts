/** Isomorphic YouTube URL / id helpers (safe for client + server). */

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
/** Playlist ids are longer alphanumerics, often starting with PL / UU / LL / OL / RD… */
const PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{10,80}$/;

/** Parse a YouTube URL or bare video id into an 11-character id. */
export function extractYoutubeVideoId(input: string): string {
	const trimmed = input.trim();
	if (VIDEO_ID_RE.test(trimmed)) {
		return trimmed;
	}

	const withProtocol = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	let url: URL;
	try {
		url = new URL(withProtocol);
	} catch {
		throw new Error("Enter a valid YouTube URL or video id");
	}

	const host = url.hostname.replace(/^www\./, "");

	if (host === "youtu.be") {
		const id = url.pathname.split("/").filter(Boolean)[0];
		if (id && VIDEO_ID_RE.test(id)) {
			return id;
		}
	}

	if (
		host === "youtube.com" ||
		host === "m.youtube.com" ||
		host === "music.youtube.com"
	) {
		const v = url.searchParams.get("v");
		if (v && VIDEO_ID_RE.test(v)) {
			return v;
		}

		const parts = url.pathname.split("/").filter(Boolean);
		if (
			parts.length >= 2 &&
			["embed", "shorts", "live", "v"].includes(parts[0]!) &&
			VIDEO_ID_RE.test(parts[1]!)
		) {
			return parts[1]!;
		}
	}

	throw new Error("Could not parse a YouTube video id from that URL");
}

/** True when the URL is a playlist page (not a single watch URL with &list=). */
export function isYoutubePlaylistUrl(input: string): boolean {
	try {
		extractYoutubePlaylistId(input);
		return true;
	} catch {
		return false;
	}
}

/** Parse playlist id from `/playlist?list=` (rejects watch URLs that only have list=). */
export function extractYoutubePlaylistId(input: string): string {
	const trimmed = input.trim();
	if (PLAYLIST_ID_RE.test(trimmed) && !VIDEO_ID_RE.test(trimmed)) {
		// Bare playlist id — only accept common prefixes to avoid mistaking random strings.
		if (/^(PL|UU|LL|FL|OL|RD|SD)/.test(trimmed)) {
			return trimmed;
		}
	}

	const withProtocol = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	let url: URL;
	try {
		url = new URL(withProtocol);
	} catch {
		throw new Error("Enter a valid YouTube playlist URL");
	}

	const host = url.hostname.replace(/^www\./, "");
	if (
		host !== "youtube.com" &&
		host !== "m.youtube.com" &&
		host !== "music.youtube.com"
	) {
		throw new Error("Enter a valid YouTube playlist URL");
	}

	const list = url.searchParams.get("list");
	if (!list || !PLAYLIST_ID_RE.test(list)) {
		throw new Error("Could not parse a YouTube playlist id from that URL");
	}

	const parts = url.pathname.split("/").filter(Boolean);
	// Prefer explicit /playlist paths. Also accept /watch with list= but no v=
	// (rare). Watch URLs with both v= and list= are treated as single videos.
	const isPlaylistPath = parts[0] === "playlist";
	const hasVideo = Boolean(url.searchParams.get("v"));
	if (!isPlaylistPath && hasVideo) {
		throw new Error("Not a playlist URL (this is a single video)");
	}
	if (!isPlaylistPath && parts[0] !== "watch") {
		throw new Error("Could not parse a YouTube playlist id from that URL");
	}

	return list;
}

export function youtubeWatchUrl(videoId: string) {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubePlaylistUrl(playlistId: string) {
	return `https://www.youtube.com/playlist?list=${playlistId}`;
}
