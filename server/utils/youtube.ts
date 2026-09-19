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

export interface YouTubeSearchResultPage {
  items: PlaylistVideo[];
  nextPageToken?: string | null;
}

const parseDurationString = (timeStr?: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

export const scrapeYoutubeSearch = async (
  query: string,
  pageToken?: string,
): Promise<YouTubeSearchResultPage> => {
  // 1. If continuation token provided, use Innertube search continuation
  if (pageToken && pageToken.length > 20) {
    try {
      const postRes = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENTS[0],
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240101.00.00",
            },
          },
          continuation: pageToken,
        }),
      });

      if (postRes.ok) {
        const postData = await postRes.json();
        const contItems =
          postData.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction
            ?.continuationItems;
        const items: PlaylistVideo[] = [];
        let nextToken: string | null = null;

        if (Array.isArray(contItems)) {
          for (const item of contItems) {
            if (item.itemSectionRenderer?.contents) {
              for (const sub of item.itemSectionRenderer.contents) {
                const v = sub.videoRenderer;
                if (v?.videoId) {
                  items.push({
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                    name: v.title?.runs?.[0]?.text || "YouTube Video",
                    img:
                      v.thumbnail?.thumbnails?.[0]?.url ||
                      `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                    channel: v.ownerText?.runs?.[0]?.text || "YouTube",
                    duration: parseDurationString(v.lengthText?.simpleText),
                    type: "youtube",
                  });
                }
              }
            }
            if (
              item.continuationItemRenderer?.continuationEndpoint?.continuationCommand
                ?.token
            ) {
              nextToken =
                item.continuationItemRenderer.continuationEndpoint
                  .continuationCommand.token;
            }
          }
        }
        if (items.length > 0) {
          return { items, nextPageToken: nextToken };
        }
      }
    } catch (innerErr) {
      console.warn("Innertube continuation error:", innerErr);
    }
  }

  // 2. Initial page search scraping
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": USER_AGENTS[0],
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (res.ok) {
      const html = await res.text();
      const match =
        html.match(/var ytInitialData = ({.*?});<\/script>/) ||
        html.match(/ytInitialData\s*=\s*({.+?});/);

      if (match) {
        const data = JSON.parse(match[1]);
        const contents =
          data.contents?.twoColumnSearchResultsRenderer?.primaryContents
            ?.sectionListRenderer?.contents;
        const items: PlaylistVideo[] = [];
        let nextToken: string | null = null;

        if (Array.isArray(contents)) {
          for (const section of contents) {
            const itemSection = section.itemSectionRenderer?.contents;
            if (Array.isArray(itemSection)) {
              for (const item of itemSection) {
                const v = item.videoRenderer;
                if (v?.videoId) {
                  items.push({
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                    name: v.title?.runs?.[0]?.text || "YouTube Video",
                    img:
                      v.thumbnail?.thumbnails?.[0]?.url ||
                      `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                    channel: v.ownerText?.runs?.[0]?.text || "YouTube",
                    duration: parseDurationString(v.lengthText?.simpleText),
                    type: "youtube",
                  });
                }
              }
            }
            if (
              section.continuationItemRenderer?.continuationEndpoint
                ?.continuationCommand?.token
            ) {
              nextToken =
                section.continuationItemRenderer.continuationEndpoint
                  .continuationCommand.token;
            }
          }
        }

        if (items.length > 0) {
          return { items, nextPageToken: nextToken };
        }
      }
    }
  } catch (scrapeErr) {
    console.warn("YouTube scraping error:", scrapeErr);
  }

  // 3. Fallback: Invidious public instances
  const invidiousInstances = [
    "https://invidious.f5.si",
    "https://inv.nadeko.net",
  ];
  const pageNum =
    pageToken && !isNaN(Number(pageToken)) ? Math.max(1, Number(pageToken)) : 1;

  for (const instance of invidiousInstances) {
    try {
      const invRes = await fetch(
        `${instance}/api/v1/search?q=${encodeURIComponent(query)}&page=${pageNum}&type=video`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        },
      );
      if (invRes.ok) {
        const invData = await invRes.json();
        if (Array.isArray(invData) && invData.length > 0) {
          const items: PlaylistVideo[] = invData.map((d: any) => ({
            url: `https://www.youtube.com/watch?v=${d.videoId}`,
            name: d.title || "YouTube Video",
            img:
              d.videoThumbnails?.[0]?.url ||
              `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`,
            channel: d.author || "YouTube",
            duration: Number(d.lengthSeconds) || 0,
            type: "youtube",
          }));
          return {
            items,
            nextPageToken: items.length >= 10 ? String(pageNum + 1) : null,
          };
        }
      }
    } catch (_) {}
  }

  return { items: [], nextPageToken: null };
};

export const searchYoutube = async (
  query: string,
  pageToken?: string,
): Promise<YouTubeSearchResultPage> => {
  if (Youtube) {
    try {
      const response = await Youtube.search.list({
        part: ["snippet"],
        type: ["video"],
        maxResults: 25,
        q: query,
        pageToken: pageToken || undefined,
      });
      const items = response?.data?.items?.map(mapYoutubeSearchResult) ?? [];
      if (items.length > 0) {
        return {
          items,
          nextPageToken: response?.data?.nextPageToken ?? null,
        };
      }
    } catch (err) {
      console.warn("YouTube API search failed or quota exceeded, switching to fallback scraper:", err);
    }
  }

  // Seamless fallback when YouTube API is not configured, quota exceeded, or returns empty
  return await scrapeYoutubeSearch(query, pageToken);
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
  if (Youtube) {
    try {
      const response = await Youtube.videos.list({
        part: ["snippet", "contentDetails"],
        id: [id],
      });
      const top = response?.data?.items?.[0];
      if (top) {
        return mapYoutubeListResult(top);
      }
    } catch (err) {
      console.warn("YouTube videos.list API failed, switching to oEmbed fallback:", err);
    }
  }

  // Fallback to official YouTube oEmbed endpoint (no API key required)
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      return {
        url: `https://www.youtube.com/watch?v=${id}`,
        name: oembed.title || "YouTube Video",
        img: oembed.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        channel: oembed.author_name || "YouTube",
        duration: 0,
        type: "youtube",
      };
    }
  } catch (_) {}

  return {
    url: `https://www.youtube.com/watch?v=${id}`,
    name: "YouTube Video",
    img: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    channel: "YouTube",
    duration: 0,
    type: "youtube",
  };
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
