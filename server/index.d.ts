export interface YoutubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YoutubeResult {
  kind?: string;
  etag?: string;
  id?: string | { videoId?: string };
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    description?: string;
    thumbnails?: {
      default?: YoutubeThumbnail;
      medium?: YoutubeThumbnail;
      high?: YoutubeThumbnail;
      standard?: YoutubeThumbnail;
      maxres?: YoutubeThumbnail;
    };
    channelTitle?: string;
    tags?: string[];
    categoryId?: string;
    liveBroadcastContent?: string;
    localized?: {
      title?: string;
      description?: string;
    };
    defaultAudioLanguage?: string;
  };
}
