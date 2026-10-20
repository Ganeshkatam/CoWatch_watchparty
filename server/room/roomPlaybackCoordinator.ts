import config from "../config.ts";
import axios from "axios";
import { Server, Socket } from "socket.io";
import { redisCount } from "../utils/redis.ts";
import { findPlaylistVideoByUrl } from "../utils/playlist.ts";
import {
  fetchYoutubeVideo,
  getYoutubeVideoID,
  normalizeYouTubeUrl,
  isYouTube,
} from "../utils/youtube.ts";
//@ts-expect-error
import twitch from "twitch-m3u8";
import { TimelineAuthority } from "../timelineAuthority.ts";

export interface RoomPlaybackCoordinatorDependencies {
  roomId: string;
  io: Server;
  tsMap: NumberDict;
  canControlPlayback: (socket: Socket | null | undefined) => boolean;
  hasProcessedOperation: (clientId: string, operationId?: string) => boolean;
  recordProcessedOperation: (clientId: string, operationId?: string) => void;
  addChatMessage: (socket: Socket | null, chatMsg: ChatMessageBase) => Promise<void>;
  terminateSignalingSession: () => void;
  sendRoster: () => void;
  getHostState: () => HostState;
  resetSubtitle: () => void;
}

export class RoomPlaybackCoordinator {
  public video: string = "";
  public paused: boolean = false;
  public playbackRate: number = 1;
  public loop: boolean = false;
  public playlist: PlaylistVideo[] = [];
  public timeline: TimelineAuthority = new TimelineAuthority();
  public preventTSUpdate: boolean = false;
  public lastTsMap: number = Date.now();

  public get videoTS(): number {
    return this.timeline.getCanonicalTime();
  }

  private readonly deps: RoomPlaybackCoordinatorDependencies;

  constructor(deps: RoomPlaybackCoordinatorDependencies) {
    this.deps = deps;
  }

  public cmdHost = (socket: Socket | null, data: string) => {
    if (data && data.length > 50000) {
      return;
    }
    if (this.video?.startsWith("localmedia://") && !data?.startsWith("localmedia://")) {
      this.deps.terminateSignalingSession();
    }
    this.video = data;
    this.paused = false;
    this.deps.resetSubtitle();
    this.loop = false;
    this.playbackRate = 1;
    this.timeline.setMediaSource(data);
    for (const key of Object.keys(this.deps.tsMap)) {
      delete this.deps.tsMap[key];
    }
    this.preventTSUpdate = true;
    setTimeout(() => (this.preventTSUpdate = false), 1000);
    this.deps.io.of(this.deps.roomId).emit("REC:tsMap", this.deps.tsMap);
    this.deps.io.of(this.deps.roomId).emit("REC:host", this.deps.getHostState());
    this.deps.io.of(this.deps.roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload());
    if (socket && data) {
      const chatMsg = { id: socket.clientId, cmd: "host", msg: data };
      this.deps.addChatMessage(socket, chatMsg);
    }
    if (data === "") {
      this.playlistNext(null);
    }

    // Resend the roster (updates screenshare state etc)
    this.deps.sendRoster();
  };

