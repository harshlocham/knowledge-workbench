import type { TextChunk } from "#/lib/rag/chunk.ts";
import type { VttCue } from "#/lib/rag/parse-vtt.server.ts";

/** Target scene length for timed transcripts. */
const TARGET_WINDOW_SECONDS = 75;
/** Hard cap so embeddings stay focused. */
const MAX_CHUNK_CHARS = 900;
/** Split when narration pauses longer than this. */
const GAP_SPLIT_SECONDS = 12;

/** Compact clock for embed/prompt labels (drop millis). */
export function formatChunkClock(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const seconds = safe % 60;
	const mm = String(minutes).padStart(2, "0");
	const ss = String(seconds).padStart(2, "0");
	if (hours > 0) {
		return `${hours}:${mm}:${ss}`;
	}
	return `${minutes}:${ss}`;
}

function flushGroup(groups: VttCue[][], current: VttCue[]) {
	if (current.length > 0) {
		groups.push(current);
	}
}

/**
 * Group cues into scene-like windows using pause gaps, duration, and size.
 */
export function groupVttCuesByScene(
	cues: VttCue[],
	options?: {
		targetWindowSeconds?: number;
		maxChars?: number;
		gapSplitSeconds?: number;
	},
): VttCue[][] {
	const targetWindowSeconds =
		options?.targetWindowSeconds ?? TARGET_WINDOW_SECONDS;
	const maxChars = options?.maxChars ?? MAX_CHUNK_CHARS;
	const gapSplitSeconds = options?.gapSplitSeconds ?? GAP_SPLIT_SECONDS;

	const groups: VttCue[][] = [];
	let current: VttCue[] = [];
	let groupStart = 0;
	let groupChars = 0;

	for (const cue of cues) {
		const textLen = cue.text.trim().length;
		if (textLen === 0) continue;

		const prev = current.at(-1);
		const shouldSplit =
			current.length > 0 &&
			((prev && cue.tStart - prev.tEnd >= gapSplitSeconds) ||
				cue.tStart - groupStart >= targetWindowSeconds ||
				groupChars + textLen + 1 > maxChars);

		if (shouldSplit) {
			flushGroup(groups, current);
			current = [];
			groupChars = 0;
		}

		if (current.length === 0) {
			groupStart = cue.tStart;
		}

		current.push(cue);
		groupChars += textLen + (current.length > 1 ? 1 : 0);
	}

	flushGroup(groups, current);
	return groups;
}

/**
 * Scene-aware VTT/YouTube chunking with `[start–end]` prefixes for embeddings.
 * plainText stays unprefixed for source metadata / full transcript storage.
 */
export function chunkVttCues(
	cues: VttCue[],
	options?: { videoId?: string; url?: string },
): {
	plainText: string;
	chunks: TextChunk[];
} {
	const plainText = cues
		.map((cue) => cue.text.trim())
		.filter(Boolean)
		.join("\n");

	const groups = groupVttCuesByScene(cues);
	const chunks: TextChunk[] = [];
	let cursor = 0;

	groups.forEach((group, chunkIndex) => {
		const body = group
			.map((cue) => cue.text.trim())
			.filter(Boolean)
			.join("\n");
		if (!body) return;

		const tStart = group[0]!.tStart;
		const tEnd = group.at(-1)!.tEnd;
		const cueIndexes = group.map((cue) => cue.cueIndex);
		const timePrefix = `[${formatChunkClock(tStart)}–${formatChunkClock(tEnd)}] `;
		const startOffset = plainText.indexOf(body, cursor);
		const resolvedStart = startOffset >= 0 ? startOffset : cursor;
		const endOffset = resolvedStart + body.length;
		cursor = endOffset;

		chunks.push({
			content: `${timePrefix}${body}`,
			chunkIndex,
			locator: {
				startOffset: resolvedStart,
				endOffset,
				tStart,
				tEnd,
				cueIndex: cueIndexes[0],
				cueIndexes,
				videoId: options?.videoId,
				url: options?.url,
			},
		});
	});

	return { plainText, chunks };
}
