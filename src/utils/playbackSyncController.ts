import { PlaybackAdapter } from "./playback/adapters";
import { ClockSynchronizer, clockSynchronizer } from "./playback/clockSync";

export type DriftCorrectionTier = "TIER_0_DEADBAND" | "TIER_1_RATE_ADJUST" | "TIER_2_HARD_SEEK";

export interface DriftEvaluationResult {
  tier: DriftCorrectionTier;
  driftSeconds: number;
  canonicalTime: number;
  localTime: number;
  targetRate: number;
  adjustedRate: number;
  actionTaken: "NONE" | "RATE_ADJUSTED" | "SEEK_EXECUTED" | "SEEK_DEFERRED_COOLDOWN" | "SEEK_DEFERRED_UNREADY";
}

export interface PlaybackSyncState {
  canonicalTime: number;
  paused: boolean;
  playbackRate: number;
  serverTime: number;
  mediaSource?: string;
  epoch?: number;
}

export class PlaybackSyncController {
  private adapter: PlaybackAdapter | null = null;
  private clockSync: ClockSynchronizer;
  private lastSeekTimestamp: number = 0;
  private seekCooldownMs: number = 1000;
  private latestServerState: PlaybackSyncState | null = null;

  constructor(adapter?: PlaybackAdapter | null, clockSync: ClockSynchronizer = clockSynchronizer) {
    this.adapter = adapter || null;
    this.clockSync = clockSync;
  }

  public setAdapter(adapter: PlaybackAdapter | null): void {
    this.adapter = adapter;
  }

  public setSeekCooldownMs(ms: number): void {
    this.seekCooldownMs = ms;
  }

  public onPlaybackSyncReceived(state: PlaybackSyncState): void {
    this.latestServerState = state;
  }

  public calculateCanonicalTime(nowClient: number = Date.now()): number {
    if (!this.latestServerState) return 0;
    const { canonicalTime, paused, playbackRate, serverTime } = this.latestServerState;
    if (paused) {
      return canonicalTime;
    }
    const estimatedServerNow = this.clockSync.getEstimatedServerNow(nowClient);
    const elapsedSeconds = Math.max(0, (estimatedServerNow - serverTime) / 1000);
    return canonicalTime + elapsedSeconds * playbackRate;
  }

  public evaluateAndSync(clientNow: number = Date.now()): DriftEvaluationResult {
    if (!this.adapter || !this.latestServerState) {
      return {
        tier: "TIER_0_DEADBAND",
        driftSeconds: 0,
        canonicalTime: 0,
        localTime: 0,
        targetRate: 1.0,
        adjustedRate: 1.0,
        actionTaken: "NONE",
      };
    }

    const localTime = this.adapter.getCurrentTime();
    const canonicalTime = this.calculateCanonicalTime(clientNow);
    const targetRate = this.latestServerState.playbackRate || 1.0;
    const isPaused = this.latestServerState.paused;

    // In paused state, if local player is paused and near canonical time, maintain deadband
    const driftSeconds = localTime - canonicalTime;
    const absDrift = Math.abs(driftSeconds);

    // Tier 0: Deadband (<= 200ms)
    if (absDrift <= 0.200) {
      if (Math.abs(this.adapter.getPlaybackRate() - targetRate) > 0.001) {
        this.adapter.setPlaybackRate(targetRate);
      }
      return {
        tier: "TIER_0_DEADBAND",
        driftSeconds,
        canonicalTime,
        localTime,
        targetRate,
        adjustedRate: targetRate,
        actionTaken: "NONE",
      };
    }

    // Tier 1: Proportional Rate Adjustment (200ms < |drift| <= 1500ms)
    if (absDrift <= 1.500 && !isPaused) {
      const normalizedMagnitude = (absDrift - 0.200) / 1.300;
      const rawCorrection = normalizedMagnitude * 0.08;
      const clampedCorrection = Math.max(0.01, Math.min(0.08, rawCorrection));

      // If drift > 0 (player ahead of server), slow down; if drift < 0 (player behind server), speed up
      const rateMultiplier = driftSeconds > 0 ? (1 - clampedCorrection) : (1 + clampedCorrection);
      const adjustedRate = Number((targetRate * rateMultiplier).toFixed(4));

      this.adapter.setPlaybackRate(adjustedRate);

      return {
        tier: "TIER_1_RATE_ADJUST",
        driftSeconds,
        canonicalTime,
        localTime,
        targetRate,
        adjustedRate,
        actionTaken: "RATE_ADJUSTED",
      };
    }

    // Tier 2: Hard Seek (|drift| > 1500ms or any large pause-state drift)
    if (!this.adapter.isReady()) {
      return {
        tier: "TIER_2_HARD_SEEK",
        driftSeconds,
        canonicalTime,
        localTime,
        targetRate,
        adjustedRate: targetRate,
        actionTaken: "SEEK_DEFERRED_UNREADY",
      };
    }

    const timeSinceLastSeek = clientNow - this.lastSeekTimestamp;
    if (timeSinceLastSeek < this.seekCooldownMs) {
      return {
        tier: "TIER_2_HARD_SEEK",
        driftSeconds,
        canonicalTime,
        localTime,
        targetRate,
        adjustedRate: targetRate,
        actionTaken: "SEEK_DEFERRED_COOLDOWN",
      };
    }

    // Execute hard seek
    this.adapter.setCurrentTime(canonicalTime);
    this.adapter.setPlaybackRate(targetRate);
    this.lastSeekTimestamp = clientNow;

    return {
      tier: "TIER_2_HARD_SEEK",
      driftSeconds,
      canonicalTime,
      localTime,
      targetRate,
      adjustedRate: targetRate,
      actionTaken: "SEEK_EXECUTED",
    };
  }

  public reset(): void {
    this.lastSeekTimestamp = 0;
    this.latestServerState = null;
  }
}
