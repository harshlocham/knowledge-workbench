export type VttCue = {
	cueIndex: number;
	tStart: number;
	tEnd: number;
	text: string;
};

export type ParsedVtt = {
	cues: VttCue[];
	plainText: string;
	cueCount: number;
	durationSeconds: number;
};

/** Parse a WebVTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) into seconds. */
export function parseVttTimestamp(value: string): number {
	const cleaned = value.trim().replace(",", ".");
	const parts = cleaned.split(":");
	if (parts.length < 2 || parts.length > 3) {
		throw new Error(`Invalid VTT timestamp: ${value}`);
	}

	const secondsPart = parts.at(-1)!;
	const minutesPart = parts.at(-2)!;
	const hoursPart = parts.length === 3 ? parts[0]! : "0";

	const hours = Number(hoursPart);
	const minutes = Number(minutesPart);
	const seconds = Number(secondsPart);

	if ([hours, minutes, seconds].some((n) => Number.isNaN(n))) {
		throw new Error(`Invalid VTT timestamp: ${value}`);
	}

	return hours * 3600 + minutes * 60 + seconds;
}

export function formatVttTimestamp(totalSeconds: number): string {
	const safe = Math.max(0, totalSeconds);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const seconds = safe % 60;
	const whole = Math.floor(seconds);
	const millis = Math.round((seconds - whole) * 1000);

	const mm = String(minutes).padStart(2, "0");
	const ss = String(whole).padStart(2, "0");
	const mmm = String(millis).padStart(3, "0");

	if (hours > 0) {
		return `${String(hours).padStart(2, "0")}:${mm}:${ss}.${mmm}`;
	}

	return `${mm}:${ss}.${mmm}`;
}

/**
 * Lightweight WebVTT parser.
 * Supports cue timings + text; skips NOTE/STYLE/REGION blocks and headers.
 */
export function parseWebVtt(input: string): ParsedVtt {
	const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");

	if (!lines.some((line) => line.trim().toUpperCase().startsWith("WEBVTT"))) {
		throw new Error(
			"File is not a valid WebVTT transcript (missing WEBVTT header)",
		);
	}

	const cues: VttCue[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]?.trim() ?? "";

		if (
			!line ||
			line.toUpperCase().startsWith("WEBVTT") ||
			line.startsWith("NOTE") ||
			line.startsWith("STYLE") ||
			line.startsWith("REGION")
		) {
			// Skip block until blank line for NOTE/STYLE/REGION
			if (
				line.startsWith("NOTE") ||
				line.startsWith("STYLE") ||
				line.startsWith("REGION")
			) {
				i += 1;
				while (i < lines.length && lines[i]?.trim()) {
					i += 1;
				}
			} else {
				i += 1;
			}
			continue;
		}

		// Optional cue identifier line before timings
		let timingLine = line;
		if (!timingLine.includes("-->")) {
			const next = lines[i + 1]?.trim() ?? "";
			if (next.includes("-->")) {
				i += 1;
				timingLine = next;
			} else {
				i += 1;
				continue;
			}
		}

		const timingMatch = timingLine.match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
		if (!timingMatch) {
			i += 1;
			continue;
		}

		const tStart = parseVttTimestamp(timingMatch[1]!);
		const tEnd = parseVttTimestamp(timingMatch[2]!);

		i += 1;
		const textLines: string[] = [];
		while (i < lines.length && lines[i]?.trim()) {
			textLines.push(lines[i]!.trim());
			i += 1;
		}

		const text = textLines
			.join(" ")
			.replace(/<[^>]+>/g, "")
			.replace(/\s+/g, " ")
			.trim();

		if (text) {
			cues.push({
				cueIndex: cues.length,
				tStart,
				tEnd: Math.max(tEnd, tStart),
				text,
			});
		}

		i += 1;
	}

	if (cues.length === 0) {
		throw new Error("No cues found in VTT transcript");
	}

	const plainText = cues.map((cue) => cue.text).join("\n");
	const durationSeconds = Math.max(...cues.map((cue) => cue.tEnd));

	return {
		cues,
		plainText,
		cueCount: cues.length,
		durationSeconds,
	};
}
