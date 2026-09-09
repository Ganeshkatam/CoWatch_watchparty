import { MediaPlayerClass } from "dashjs";
import { Player } from "./Player";
import { pipManager } from "../../utils/pipManager";
import { getYoutubeVideoID } from "../../utils/utils";

export class YouTube implements Player {
  coWatchYTPlayer: YT.Player | null;
  constructor(coWatchYTPlayer: YT.Player | null) {
    this.coWatchYTPlayer = coWatchYTPlayer;
  }
  clearDashState = () => { };
  setDashState = (_player: MediaPlayerClass) => { };

  getCurrentTime = () => {
    try {
      return this.coWatchYTPlayer?.getCurrentTime() ?? 0;
    } catch (e) {
      return 0;
    }
  };

  getDuration = () => {
    try {
      return this.coWatchYTPlayer?.getDuration() ?? 0;
    } catch (e) {
      return 0;
    }
  };

  isMuted = () => {
    try {
      return this.coWatchYTPlayer?.isMuted() ?? false;
    } catch (e) {
      return false;
    }
  };

  isSubtitled = (): boolean => {
    return false;
  };

  getPlaybackRate = (): number => {
    try {
      return this.coWatchYTPlayer?.getPlaybackRate() ?? 1;
    } catch (e) {
      return 1;
    }
  };

  setPlaybackRate = (rate: number) => {
    try {
      this.coWatchYTPlayer?.setPlaybackRate(rate);
    } catch (e) {
      console.warn("Error setting playback rate:", e);
    }
  };

  setSrcAndTime = async (src: string, time: number) => {
    const videoId = getYoutubeVideoID(src);
    if (!videoId) {
      console.warn("Invalid YouTube video URL or ID:", src);
      return;
    }
    if (!this.coWatchYTPlayer) {
      console.warn("YouTube player not ready yet when setting src:", src);
      return;
    }
    try {
      this.coWatchYTPlayer.cueVideoById({
        videoId,
        startSeconds: time,
      });
    } catch (e) {
      console.warn("Error in YouTube cueVideoById:", e);
    }
  };

  playVideo = async () => {
    if (!this.coWatchYTPlayer) return;
    try {
      this.coWatchYTPlayer.playVideo();
      // Ensure playback starts if player was in CUED or UNSTARTED state
      setTimeout(() => {
        try {
          const state = this.coWatchYTPlayer?.getPlayerState();
          if (
            state === window.YT?.PlayerState?.CUED ||
            state === window.YT?.PlayerState?.UNSTARTED
          ) {
            this.coWatchYTPlayer?.playVideo();
          }
        } catch (err) {
          // ignore
        }
      }, 150);
    } catch (e) {
      console.warn("Error playing YouTube video:", e);
    }
  };

  pauseVideo = () => {
    try {
      this.coWatchYTPlayer?.pauseVideo();
    } catch (e) {
      console.warn("Error pausing YouTube video:", e);
    }
  };

  seekVideo = (time: number) => {
    try {
      this.coWatchYTPlayer?.seekTo(time, true);
    } catch (e) {
      console.warn("Error seeking YouTube video:", e);
    }
  };

  shouldPlay = () => {
    try {
      const state = this.coWatchYTPlayer?.getPlayerState();
      return (
        state === window.YT?.PlayerState?.PAUSED ||
        state === window.YT?.PlayerState?.CUED ||
        state === window.YT?.PlayerState?.UNSTARTED ||
        (this.getDuration() > 0 && this.getCurrentTime() >= this.getDuration())
      );
    } catch (e) {
      return false;
    }
  };

  setMute = (muted: boolean) => {
    try {
      if (muted) {
        this.coWatchYTPlayer?.mute();
      } else {
        this.coWatchYTPlayer?.unMute();
      }
    } catch (e) {
      console.warn("Error toggling mute on YouTube video:", e);
    }
  };

  setVolume = (volume: number) => {
    try {
      this.coWatchYTPlayer?.setVolume(volume * 100);
    } catch (e) {
      console.warn("Error setting volume on YouTube video:", e);
    }
  };

  getVolume = (): number => {
    try {
      const volume = this.coWatchYTPlayer?.getVolume();
      return (volume ?? 0) / 100;
    } catch (e) {
      return 1;
    }
  };

  setSubtitleMode = (mode?: TextTrackMode, lang?: string) => {
    try {
      if (mode === "showing") {
        //@ts-expect-error
        this.coWatchYTPlayer?.setOption("captions", "reload", true);
        //@ts-expect-error
        this.coWatchYTPlayer?.setOption("captions", "track", {
          languageCode: lang ?? "en",
        });
      }
      if (mode === "hidden") {
        //@ts-expect-error
        this.coWatchYTPlayer?.setOption("captions", "track", {});
      }
    } catch (e) {
      console.warn("Error setting YouTube subtitles:", e);
    }
  };

  getSubtitleMode = () => {
    return "hidden" as TextTrackMode;
  };

  isReady = () => {
    return Boolean(
      this.coWatchYTPlayer &&
      typeof this.coWatchYTPlayer.cueVideoById === "function"
    );
  };

  stopVideo = () => {
    try {
      this.coWatchYTPlayer?.stopVideo();
    } catch (e) {
      // ignore
    }
  };

  clearState = () => {
    return;
  };

  loadSubtitles = async (_src: string) => {
    return;
  };

  syncSubtitles = (_sharerTime: number) => {
    return;
  };

  getTimeRanges = (): { start: number; end: number }[] => {
    try {
      return [
        {
          start: 0,
          end:
            (this.coWatchYTPlayer?.getVideoLoadedFraction() ?? 0) *
            this.getDuration(),
        },
      ];
    } catch (e) {
      return [{ start: 0, end: 0 }];
    }
  };

  setLoop = (loop: boolean): void => {
    try {
      this.coWatchYTPlayer?.setLoop(loop);
    } catch (e) {
      console.warn("Error setting loop:", e);
    }
  };

  getVideoEl = (): HTMLMediaElement => {
    return document.getElementById("leftYt") as unknown as HTMLMediaElement;
  };

  isPictureInPictureSupported = (): boolean => {
    return pipManager.isDocumentPiPSupported();
  };

  togglePictureInPicture = async (): Promise<void> => {
    const container =
      document.getElementById("leftYtContainer") ||
      document.getElementById("leftYt");
    if (!container) return;
    await pipManager.toggle(container);
  };
}
