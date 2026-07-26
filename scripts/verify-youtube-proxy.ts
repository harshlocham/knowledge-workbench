/**
 * Guarantee gate for YouTube on a VPS:
 *   bun run verify:youtube-proxy
 *
 * Must print VPS_OK before relying on YOUTUBE_PROXY_URL in production.
 * Use a *residential* rotating proxy — datacenter pools usually fail.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const videoId = process.argv[2] || "Mgytm8a8uEc";

const { fetchTranscript } = await import("youtube-transcript");
const {
  getYoutubeProxyUrl,
  youtubeFetch,
} = await import("../src/lib/rag/extract-youtube.server.ts");

const proxy = getYoutubeProxyUrl();
console.log("proxy_set", Boolean(proxy));
if (proxy) {
  // Do not print credentials.
  try {
    const u = new URL(proxy);
    console.log("proxy_host", u.host);
  } catch {
    console.log("proxy_host", "(unparseable YOUTUBE_PROXY_URL)");
  }
} else {
  console.log(
    "hint",
    "No YOUTUBE_PROXY_URL — testing direct egress (fails on blocked VPS IPs).",
  );
}

try {
  const items = await fetchTranscript(videoId, { fetch: youtubeFetch });
  if (!items.length) {
    console.log("VPS_FAIL", "empty transcript");
    process.exit(1);
  }
  console.log("VPS_OK", items.length);
  process.exit(0);
} catch (error) {
  console.log(
    "VPS_FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
