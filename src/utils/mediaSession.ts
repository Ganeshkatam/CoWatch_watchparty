export interface MediaMetadataPayload {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
  roomCoverUrl?: string | null;
}

export interface MediaSessionPositionPayload {
  duration: number;
  currentTime: number;
  playbackRate?: number;
}

export interface MediaSessionActions {
  play?: () => void | Promise<void>;
  pause?: () => void | Promise<void>;
  seek?: (seconds: number) => void | Promise<void>;
  seekBackward?: (seconds: number) => void | Promise<void>;
  seekForward?: (seconds: number) => void | Promise<void>;
  next?: () => void | Promise<void>;
  previous?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
  enterpictureinpicture?: () => void | Promise<void>;
}

export interface MediaSessionPlaylistState {
  hasNext?: boolean;
  hasPrevious?: boolean;
}

const DEFAULT_ARTWORK = "/screenshot_full.png";

const REGISTERED_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "seekbackward",
  "seekforward",
  "seekto",
  "previoustrack",
  "nexttrack",
  "stop",
  "enterpictureinpicture" as MediaSessionAction,
];

export function isMediaSessionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "mediaSession" in navigator &&
    Boolean(navigator.mediaSession)
  );
}

function safeSetActionHandler(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
): void {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch (err) {
    // Some browsers throw for unsupported action names
  }
}

/**
 * Resolves deterministic artwork for MediaSession.
 * Hierarchy: Media Thumbnail -> Room Cover -> Default CoWatch Artwork
 */
export function resolveArtwork(
  artworkUrl?: string | null,
  roomCoverUrl?: string | null
): MediaImage[] {
  const candidate = (artworkUrl && artworkUrl.trim()) ||
    (roomCoverUrl && roomCoverUrl.trim()) ||
    DEFAULT_ARTWORK;

  if (!candidate) {
    return [];
  }

  // Ensure absolute or valid root URL
  let resolvedSrc = candidate;
  if (typeof window !== "undefined" && !candidate.startsWith("http://") && !candidate.startsWith("https://")) {
    try {
      resolvedSrc = new URL(candidate, window.location.origin).href;
    } catch {
      resolvedSrc = candidate;
    }
  }

  return [
    {
      src: resolvedSrc,
      sizes: "512x512",
      type: resolvedSrc.endsWith(".svg") ? "image/svg+xml" : "image/png",
    },
  ];
}

/**
 * Updates MediaSession metadata with capability check and deterministic artwork resolution.
 */
export function updateMediaSessionMetadata(payload: MediaMetadataPayload): void {
  if (!isMediaSessionSupported()) return;

  try {
    const title = payload.title?.trim() || "CoWatch Watch Party";
    const artist = payload.artist?.trim() || "CoWatch";
    const album = payload.album?.trim() || "Watch Party";
    const artwork = resolveArtwork(payload.artworkUrl, payload.roomCoverUrl);

    if (typeof window.MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title,
        artist,
        album,
        artwork,
      });
    }
  } catch (err) {
    console.warn("Failed to update MediaSession metadata:", err);
  }
}

/**
 * Updates MediaSession playback state ("playing" | "paused" | "none").
 */
export function updateMediaSessionPlaybackState(paused: boolean): void {
  if (!isMediaSessionSupported()) return;

  try {
    navigator.mediaSession.playbackState = paused ? "paused" : "playing";
  } catch {
    // Ignore playbackState sync errors
  }
}

let lastPositionUpdate = 0;
const POSITION_UPDATE_THROTTLE_MS = 250;

/**
 * Updates MediaSession position state with strict normalization and validation.
 * Avoids throwing on invalid or infinite inputs.
 */
