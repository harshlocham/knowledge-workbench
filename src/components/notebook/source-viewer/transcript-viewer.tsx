import { useEffect, useRef, useState } from "react";

import { TranscriptCueList } from "./transcript-cue-list.tsx";
import type { ViewerCue, ViewerHighlight } from "./types.ts";
import {
	type SeekCommand,
	YoutubePlayerStage,
} from "./youtube-player-stage.tsx";

export function TranscriptViewer({
	cues,
	highlight,
	videoId,
	animateKey,
	resumeAt = null,
	resumePlaying = false,
	onPlaybackSync,
}: {
	cues: ViewerCue[] | null | undefined;
	highlight: ViewerHighlight | null;
	videoId?: string | null;
	animateKey?: string;
	resumeAt?: number | null;
	resumePlaying?: boolean;
	onPlaybackSync?: (seconds: number, playing: boolean) => void;
}) {
	const preferResumeOnMountRef = useRef(resumeAt != null);
	const seekNonceRef = useRef(0);

	const initialSeconds = Math.max(
		0,
		resumeAt ?? highlight?.locator?.tStart ?? 0,
	);
	const [currentTime, setCurrentTime] = useState(initialSeconds);
	const [isPlaying, setIsPlaying] = useState(false);
	const [seekCommand, setSeekCommand] = useState<SeekCommand | null>(null);

	const requestSeek = (seconds: number, play: boolean) => {
		seekNonceRef.current += 1;
		setCurrentTime(seconds);
		setSeekCommand({
			nonce: seekNonceRef.current,
			seconds,
			play,
		});
	};

	useEffect(() => {
		if (highlight?.locator?.tStart == null) return;
		if (preferResumeOnMountRef.current) {
			preferResumeOnMountRef.current = false;
			return;
		}
		const seconds = highlight.locator.tStart;
		const play = Boolean(animateKey);
		seekNonceRef.current += 1;
		setCurrentTime(seconds);
		setSeekCommand({
			nonce: seekNonceRef.current,
			seconds,
			play,
		});
	}, [highlight?.locator?.tStart, animateKey]);

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			{videoId ? (
				<YoutubePlayerStage
					videoId={videoId}
					resumeAt={initialSeconds}
					resumePlaying={resumePlaying}
					seekCommand={seekCommand}
					onPlaybackSync={(seconds, playing) => {
						setCurrentTime(seconds);
						setIsPlaying(playing);
						onPlaybackSync?.(seconds, playing);
					}}
					className="w-full shrink-0"
				/>
			) : null}

			<TranscriptCueList
				cues={cues}
				highlight={highlight}
				currentTime={currentTime}
				isPlaying={isPlaying}
				animateKey={animateKey}
				onSeek={(seconds) => requestSeek(seconds, true)}
			/>
		</div>
	);
}
