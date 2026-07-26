import { useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils.ts";
import {
	loadYoutubeIframeApi,
	type YoutubePlayer,
} from "#/lib/youtube-iframe-api.ts";

export type SeekCommand = {
	nonce: number;
	seconds: number;
	play: boolean;
};

export function YoutubePlayerStage({
	videoId,
	resumeAt = 0,
	resumePlaying = false,
	seekCommand = null,
	onPlaybackSync,
	className,
	framed = true,
}: {
	videoId: string;
	resumeAt?: number;
	resumePlaying?: boolean;
	seekCommand?: SeekCommand | null;
	onPlaybackSync?: (seconds: number, playing: boolean) => void;
	className?: string;
	/** When false, fill the parent without a card chrome (focus stage). */
	framed?: boolean;
}) {
	const playerHostRef = useRef<HTMLDivElement>(null);
	const playerRef = useRef<YoutubePlayer | null>(null);
	const pendingSeekRef = useRef<{ seconds: number; play: boolean } | null>(
		null,
	);
	const onPlaybackSyncRef = useRef(onPlaybackSync);
	onPlaybackSyncRef.current = onPlaybackSync;

	const startSecondsRef = useRef(Math.max(0, Math.floor(resumeAt)));
	const resumePlayingRef = useRef(resumePlaying);
	const lastSeekNonceRef = useRef<number | null>(null);

	const [isPlaying, setIsPlaying] = useState(false);
	const [playerReady, setPlayerReady] = useState(false);
	const playerReadyRef = useRef(false);
	playerReadyRef.current = playerReady;

	useEffect(() => {
		if (!videoId || !playerHostRef.current) return;

		let cancelled = false;
		let player: YoutubePlayer | null = null;
		const mount = document.createElement("div");
		mount.className = "h-full w-full";
		playerHostRef.current.replaceChildren(mount);

		setPlayerReady(false);
		setIsPlaying(false);

		const startAt = startSecondsRef.current;
		const shouldAutoplay = resumePlayingRef.current;
		if (startAt > 0 || shouldAutoplay) {
			pendingSeekRef.current = { seconds: startAt, play: shouldAutoplay };
		}

		void loadYoutubeIframeApi()
			.then((YT) => {
				if (cancelled) return;

				player = new YT.Player(mount, {
					videoId,
					width: "100%",
					height: "100%",
					playerVars: {
						start: Math.floor(startAt),
						autoplay: shouldAutoplay ? 1 : 0,
						rel: 0,
						modestbranding: 1,
						playsinline: 1,
						origin: window.location.origin,
					},
					events: {
						onReady: (event) => {
							if (cancelled) return;
							playerRef.current = event.target;
							setPlayerReady(true);

							const pending = pendingSeekRef.current;
							if (pending) {
								pendingSeekRef.current = null;
								event.target.seekTo(pending.seconds, true);
								onPlaybackSyncRef.current?.(pending.seconds, pending.play);
								if (pending.play) {
									event.target.playVideo();
								}
							}
						},
						onStateChange: (event) => {
							if (cancelled) return;
							const playing = event.data === YT.PlayerState.PLAYING;
							setIsPlaying(playing);
							try {
								const t = event.target.getCurrentTime();
								onPlaybackSyncRef.current?.(t, playing);
							} catch {
								// ignore
							}
						},
					},
				});
				playerRef.current = player;
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
			playerRef.current = null;
			setPlayerReady(false);
			try {
				player?.destroy();
			} catch {
				// ignore
			}
			playerHostRef.current?.replaceChildren();
		};
	}, [videoId]);

	useEffect(() => {
		if (!isPlaying || !playerReady) return;
		const id = window.setInterval(() => {
			try {
				const t = playerRef.current?.getCurrentTime();
				if (typeof t === "number" && Number.isFinite(t)) {
					onPlaybackSyncRef.current?.(t, true);
				}
			} catch {
				// ignore
			}
		}, 200);
		return () => window.clearInterval(id);
	}, [isPlaying, playerReady]);

	useEffect(() => {
		if (!seekCommand || seekCommand.nonce === lastSeekNonceRef.current) {
			return;
		}
		lastSeekNonceRef.current = seekCommand.nonce;
		const { seconds, play } = seekCommand;
		const safe = Math.max(0, seconds);
		const player = playerRef.current;
		if (!player || !playerReadyRef.current) {
			pendingSeekRef.current = { seconds: safe, play };
			return;
		}
		player.seekTo(safe, true);
		onPlaybackSyncRef.current?.(safe, play);
		if (play) {
			player.playVideo();
		}
	}, [seekCommand]);

	useEffect(() => {
		if (!playerReady) return;
		const pending = pendingSeekRef.current;
		if (!pending) return;
		pendingSeekRef.current = null;
		const player = playerRef.current;
		if (!player) return;
		player.seekTo(pending.seconds, true);
		onPlaybackSyncRef.current?.(pending.seconds, pending.play);
		if (pending.play) {
			player.playVideo();
		}
	}, [playerReady]);

	return (
		<div
			className={cn(
				framed &&
					"overflow-hidden rounded-xl border border-[var(--line)] bg-black",
				!framed && "bg-black",
				className,
			)}
		>
			<div className="aspect-video w-full [&_iframe]:h-full [&_iframe]:w-full">
				<div ref={playerHostRef} className="h-full w-full" />
			</div>
		</div>
	);
}