export function updateMediaSessionPosition(
  payload: MediaSessionPositionPayload,
  force = false
): void {
  if (!isMediaSessionSupported()) return;

  const now = Date.now();
  if (!force && now - lastPositionUpdate < POSITION_UPDATE_THROTTLE_MS) {
    return;
  }
  lastPositionUpdate = now;

  const { duration, currentTime, playbackRate = 1.0 } = payload;

  // Strict validation: duration must be positive and finite
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  // Current position must be finite and within [0, duration]
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return;
  }
  const safePosition = Math.min(currentTime, duration);

  // Playback rate must be positive and finite
  const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1.0;

  try {
    if (typeof navigator.mediaSession.setPositionState === "function") {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: safeRate,
        position: safePosition,
      });
    }
  } catch {
    // Ignore position state errors
  }
}

/**
 * Registers room playback action handlers onto navigator.mediaSession.
 * Conditionally attaches playlist actions based on whether a next/previous track exists.
 */
export function setupMediaSessionActionHandlers(
  actions: MediaSessionActions,
  playlistState: MediaSessionPlaylistState = {}
): void {
  if (!isMediaSessionSupported()) return;

  // Play / Pause
  if (actions.play) {
    safeSetActionHandler("play", () => {
      actions.play?.();
    });
  } else {
    safeSetActionHandler("play", null);
  }

  if (actions.pause) {
    safeSetActionHandler("pause", () => {
      actions.pause?.();
    });
  } else {
    safeSetActionHandler("pause", null);
  }

  // Seek Backward (respect details.seekOffset or default to 10 seconds)
  if (actions.seekBackward) {
    safeSetActionHandler("seekbackward", (details) => {
      const offset = details.seekOffset && details.seekOffset > 0 ? details.seekOffset : 10;
      actions.seekBackward?.(offset);
    });
  } else {
    safeSetActionHandler("seekbackward", null);
  }

  // Seek Forward (respect details.seekOffset or default to 10 seconds)
  if (actions.seekForward) {
    safeSetActionHandler("seekforward", (details) => {
      const offset = details.seekOffset && details.seekOffset > 0 ? details.seekOffset : 10;
      actions.seekForward?.(offset);
    });
  } else {
    safeSetActionHandler("seekforward", null);
  }

  // Seek To
  if (actions.seek) {
    safeSetActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null && Number.isFinite(details.seekTime)) {
        actions.seek?.(details.seekTime);
      }
    });
  } else {
    safeSetActionHandler("seekto", null);
  }

  // Playlist Next Track (registered only when next item is available)
  if (playlistState.hasNext && actions.next) {
    safeSetActionHandler("nexttrack", () => {
      actions.next?.();
    });
  } else {
    safeSetActionHandler("nexttrack", null);
  }

  // Playlist Previous Track (registered only when previous item is available)
  if (playlistState.hasPrevious && actions.previous) {
    safeSetActionHandler("previoustrack", () => {
      actions.previous?.();
    });
  } else {
    safeSetActionHandler("previoustrack", null);
  }

  // Stop handler (only registered if explicitly supplied, independent of room lifecycle)
  if (actions.stop) {
    safeSetActionHandler("stop", () => {
      actions.stop?.();
    });
  } else {
    safeSetActionHandler("stop", null);
  }

  // Progressive enterpictureinpicture action handler
  if (actions.enterpictureinpicture) {
    safeSetActionHandler("enterpictureinpicture" as MediaSessionAction, () => {
      actions.enterpictureinpicture?.();
    });
  } else {
    safeSetActionHandler("enterpictureinpicture" as MediaSessionAction, null);
  }
}

/**
 * Idempotently tears down the MediaSession metadata and unregisters all actions.
 * Safe to call multiple times.
 */
export function clearMediaSession(): void {
  if (!isMediaSessionSupported()) return;

  try {
    navigator.mediaSession.playbackState = "none";
  } catch {
    // Ignore
  }

  try {
    navigator.mediaSession.metadata = null;
  } catch {
    // Ignore
  }

  for (const action of REGISTERED_ACTIONS) {
    safeSetActionHandler(action, null);
  }

  try {
    if (typeof navigator.mediaSession.setPositionState === "function") {
      navigator.mediaSession.setPositionState(undefined);
    }
  } catch {
    // Ignore
  }
}
