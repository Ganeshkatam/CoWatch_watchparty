import { isMagnet, isYouTube } from "./utils";

export const examples: SearchResult[] = [
  {
    name: "Charge — Blender Open Movie",
    channel: "WebM • Animated Short",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Charge_-_Blender_Open_Movie-full_movie.webm",
    img: "/previews/charge.jpg",
  },
  {
    name: "YouTube Sample Stream",
    channel: "YouTube",
    url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
    img: "/previews/youtube.jpg",
  },
  {
    name: "Big Buck Bunny (HLS Stream)",
    channel: "Mux Video • .m3u8",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    img: "/previews/bunny.jpg",
  },
  {
    name: "Sintel — Open Movie (WebTorrent)",
    channel: "WebTorrent Magnet • P2P",
    url: "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent",
    img: "/previews/sintel.jpg",
  },
  {
    name: "Spring — Blender Open Movie",
    channel: "WebM • Animated Short",
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Spring_-_Blender_Open_Movie.webm",
    img: "/previews/spring.jpg",
  },
  {
    name: "DASH Test Stream",
    channel: "DASH-IF • Manifest .mpd",
    url: "https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd",
    img: "",
  },
].map(
  (
    urlOrObject:
      | { url: string; img: string; name?: string; channel?: string }
      | string,
  ) => {
    const url = typeof urlOrObject === "object" ? urlOrObject.url : urlOrObject;
    let type: SearchResult["type"] = "file";
    if (isYouTube(url)) {
      type = "youtube";
    } else if (isMagnet(url)) {
      type = "magnet";
    }
    const img = typeof urlOrObject === "object" ? urlOrObject.img : "";
    const name =
      typeof urlOrObject === "object" && urlOrObject.name
        ? urlOrObject.name
        : url;
    const channel =
      typeof urlOrObject === "object" && urlOrObject.channel
        ? urlOrObject.channel
        : undefined;
    return {
      url,
      type,
      img,
      name,
      channel,
      duration: 0,
    };
  },
);
