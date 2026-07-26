/** Minimal YouTube IFrame Player API typings (runtime loaded from youtube.com). */

export type YoutubePlayer = {
	destroy: () => void;
	seekTo: (seconds: number, allowSeekAhead: boolean) => void;
	playVideo: () => void;
	pauseVideo: () => void;
	getCurrentTime: () => number;
	getPlayerState: () => number;
};

export type YoutubePlayerEvent = {
	data: number;
	target: YoutubePlayer;
};

type YoutubePlayerOptions = {
	videoId: string;
	width?: string | number;
	height?: string | number;
	playerVars?: Record<string, string | number>;
	events?: {
		onReady?: (event: YoutubePlayerEvent) => void;
		onStateChange?: (event: YoutubePlayerEvent) => void;
		onError?: (event: YoutubePlayerEvent) => void;
	};
};

export type YoutubeApi = {
	Player: new (
		element: HTMLElement | string,
		options: YoutubePlayerOptions,
	) => YoutubePlayer;
	PlayerState: {
		UNSTARTED: number;
		ENDED: number;
		PLAYING: number;
		PAUSED: number;
		BUFFERING: number;
		CUED: number;
	};
};

declare global {
	interface Window {
		YT?: YoutubeApi;
		onYouTubeIframeAPIReady?: () => void;
	}
}

let apiPromise: Promise<YoutubeApi> | null = null;

export function loadYoutubeIframeApi(): Promise<YoutubeApi> {
	if (typeof window === "undefined") {
		return Promise.reject(new Error("YouTube IFrame API requires a browser"));
	}

	if (window.YT?.Player) {
		return Promise.resolve(window.YT);
	}

	if (!apiPromise) {
		apiPromise = new Promise<YoutubeApi>((resolve, reject) => {
			const previous = window.onYouTubeIframeAPIReady;
			window.onYouTubeIframeAPIReady = () => {
				previous?.();
				if (window.YT?.Player) {
					resolve(window.YT);
					return;
				}
				reject(new Error("YouTube IFrame API ready without Player"));
			};

			const existing = document.querySelector<HTMLScriptElement>(
				'script[src="https://www.youtube.com/iframe_api"]',
			);
			if (existing) {
				return;
			}

			const script = document.createElement("script");
			script.src = "https://www.youtube.com/iframe_api";
			script.async = true;
			script.onerror = () => {
				apiPromise = null;
				reject(new Error("Failed to load YouTube IFrame API"));
			};
			document.head.appendChild(script);
		});
	}

	return apiPromise;
}
