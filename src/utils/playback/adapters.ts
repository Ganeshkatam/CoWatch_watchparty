export interface PlaybackAdapter {
  getCurrentTime(): number;
  setCurrentTime(seconds: number): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  isPaused(): boolean;
  isReady(): boolean;
}

export class Html5VideoAdapter implements PlaybackAdapter {
  private element: HTMLVideoElement | null;

  constructor(element: HTMLVideoElement | null) {
    this.element = element;
  }

  public setElement(element: HTMLVideoElement | null): void {
    this.element = element;
  }

  public getCurrentTime(): number {
    return this.element?.currentTime ?? 0;
  }

  public setCurrentTime(seconds: number): void {
    if (this.element && Number.isFinite(seconds)) {
      this.element.currentTime = Math.max(0, seconds);
    }
  }

  public getPlaybackRate(): number {
    return this.element?.playbackRate ?? 1.0;
  }

  public setPlaybackRate(rate: number): void {
    if (this.element && rate > 0) {
      this.element.playbackRate = rate;
    }
  }

  public isPaused(): boolean {
    return this.element ? this.element.paused : true;
  }

  public isReady(): boolean {
    if (!this.element) return false;
    // HAVE_CURRENT_DATA (2) or higher indicates frame is ready and not stalled
    return this.element.readyState >= 2 && !this.element.seeking;
  }
}

export class YouTubeAdapter implements PlaybackAdapter {
  private player: any;
  private currentRate: number = 1.0;

  constructor(player: any) {
    this.player = player;
  }

  public setPlayer(player: any): void {
    this.player = player;
  }

  public getCurrentTime(): number {
    try {
      if (this.player && typeof this.player.getCurrentTime === "function") {
        return this.player.getCurrentTime() || 0;
      }
    } catch {
      // Fallback
    }
    return 0;
  }

  public setCurrentTime(seconds: number): void {
    try {
      if (this.player && typeof this.player.seekTo === "function" && Number.isFinite(seconds)) {
        this.player.seekTo(Math.max(0, seconds), true);
      }
    } catch {
      // Fallback
    }
  }

  public getPlaybackRate(): number {
    try {
      if (this.player && typeof this.player.getPlaybackRate === "function") {
        return this.player.getPlaybackRate() || this.currentRate;
      }
    } catch {
      // Fallback
    }
    return this.currentRate;
  }

  public setPlaybackRate(rate: number): void {
    this.currentRate = rate;
    try {
      if (this.player && typeof this.player.setPlaybackRate === "function" && rate > 0) {
        this.player.setPlaybackRate(rate);
      }
    } catch {
      // Fallback
    }
  }

  public isPaused(): boolean {
    try {
      if (this.player && typeof this.player.getPlayerState === "function") {
        // YT.PlayerState.PAUSED is 2, UNSTARTED is -1, CUED is 5
        const state = this.player.getPlayerState();
        return state === 2 || state === -1 || state === 5;
      }
    } catch {
      // Fallback
    }
    return true;
  }

  public isReady(): boolean {
    try {
      if (this.player && typeof this.player.getPlayerState === "function") {
        const state = this.player.getPlayerState();
        // 3 is BUFFERING
        return state !== 3 && state !== -1;
      }
    } catch {
      // Fallback
    }
    return false;
  }
}

export class HlsDashAdapter implements PlaybackAdapter {
  private element: HTMLVideoElement | null;
  private engine: any;

  constructor(element: HTMLVideoElement | null, engine?: any) {
    this.element = element;
    this.engine = engine;
  }

  public setElement(element: HTMLVideoElement | null, engine?: any): void {
    this.element = element;
    if (engine !== undefined) this.engine = engine;
  }

  public getCurrentTime(): number {
    return this.element?.currentTime ?? 0;
  }

  public setCurrentTime(seconds: number): void {
    if (this.element && Number.isFinite(seconds)) {
      this.element.currentTime = Math.max(0, seconds);
    }
  }

  public getPlaybackRate(): number {
    return this.element?.playbackRate ?? 1.0;
  }

  public setPlaybackRate(rate: number): void {
    if (this.element && rate > 0) {
      this.element.playbackRate = rate;
    }
  }

  public isPaused(): boolean {
    return this.element ? this.element.paused : true;
  }

  public isReady(): boolean {
    if (!this.element) return false;
    return this.element.readyState >= 2 && !this.element.seeking;
  }
}
