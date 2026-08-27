export const YOUTUBE_CLIENT_IDENTITY = 'https://github.com/NewaaDev/imazuma-music';

export type YouTubePlayer = {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVolume(): number;
  isMuted(): boolean;
  mute(): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  stopVideo(): void;
  unMute(): void;
};

type YouTubeEvent = { target: YouTubePlayer; data: number };
type YouTubeReadyEvent = { target: YouTubePlayer };
type YouTubePlayerOptions = {
  width: number;
  height: number;
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: YouTubeReadyEvent): void;
    onStateChange(event: YouTubeEvent): void;
    onError(event: YouTubeEvent): void;
    onAutoplayBlocked?(): void;
  };
};

export type YouTubeApi = {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled || !window.YT?.Player) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      resolve(window.YT);
    };
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { previousReady?.(); } catch { /* Un autre lecteur ne doit pas bloquer Inazuma. */ }
      finish();
    };

    const existing = document.getElementById('inazuma-youtube-iframe-api') as HTMLScriptElement | null;
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'inazuma-youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.clearInterval(poll);
        apiPromise = null;
        reject(new Error('Impossible de charger le lecteur YouTube.'));
      };
      document.head.appendChild(script);
    }

    const poll = window.setInterval(finish, 50);
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      apiPromise = null;
      reject(new Error('Le lecteur YouTube ne répond pas.'));
    }, 15_000);
  });

  return apiPromise;
}

export function youtubePlaybackError(code: number): string {
  if (code === 2) return 'Cette vidéo YouTube est invalide.';
  if (code === 5) return 'YouTube ne peut pas lire cette vidéo dans l’application.';
  if (code === 100) return 'Cette vidéo YouTube est privée ou a été supprimée.';
  if (code === 101 || code === 150) return 'Le propriétaire interdit la lecture de cette vidéo dans une application.';
  if (code === 153) return 'YouTube n’a pas reconnu Inazuma Music. Relance l’application puis réessaie.';
  return `Lecture YouTube impossible (erreur ${code || 'inconnue'}).`;
}