  public startHosting = async (socket: Socket, data: string) => {
    redisCount("urlStarts");
    if (config.STREAM_PATH && data?.startsWith(config.STREAM_PATH)) {
      redisCount("streamStarts");
    }
    if (config.CONVERT_PATH && data?.startsWith(config.CONVERT_PATH)) {
      redisCount("convertStarts");
    }
    // If a reddit URL, extract video URL
    if (
      data?.startsWith("https://www.reddit.com") ||
      data?.startsWith("https://old.reddit.com") ||
      data?.startsWith("https://reddit.com")
    ) {
      if (data.endsWith("/")) {
        // Remove trailing slash
        data = data.slice(0, -1);
      }
      data = data + ".json";
      // Extract fallback_url
      const resp = await axios.get(data);
      const json = resp.data;
      let reddit_m3u8 =
        json?.[0]?.data?.children?.[0]?.data?.secure_media?.reddit_video
          ?.hls_url;
      let reddit_mp4 =
        json?.[0]?.data?.children?.[0]?.data?.secure_media?.reddit_video
          ?.fallback_url;
      // prefer reddit m3u8 streams over the mp4 links as the m3u8 streams contain audio.
      data = reddit_m3u8 || reddit_mp4 || data;
    } else if (
      data?.startsWith("https://www.twitch.tv") ||
      data?.startsWith("https://twitch.tv")
    ) {
      try {
        // Extract m3u8 data
        // Note this won't work directly since Twitch will reject requests from the wrong origin--need to proxy the m3u8 playlist
        const channel = data.split("/").slice(-1)[0];
        const isStream = isNaN(Number(channel));
        let streams = [];
        if (isStream) {
          streams = await twitch.getStream(channel);
        } else {
          streams = await twitch.getVod(channel);
        }
        const target =
          streams.find((str: any) => str.quality.includes("(source)")) ||
          streams[0];
        const parsed = new URL(target?.url);
        const newUrl = new URL(config.TWITCH_PROXY_PATH);
        newUrl.pathname = "/proxy" + parsed.pathname;
        newUrl.searchParams.set("host", parsed.host);
        newUrl.searchParams.set("displayName", data);
        newUrl.search = newUrl.searchParams.toString();
        data = newUrl.toString();
      } catch (e) {
        console.warn(e);
      }
    } else if (isYouTube(data)) {
      data = normalizeYouTubeUrl(data);
    }
    this.cmdHost(socket, data);
  };

  public playlistNext = (raw: unknown) => {
    const data = raw ? String(raw) : null;
    // Clients may pass the URL that should be the current one.
    // If we've already advanced the playlist, we can ignore duplicate calls
    if (
      data &&
      this.video &&
      data !== this.video &&
      getYoutubeVideoID(data) !== getYoutubeVideoID(this.video)
    ) {
      // Validation didn't match
      return;
    }
    const next = this.playlist.shift();
    this.deps.io.of(this.deps.roomId).emit("playlist", this.playlist);
    if (next) {
      this.cmdHost(null, next.url);
    }
  };

  public playlistAdd = async (socket: Socket | null, data: string) => {
    if (data && data.length > 20000) {
      return;
    }
    redisCount("playlistAdds");
    const youtubeVideoId = getYoutubeVideoID(data);
    const targetUrl = youtubeVideoId ? normalizeYouTubeUrl(data) : data;
    const item: PlaylistVideo = {
      name: data,
      channel: youtubeVideoId ? "YouTube" : "Video URL",
      duration: 0,
      url: targetUrl,
      type: youtubeVideoId ? "youtube" : data.startsWith("magnet:") ? "magnet" : "file",
    };
    let video: PlaylistVideo | null = null;
    const existing = findPlaylistVideoByUrl(this.playlist, targetUrl);
    if (existing) {
      video = { ...existing };
    } else {
      try {
        if (youtubeVideoId) {
          video = await fetchYoutubeVideo(youtubeVideoId);
        }
      } catch (e) {
        // Failed to fetch YouTube video info but can still add the URL
        console.warn(e);
      }
    }
    if (video) {
      this.playlist.push(video);
    } else {
      this.playlist.push(item);
    }
    this.deps.io.of(this.deps.roomId).emit("playlist", this.playlist);
    const clientId = socket?.clientId;
    if (clientId) {
      const chatMsg = {
        id: clientId,
        cmd: "playlistAdd",
        msg: data,
      };
      this.deps.addChatMessage(socket, chatMsg);
    }
    if (!this.video) {
      this.playlistNext(null);
    }
  };

  public playlistDelete = (index: number) => {
    if (index !== -1) {
      this.playlist.splice(index, 1);
      this.deps.io.of(this.deps.roomId).emit("playlist", this.playlist);
    }
  };

  public playlistMove = (raw: unknown) => {
    const data = raw as { index: number; toIndex: number };
    if (!data) {
      return;
    }
    if (data.index !== -1) {
      const items = this.playlist.splice(data.index, 1);
      this.playlist.splice(data.toIndex, 0, items[0]);
      this.deps.io.of(this.deps.roomId).emit("playlist", this.playlist);
    }
  };

