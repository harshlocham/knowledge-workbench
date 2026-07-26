const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

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

export function youtubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
