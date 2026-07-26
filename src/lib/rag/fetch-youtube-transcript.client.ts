/**
 * Fetch YouTube captions in the browser so VPS/datacenter server IPs
 * are not used for YouTube (those are often blocked).
 *
 * Strategy: public Invidious/Piped APIs (CORS-friendly), then HTML relays.
 */
import {
  captionTracksFromPlayerResponse,
  parseTranscriptXml,
  parseYtInitialPlayerResponse,
  titleFromPlayerResponse,
  transcriptItemsToCues,
  type YoutubeCueInput,
} from "#/lib/rag/youtube-transcript-shared.ts";

export type BrowserYoutubeTranscript = {
  videoId: string;
  title: string;
  language?: string;
  cues: YoutubeCueInput[];
};

const INVIDIOUS_HOSTS = [
  "https://inv.nadeko.net",
  "https://yewtu.be",
  "https://invidious.privacyredirect.com",
  "https://vid.puffyan.us",
];

const PIPED_HOSTS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.nosebs.ru",
];

async function fetchTextViaRelays(target: string): Promise<string> {
  const attempts: Array<() => Promise<string>> = [
    async () => {
      const response = await fetch(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
      );
      if (!response.ok) throw new Error(`allorigins raw ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("allorigins raw empty");
      return text;
    },
    async () => {
      const response = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
      );
      if (!response.ok) throw new Error(`allorigins get ${response.status}`);
      const data = (await response.json()) as { contents?: string };
      const text = data.contents ?? "";
      if (!text.trim()) throw new Error("allorigins get empty");
      return text;
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not reach YouTube caption relays");
}

function pickTrack(tracks: Array<{ baseUrl: string; languageCode: string }>) {
  return (
    tracks.find((t) => t.languageCode.toLowerCase().startsWith("en")) ??
    tracks[0]
  );
}

function parseVttToCues(vtt: string): YoutubeCueInput[] {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const cues: YoutubeCueInput[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line === "WEBVTT" || line === "" || line.startsWith("NOTE")) {
      i += 1;
      continue;
    }
    // Optional cue id
    let timingLine = line;
    if (!line.includes("-->") && i + 1 < lines.length) {
      timingLine = lines[i + 1]!.trim();
      i += 1;
    }
    const match = timingLine.match(
      /(\d{1,2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/,
    );
    if (!match) {
      i += 1;
      continue;
    }
    const [startRaw, endRaw] = timingLine.split("-->").map((s) => s.trim());
    const tStart = parseVttClock(startRaw!.split(" ")[0]!);
    const tEnd = parseVttClock(endRaw!.split(" ")[0]!);
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      textLines.push(lines[i]!.trim());
      i += 1;
    }
    const text = textLines.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      cues.push({ cueIndex: cues.length, tStart, tEnd, text });
    }
    i += 1;
  }
  return cues;
}

function parseVttClock(value: string): number {
  const parts = value.split(":");
  if (parts.length === 3) {
    return (
      Number(parts[0]) * 3600 +
      Number(parts[1]) * 60 +
      Number(parts[2])
    );
  }
  return Number(parts[0]) * 60 + Number(parts[1]);
}

async function fetchViaInvidious(
  videoId: string,
): Promise<BrowserYoutubeTranscript | null> {
  for (const host of INVIDIOUS_HOSTS) {
    try {
      const metaRes = await fetch(`${host}/api/v1/videos/${videoId}`, {
        headers: { Accept: "application/json" },
      });
      if (!metaRes.ok) continue;
      const meta = (await metaRes.json()) as {
        title?: string;
        captions?: Array<{ label?: string; language_code?: string; url?: string }>;
      };
      const captions = meta.captions ?? [];
      if (captions.length === 0) continue;

      const preferred =
        captions.find((c) =>
          (c.language_code || "").toLowerCase().startsWith("en"),
        ) ?? captions[0];
      if (!preferred?.url) continue;

      const captionUrl = preferred.url.startsWith("http")
        ? preferred.url
        : `${host}${preferred.url}`;
      const captionRes = await fetch(captionUrl);
      if (!captionRes.ok) continue;
      const body = await captionRes.text();
      if (!body.trim()) continue;

      let cues: YoutubeCueInput[] = [];
      if (body.includes("WEBVTT") || body.includes("-->")) {
        cues = parseVttToCues(body);
      } else {
        cues = transcriptItemsToCues(
          parseTranscriptXml(body, preferred.language_code),
        );
      }
      if (cues.length === 0) continue;

      return {
        videoId,
        title: (meta.title || `YouTube ${videoId}`).slice(0, 200),
        language: preferred.language_code,
        cues,
      };
    } catch {
      // try next host
    }
  }
  return null;
}

async function fetchViaPiped(
  videoId: string,
): Promise<BrowserYoutubeTranscript | null> {
  for (const host of PIPED_HOSTS) {
    try {
      const res = await fetch(`${host}/streams/${videoId}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        title?: string;
        subtitles?: Array<{
          url?: string;
          mimeType?: string;
          code?: string;
          name?: string;
        }>;
      };
      const subs = data.subtitles ?? [];
      if (subs.length === 0) continue;

      const preferred =
        subs.find((s) => (s.code || "").toLowerCase().startsWith("en")) ??
        subs[0];
      if (!preferred?.url) continue;

      const captionRes = await fetch(preferred.url);
      if (!captionRes.ok) continue;
      const body = await captionRes.text();
      if (!body.trim()) continue;

      let cues: YoutubeCueInput[] = [];
      if (
        body.includes("WEBVTT") ||
        preferred.mimeType?.includes("vtt") ||
        body.includes("-->")
      ) {
        cues = parseVttToCues(body);
      } else {
        cues = transcriptItemsToCues(parseTranscriptXml(body, preferred.code));
      }
      if (cues.length === 0) continue;

      return {
        videoId,
        title: (data.title || `YouTube ${videoId}`).slice(0, 200),
        language: preferred.code,
        cues,
      };
    } catch {
      // try next host
    }
  }
  return null;
}

async function fetchViaHtmlRelay(
  videoId: string,
): Promise<BrowserYoutubeTranscript> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchTextViaRelays(watchUrl);

  if (html.includes('class="g-recaptcha"')) {
    throw new Error(
      "YouTube asked for a captcha while fetching captions. Try again in a moment.",
    );
  }

  const player = parseYtInitialPlayerResponse(html);
  if (!player) {
    throw new Error(
      "Could not read YouTube player data. Try again in a moment.",
    );
  }

  const tracks = captionTracksFromPlayerResponse(player);
  if (tracks.length === 0) {
    throw new Error(
      "No captions available for this video (disabled, private, or missing transcript)",
    );
  }

  const track = pickTrack(tracks);
  if (!track) {
    throw new Error("No captions available for this video");
  }

  const xml = await fetchTextViaRelays(track.baseUrl);
  const items = parseTranscriptXml(xml, track.languageCode);
  const cues = transcriptItemsToCues(items);
  if (cues.length === 0) {
    throw new Error("YouTube returned an empty transcript");
  }

  const title = titleFromPlayerResponse(player) ?? `YouTube ${videoId}`;
  return {
    videoId,
    title: title.slice(0, 200),
    language: track.languageCode,
    cues,
  };
}

export async function fetchYoutubeTranscriptInBrowser(
  videoId: string,
): Promise<BrowserYoutubeTranscript> {
  const fromInvidious = await fetchViaInvidious(videoId);
  if (fromInvidious) return fromInvidious;

  const fromPiped = await fetchViaPiped(videoId);
  if (fromPiped) return fromPiped;

  return fetchViaHtmlRelay(videoId);
}