  public playVideo = (socket: Socket, operationId?: string) => {
    if (!this.deps.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    if (this.deps.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.deps.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.play();
    this.paused = false;
    socket.broadcast.emit("REC:play", this.video);
    this.deps.io.of(this.deps.roomId).emit(
      "REC:playbackSync",
      this.timeline.generateSyncPayload(undefined, undefined, operationId),
    );
    const chatMsg = {
      id: socket.clientId,
      cmd: "play",
      msg: this.deps.tsMap[socket.clientId]?.toString(),
    };
    this.deps.addChatMessage(socket, chatMsg);
  };

  public pauseVideo = (socket: Socket, operationId?: string) => {
    if (!this.deps.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    if (this.deps.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.deps.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.pause();
    this.paused = true;
    socket.broadcast.emit("REC:pause");
    this.deps.io.of(this.deps.roomId).emit(
      "REC:playbackSync",
      this.timeline.generateSyncPayload(undefined, undefined, operationId),
    );
    const chatMsg = {
      id: socket.clientId,
      cmd: "pause",
      msg: this.deps.tsMap[socket.clientId]?.toString(),
    };
    this.deps.addChatMessage(socket, chatMsg);
  };

  public seekVideo = (
    socket: Socket,
    data: number | { time: number; operationId?: string },
  ) => {
    if (!this.deps.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    const rawTarget =
      typeof data === "object" ? Number(data?.time) : Number(data);
    const operationId =
      typeof data === "object" ? data?.operationId : undefined;
    if (String(rawTarget).length > 100 || !Number.isFinite(rawTarget)) {
      return;
    }
    if (this.deps.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.deps.recordProcessedOperation(socket.clientId, operationId);
    const targetTime = Math.max(0, rawTarget);
    this.timeline.seek(targetTime);
    socket.broadcast.emit("REC:seek", targetTime);
    this.deps.io.of(this.deps.roomId).emit(
      "REC:playbackSync",
      this.timeline.generateSyncPayload(undefined, undefined, operationId),
    );
    const chatMsg = {
      id: socket.clientId,
      cmd: "seek",
      msg: targetTime?.toString(),
    };
    this.deps.addChatMessage(socket, chatMsg);
  };

  public setPlaybackRate = (
    socket: Socket,
    data: number | { rate: number; operationId?: string },
  ) => {
    if (!this.deps.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    const rawRate =
      typeof data === "object" ? Number(data?.rate) : Number(data);
    const operationId =
      typeof data === "object" ? data?.operationId : undefined;
    if (
      String(rawRate).length > 100 ||
      !Number.isFinite(rawRate) ||
      rawRate <= 0 ||
      rawRate > 16
    ) {
      return;
    }
    if (this.deps.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.deps.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.setPlaybackRate(rawRate);
    this.playbackRate = rawRate;
    this.deps.io.of(this.deps.roomId).emit("REC:playbackRate", rawRate);
    this.deps.io.of(this.deps.roomId).emit(
      "REC:playbackSync",
      this.timeline.generateSyncPayload(undefined, undefined, operationId),
    );
    const chatMsg = {
      id: socket.clientId,
      cmd: "playbackRate",
      msg: rawRate?.toString(),
    };
    this.deps.addChatMessage(socket, chatMsg);
  };

  public setLoop = (data: boolean) => {
    if (String(data).length > 100) {
      return;
    }
    this.loop = data;
    this.deps.io.of(this.deps.roomId).emit("REC:loop", data);
  };

  public setTimestamp = (socket: Socket, data: number) => {
    if (
      String(data).length > 100 ||
      typeof data !== "number" ||
      !Number.isFinite(data)
    ) {
      return;
    }
    // Prevent lagging TS updates from the old video from messing up our timestamps
    if (this.preventTSUpdate) {
      return;
    }
    // AUD-006: CMD:ts is strictly non-authoritative client telemetry for presence / roster display.
    // It NEVER mutates this.videoTS or this.timeline.
    const sanitizedTs = Math.max(0, Math.round(data * 100) / 100);
    const timeSinceTsMap = Date.now() - this.lastTsMap;
    this.deps.tsMap[socket.clientId] = sanitizedTs - timeSinceTsMap / 1000 + 1;
  };
}
