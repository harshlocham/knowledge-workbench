import {
	assertYoutubeProxyConfiguredForProduction,
	youtubeFetch,
} from "#/lib/rag/extract-youtube.server.ts";
import { INGEST_LIMITS } from "#/lib/ingest/limits.ts";
import {
	extractYoutubePlaylistId,
	youtubePlaylistUrl,
} from "#/lib/rag/youtube-url.ts";

export type YoutubePlaylistVideo = {
	videoId: string;
	title: string | null;
};

export type ExtractedYoutubePlaylist = {
	playlistId: string;
	playlistUrl: string;
	title: string;
	videos: YoutubePlaylistVideo[];
};

function parseInlineJson(html: string, globalName: string): unknown | null {
	const startToken = `var ${globalName} = `;
	const tokenIndex = html.indexOf(startToken);
	if (tokenIndex === -1) {
		return null;
	}

	const jsonStart = tokenIndex + startToken.length;
	let depth = 0;
	for (let i = jsonStart; i < html.length; i++) {
		const ch = html[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(html.slice(jsonStart, i + 1));
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

function titleFromRuns(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const obj = value as {
		simpleText?: string;
		content?: string;
		runs?: Array<{ text?: string }>;
	};
	if (typeof obj.simpleText === "string" && obj.simpleText.trim()) {
		return obj.simpleText.trim();
	}
	if (typeof obj.content === "string" && obj.content.trim()) {
		return obj.content.trim();
	}
	if (Array.isArray(obj.runs)) {
		const joined = obj.runs
			.map((run) => run.text ?? "")
			.join("")
			.trim();
		return joined || null;
	}
	return null;
}

function collectPlaylistVideos(
	node: unknown,
	out: YoutubePlaylistVideo[],
): void {
	if (!node || typeof node !== "object") return;

	if (Array.isArray(node)) {
		for (const item of node) collectPlaylistVideos(item, out);
		return;
	}

	const obj = node as Record<string, unknown>;

	const classic = obj.playlistVideoRenderer as
		| {
				videoId?: string;
				title?: unknown;
		  }
		| undefined;
	if (classic?.videoId && /^[a-zA-Z0-9_-]{11}$/.test(classic.videoId)) {
		out.push({
			videoId: classic.videoId,
			title: titleFromRuns(classic.title),
		});
	}

	// Newer YouTube playlist UI (lockupViewModel).
	const lockup = obj.lockupViewModel as
		| {
				rendererContext?: {
					commandContext?: {
						onTap?: {
							innertubeCommand?: {
								watchEndpoint?: { videoId?: string };
							};
						};
					};
				};
				metadata?: {
					lockupMetadataViewModel?: {
						title?: unknown;
					};
				};
		  }
		| undefined;
	const lockupId =
		lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand
			?.watchEndpoint?.videoId;
	if (lockupId && /^[a-zA-Z0-9_-]{11}$/.test(lockupId)) {
		out.push({
			videoId: lockupId,
			title: titleFromRuns(lockup?.metadata?.lockupMetadataViewModel?.title),
		});
	}

	for (const value of Object.values(obj)) {
		collectPlaylistVideos(value, out);
	}
}

function playlistTitleFromData(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	const root = data as {
		metadata?: { playlistMetadataRenderer?: { title?: string } };
		header?: {
			playlistHeaderRenderer?: { title?: unknown };
			pageHeaderRenderer?: { pageTitle?: string };
		};
	};
	const meta = root.metadata?.playlistMetadataRenderer?.title?.trim();
	if (meta) return meta;
	const header = titleFromRuns(root.header?.playlistHeaderRenderer?.title);
	if (header) return header;
	const pageTitle = root.header?.pageHeaderRenderer?.pageTitle?.trim();
	return pageTitle || null;
}

/**
 * Resolve a playlist URL to ordered unique videos (first page / embedded list).
 * Uses the same proxy-aware fetch as caption extraction.
 */
export async function extractYoutubePlaylist(
	rawUrlOrId: string,
): Promise<ExtractedYoutubePlaylist> {
	assertYoutubeProxyConfiguredForProduction();

	const playlistId = extractYoutubePlaylistId(rawUrlOrId);
	const playlistUrl = youtubePlaylistUrl(playlistId);

	const response = await youtubeFetch(playlistUrl, {
		redirect: "follow",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			"Accept-Language": "en-US,en;q=0.9",
			Accept: "text/html",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch playlist (HTTP ${response.status})`);
	}

	const html = await response.text();
	if (/sign in to confirm you.re not a bot/i.test(html)) {
		throw new Error(
			"YouTube blocked playlist fetch from this egress IP. Check YOUTUBE_PROXY_URL (`bun run verify:youtube-proxy` must print VPS_OK).",
		);
	}

	const data = parseInlineJson(html, "ytInitialData");
	if (!data) {
		throw new Error("Could not read YouTube playlist data");
	}

	const collected: YoutubePlaylistVideo[] = [];
	collectPlaylistVideos(data, collected);

	const seen = new Set<string>();
	const videos: YoutubePlaylistVideo[] = [];
	for (const item of collected) {
		if (seen.has(item.videoId)) continue;
		seen.add(item.videoId);
		videos.push(item);
		if (videos.length >= INGEST_LIMITS.maxPlaylistVideos) break;
	}

	if (videos.length === 0) {
		throw new Error(
			"No videos found in that playlist (empty, private, or unavailable)",
		);
	}

	const title =
		playlistTitleFromData(data)?.slice(0, INGEST_LIMITS.maxTitleLength) ||
		`Playlist ${playlistId}`;

	return {
		playlistId,
		playlistUrl,
		title,
		videos,
	};
}
