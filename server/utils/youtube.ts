import config from "../config.ts";
import type { YoutubeResult } from "../index.d.ts";
import {
  PT_HOURS_REGEX,
  PT_MINUTES_REGEX,
  PT_SECONDS_REGEX,
  YOUTUBE_VIDEO_ID_REGEX,
} from "./regex.ts";
import { youtube, youtube_v3 } from "@googleapis/youtube";

let Youtube = config.YOUTUBE_API_KEY
  ? youtube({
      version: "v3",
      auth: config.YOUTUBE_API_KEY,
    })
  : null;

export const mapYoutubeSearchResult = (
  video: youtube_v3.Schema$SearchResult,
): PlaylistVideo => {
  return {
    channel: video.snippet?.channelTitle ?? "",
    url: "https://www.youtube.com/watch?v=" + video?.id?.videoId,
    name: video.snippet?.title ?? "",
    img: video.snippet?.thumbnails?.default?.url ?? "",
    duration: 0,
    type: "youtube",
  };
};

export const mapYoutubeListResult = (
  video: youtube_v3.Schema$Video,
): PlaylistVideo => {
  const videoId = video.id;
  return {
    url: "https://www.youtube.com/watch?v=" + videoId,
    name: video.snippet?.title ?? "",
    img: video.snippet?.thumbnails?.default?.url ?? "",
    channel: video.snippet?.channelTitle ?? "",
    duration: getVideoDuration(video.contentDetails?.duration ?? ""),
    type: "youtube",
  };
};

export const mapYoutubePlaylistResult = (
  item: youtube_v3.Schema$PlaylistItem,
): PlaylistVideo => {
  return {
    url: "https://www.youtube.com/watch?v=" + item.snippet?.resourceId?.videoId,
    name: item.snippet?.title ?? "",
    img: item.snippet?.thumbnails?.default?.url ?? "",
    channel: item.snippet?.channelTitle ?? "",
    duration: 0,
    // duration: getVideoDuration(video.contentDetails?.duration ?? ''),
    type: "youtube",
  };
};

/**
 * Defensively maps a raw YouTube API result to a PlaylistVideo object with
 * deterministic fallbacks for missing snippets, titles, channels, and thumbnails.
 * Thumbnail fallback order: high -> medium -> standard -> default -> "".
 */
export const mapYoutubeResult = (
  item?: YoutubeResult | null,
  videoId?: string,
): PlaylistVideo => {
  const resolvedId =
    videoId ||
    (typeof item?.id === "string" ? item.id : item?.id?.videoId) ||
    "";
  const url = resolvedId ? `https://www.youtube.com/watch?v=${resolvedId}` : "";

  const thumbnails = item?.snippet?.thumbnails;
  const img =
    thumbnails?.high?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.standard?.url ||
    thumbnails?.default?.url ||
    "";

  return {
    url,
    name: item?.snippet?.title || resolvedId || "YouTube Video",
    img,
    channel: item?.snippet?.channelTitle || "YouTube",
    duration: 0,
    type: "youtube",
  };
};

export const searchYoutube = async (
  query: string,
): Promise<PlaylistVideo[]> => {
  const response = await Youtube?.search.list({
    part: ["snippet"],
    type: ["video"],
    maxResults: 25,
    q: query,
  });
  return response?.data?.items?.map(mapYoutubeSearchResult) ?? [];
};

export const youtubePlaylist = async (
  playlistId: string,
): Promise<PlaylistVideo[]> => {
  const response = await Youtube?.playlistItems.list({
    part: ["snippet"],
    playlistId,
    maxResults: 100,
  });
  return response?.data?.items?.map(mapYoutubePlaylistResult) ?? [];
};

export const getYoutubeVideoID = (url: string): string | undefined => {
  if (!url || typeof url !== "string") {
    return undefined;
  }
  const trimmed = url.trim();
  const idParts = YOUTUBE_VIDEO_ID_REGEX.exec(trimmed);
  if (idParts && idParts[1]) {
    return idParts[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
};

export const normalizeYouTubeUrl = (url: string): string => {
  const id = getYoutubeVideoID(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
};

export const isYouTube = (input: string): boolean => {
  if (!input || typeof input !== "string") {
    return false;
  }
  return Boolean(getYoutubeVideoID(input));
};

export const fetchYoutubeVideo = async (
  id: string,
): Promise<PlaylistVideo | null> => {
  const response = await Youtube?.videos.list({
    part: ["snippet", "contentDetails"],
    id: [id],
  });
  const top = response?.data?.items?.[0];
  return top ? mapYoutubeListResult(top) : null;
};

export const getVideoDuration = (string: string): number => {
  if (!string) {
    return 0;
  }
  const hoursParts = PT_HOURS_REGEX.exec(string);
  const minutesParts = PT_MINUTES_REGEX.exec(string);
  const secondsParts = PT_SECONDS_REGEX.exec(string);

  const hours = hoursParts ? parseInt(hoursParts[1]) : 0;
  const minutes = minutesParts ? parseInt(minutesParts[1]) : 0;
  const seconds = secondsParts ? parseInt(secondsParts[1]) : 0;

  const totalSeconds = seconds + minutes * 60 + hours * 60 * 60;
  return totalSeconds;
};
