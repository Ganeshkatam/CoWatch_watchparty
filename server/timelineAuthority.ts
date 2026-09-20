export interface TimelineSnapshot {
  anchorTime: number;
  anchorWallClock: number;
  paused: boolean;
  playbackRate: number;
  mediaSource: string;
  revision: number;
}

export interface PlaybackSyncPayload {
  canonicalTime: number;
  paused: boolean;
  playbackRate: number;
  serverTime: number;
  mediaSource: string;
  revision: number;
  epoch?: number;
  operationId?: string;
}

export class TimelineAuthority {
  private anchorTime: number;
  private anchorWallClock: number;
  private paused: boolean;
  private playbackRate: number;
  private mediaSource: string;
  private revision: number;

  constructor(initialSnapshot?: Partial<TimelineSnapshot>) {
    this.anchorTime = initialSnapshot?.anchorTime ?? 0;
    this.anchorWallClock = initialSnapshot?.anchorWallClock ?? Date.now();
    this.paused = initialSnapshot?.paused ?? true;
    this.playbackRate = initialSnapshot?.playbackRate ?? 1.0;
    this.mediaSource = initialSnapshot?.mediaSource ?? "";
    this.revision = initialSnapshot?.revision ?? 1;
  }

  public getCanonicalTime(now: number = Date.now()): number {
    if (this.paused) {
      return Math.max(0, this.anchorTime);
    }
    const elapsedSeconds = Math.max(0, (now - this.anchorWallClock) / 1000);
    const calculated = this.anchorTime + elapsedSeconds * this.playbackRate;
    return Math.max(0, Number(calculated.toFixed(4)));
  }

  public play(now: number = Date.now()): void {
    if (!this.paused) return;
    this.anchorWallClock = now;
    this.paused = false;
    this.revision += 1;
  }

  public pause(now: number = Date.now()): void {
    if (this.paused) return;
    this.anchorTime = this.getCanonicalTime(now);
    this.anchorWallClock = now;
    this.paused = true;
    this.revision += 1;
  }

  public seek(targetSeconds: number, now: number = Date.now()): void {
    const clampedTarget = Math.max(0, targetSeconds);
    this.anchorTime = clampedTarget;
    this.anchorWallClock = now;
    this.revision += 1;
  }

  public setPlaybackRate(rate: number, now: number = Date.now()): void {
    if (rate <= 0) return;
    const current = this.getCanonicalTime(now);
    this.anchorTime = current;
    this.anchorWallClock = now;
    this.playbackRate = rate;
    this.revision += 1;
  }

  public setMediaSource(source: string, now: number = Date.now()): void {
    this.mediaSource = source;
    this.anchorTime = 0;
    this.anchorWallClock = now;
    this.paused = false;
    this.playbackRate = 1.0;
    this.revision += 1;
  }

  public getSnapshot(): TimelineSnapshot {
    return {
      anchorTime: this.anchorTime,
      anchorWallClock: this.anchorWallClock,
      paused: this.paused,
      playbackRate: this.playbackRate,
      mediaSource: this.mediaSource,
      revision: this.revision,
    };
  }

  public generateSyncPayload(
    now: number = Date.now(),
    epoch?: number,
    operationId?: string
  ): PlaybackSyncPayload {
    return {
      canonicalTime: this.getCanonicalTime(now),
      paused: this.paused,
      playbackRate: this.playbackRate,
      serverTime: now,
      mediaSource: this.mediaSource,
      revision: this.revision,
      epoch,
      operationId,
    };
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public getMediaSource(): string {
    return this.mediaSource;
  }

  public getRevision(): number {
    return this.revision;
  }
}
