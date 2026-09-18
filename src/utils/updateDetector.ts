import { CURRENT_BUILD_INFO, type AppBuildInfo, type UpdateCheckResult, type UpdateState } from "./appVersion";
import { evaluateUpdateState } from "./updatePolicy";

export type UpdateListener = (result: UpdateCheckResult) => void;

export const THROTTLE_INTERVAL_MS = 60_000; // 1 minute throttle
export const PERIODIC_INTERVAL_MS = 300_000; // 5 minute polling interval
export const STARTUP_DELAY_MS = 3_000; // 3 second delay on initial mount

export class UpdateDetector {
  private lastCheckTime = 0;
  private currentResult: UpdateCheckResult = {
    state: "current",
    current: CURRENT_BUILD_INFO,
    checkedAt: Date.now(),
  };
  private listeners: Set<UpdateListener> = new Set();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isStarted = false;
  private dismissedBuildId: string | null = null;

  public constructor() {
    if (typeof sessionStorage !== "undefined") {
      try {
        this.dismissedBuildId = sessionStorage.getItem("cowatch_dismissed_build_id");
      } catch {
        // ignore storage restrictions
      }
    }
  }

  /**
   * Subscribes a listener to update results.
   * Invokes the listener immediately with the current cached result.
   */
  public subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentResult);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getStatus(): UpdateCheckResult {
    return this.currentResult;
  }

  public getDismissedBuildId(): string | null {
    return this.dismissedBuildId;
  }

  public dismissUpdate(buildId: string): void {
    this.dismissedBuildId = buildId;
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem("cowatch_dismissed_build_id", buildId);
      } catch {
        // ignore storage restrictions
      }
    }
    this.notifyListeners();
  }

  /**
   * Checks the server for the latest build manifest (/version.json).
   * Throttled to a minimum interval of 60 seconds unless `force` is true.
   */
  public async checkForUpdate(
    isWatchRoomActive: boolean,
    force = false
  ): Promise<UpdateCheckResult> {
    const now = Date.now();

    // Guard against excessive network queries
    if (!force && now - this.lastCheckTime < THROTTLE_INTERVAL_MS) {
      if (this.currentResult.latest) {
        const reevaluatedState = evaluateUpdateState(
          CURRENT_BUILD_INFO,
          this.currentResult.latest,
          isWatchRoomActive
        );
        if (reevaluatedState !== this.currentResult.state) {
          this.currentResult = {
            ...this.currentResult,
            state: reevaluatedState,
          };
          this.notifyListeners();
        }
      }
      return this.currentResult;
    }

    this.lastCheckTime = now;

    try {
      const response = await fetch(`/version.json?t=${now}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });

      if (!response.ok) {
        return this.currentResult;
      }

      const latest: AppBuildInfo = await response.json();
      if (!latest || typeof latest.buildId !== "string") {
        return this.currentResult;
      }

      const state: UpdateState = evaluateUpdateState(
        CURRENT_BUILD_INFO,
        latest,
        isWatchRoomActive
      );

      this.currentResult = {
        state,
        current: CURRENT_BUILD_INFO,
        latest,
        checkedAt: now,
      };

      this.notifyListeners();
      return this.currentResult;
    } catch {
      // Network disconnect or offline: preserve existing result silently
      return this.currentResult;
    }
  }

  /**
   * Initializes background triggers:
   * 1. Delayed startup check
   * 2. 5-minute periodic interval
   * 3. Tab visibility change (on visible)
   * 4. Online reconnection event
   */
  public start(getIsWatchRoomActive: () => boolean): () => void {
    if (this.isStarted || typeof window === "undefined") {
      return () => {};
    }
    this.isStarted = true;

    // 1. Initial delayed check
    this.startupTimeoutId = setTimeout(() => {
      this.checkForUpdate(getIsWatchRoomActive());
    }, STARTUP_DELAY_MS);

    // 2. Periodic check
    this.timerId = setInterval(() => {
      this.checkForUpdate(getIsWatchRoomActive());
    }, PERIODIC_INTERVAL_MS);

    // 3. Tab visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        this.checkForUpdate(getIsWatchRoomActive());
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 4. Online reconnection
    const handleOnline = () => {
      this.checkForUpdate(getIsWatchRoomActive());
    };
    window.addEventListener("online", handleOnline);

    return () => {
      if (this.startupTimeoutId) {
        clearTimeout(this.startupTimeoutId);
        this.startupTimeoutId = null;
      }
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      this.isStarted = false;
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentResult);
      } catch (e) {
        console.error("Error in update listener", e);
      }
    }
  }
}

export const updateDetector = new UpdateDetector();
