import { normalizeYouTubeUrl } from "./youtube.ts";

/**
 * Finds a video in a playlist array matching the supplied URL.
 * Uses the application's existing canonicalization rules (normalizeYouTubeUrl)
 * so that YouTube URL variations (youtu.be, watch?v=, youtube.com) match identically.
 */
export const findPlaylistVideoByUrl = (
  playlist: PlaylistVideo[],
  url?: string | null,
): PlaylistVideo | undefined => {
  if (!url || typeof url !== "string") return undefined;
  const canonicalTarget = normalizeYouTubeUrl(url.trim());
  return playlist.find(
    (video) => normalizeYouTubeUrl(video.url?.trim() ?? "") === canonicalTarget,
  );
};

/**
 * Returns the index of a video in a playlist array matching the supplied URL,
 * adhering to canonical YouTube URL comparison rules.
 */
export const findPlaylistIndexByUrl = (
  playlist: PlaylistVideo[],
  url?: string | null,
): number => {
  if (!url || typeof url !== "string") return -1;
  const canonicalTarget = normalizeYouTubeUrl(url.trim());
  return playlist.findIndex(
    (video) => normalizeYouTubeUrl(video.url?.trim() ?? "") === canonicalTarget,
  );
};
