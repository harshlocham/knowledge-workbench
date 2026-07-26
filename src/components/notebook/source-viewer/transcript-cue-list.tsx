import { useEffect, useMemo, useRef } from "react";

import { cn } from "#/lib/utils.ts";

import { formatCompactTime, formatViewerTime } from "./format.ts";
import type { ViewerCue, ViewerHighlight } from "./types.ts";

function cueIndexAtTime(cues: ViewerCue[], seconds: number): number | null {
	let match: number | null = null;
	for (const cue of cues) {
		if (seconds >= cue.tStart && seconds < cue.tEnd) {
			return cue.cueIndex;
		}
		if (seconds >= cue.tStart) {
			match = cue.cueIndex;
		}
	}
	return match;
}

export function TranscriptCueList({
	cues,
	highlight,
	currentTime,
	isPlaying,
	animateKey,
	onSeek,
	largerText = false,
}: {
	cues: ViewerCue[] | null | undefined;
	highlight: ViewerHighlight | null;
	currentTime: number;
	isPlaying: boolean;
	animateKey?: string;
	onSeek: (seconds: number) => void;
	largerText?: boolean;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const userScrollingRef = useRef(false);
	const userScrollTimerRef = useRef<number | null>(null);

	const citationCueIndexes = useMemo(() => {
		if (!highlight?.locator) {
			return new Set<number>();
		}
		const fromList = highlight.locator.cueIndexes ?? [];
		if (fromList.length > 0) {
			return new Set(fromList);
		}
		if (highlight.locator.cueIndex != null) {
			return new Set([highlight.locator.cueIndex]);
		}
		return new Set<number>();
	}, [highlight]);

	const playingCueIndex = useMemo(() => {
		if (!cues?.length) return null;
		return cueIndexAtTime(cues, currentTime);
	}, [cues, currentTime]);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;

		const markUserScroll = () => {
			userScrollingRef.current = true;
			if (userScrollTimerRef.current != null) {
				window.clearTimeout(userScrollTimerRef.current);
			}
			userScrollTimerRef.current = window.setTimeout(() => {
				userScrollingRef.current = false;
			}, 2500);
		};

		list.addEventListener("wheel", markUserScroll, { passive: true });
		list.addEventListener("touchmove", markUserScroll, { passive: true });
		return () => {
			list.removeEventListener("wheel", markUserScroll);
			list.removeEventListener("touchmove", markUserScroll);
			if (userScrollTimerRef.current != null) {
				window.clearTimeout(userScrollTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (playingCueIndex == null || userScrollingRef.current) return;
		const node = listRef.current?.querySelector(
			`[data-cue-index="${playingCueIndex}"]`,
		);
		node?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [playingCueIndex]);

	useEffect(() => {
		if (!animateKey) return;
		const first =
			highlight?.locator?.cueIndex ??
			highlight?.locator?.cueIndexes?.[0] ??
			playingCueIndex;
		if (first == null) return;
		const node = listRef.current?.querySelector(`[data-cue-index="${first}"]`);
		if (!node) return;
		node.classList.remove("citation-highlight-pulse");
		void (node as HTMLElement).offsetWidth;
		node.classList.add("citation-highlight-pulse");
	}, [
		animateKey,
		highlight?.locator?.cueIndex,
		highlight?.locator?.cueIndexes,
		playingCueIndex,
	]);

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3">
			{highlight?.locator?.tStart != null &&
			highlight?.locator?.tEnd != null ? (
				<div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--sea-ink-soft)]">
					Cited range{" "}
					<span className="font-medium text-[var(--sea-ink)]">
						{formatViewerTime(highlight.locator.tStart)} →{" "}
						{formatViewerTime(highlight.locator.tEnd)}
					</span>
				</div>
			) : null}

			<div ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
				{(cues ?? []).map((cue) => {
					const cited = citationCueIndexes.has(cue.cueIndex);
					const playing = playingCueIndex === cue.cueIndex;
					return (
						<button
							key={cue.cueIndex}
							type="button"
							data-cue-index={cue.cueIndex}
							data-active-cue={playing || cited ? "true" : "false"}
							onClick={() => onSeek(cue.tStart)}
							className={
								playing
									? "citation-highlight w-full rounded-lg border border-[color-mix(in_oklab,var(--lagoon)_55%,transparent)] bg-[color-mix(in_oklab,var(--lagoon)_22%,transparent)] px-3 py-2 text-left shadow-[inset_3px_0_0_var(--lagoon)]"
									: cited
										? "citation-highlight w-full rounded-lg border border-[color-mix(in_oklab,var(--lagoon)_35%,transparent)] bg-[color-mix(in_oklab,var(--lagoon)_12%,transparent)] px-3 py-2 text-left"
										: "w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:bg-[color-mix(in_oklab,var(--surface)_85%,white)]"
							}
						>
							<p className="text-[11px] font-medium text-[var(--lagoon-deep)]">
								{formatCompactTime(cue.tStart)} → {formatCompactTime(cue.tEnd)}
								{playing ? (isPlaying ? " · now" : " · paused") : ""}
							</p>
							<p
								className={cn(
									"mt-0.5 leading-relaxed text-[var(--sea-ink)]",
									largerText ? "text-[15px]" : "text-sm",
									playing && "font-medium",
								)}
							>
								{cue.text}
							</p>
						</button>
					);
				})}

				{!cues?.length ? (
					<p className="text-sm text-[var(--sea-ink-soft)]">
						No transcript cues available for this source.
					</p>
				) : null}
			</div>
		</div>
	);
}
