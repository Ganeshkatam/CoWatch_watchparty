import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { AppBuildInfo, UpdateState } from "./appVersion";

export const CHUNK_RELOAD_STORAGE_KEY = "cowatch_chunk_reload_attempted";

export interface ChunkReloadMarker {
  path: string;
  attemptedAt: number;
}

// In-memory fallback set for environments where sessionStorage is unavailable or throws
const inMemoryReloadMarkers = new Set<string>();

/**
 * Evaluates the update state between the currently running client
 * and the latest manifest served by the deployment server (/version.json).
 *
 * Invariants:
 * 1. Protocol compatibility is paramount: if latest.protocolVersion > current.protocolVersion,
 *    the update is strictly "required".
 * 2. Active watch rooms must never be disrupted: if an update exists while the user is inside
 *    an active watch room, the state is "available" (deferred) rather than "recommended".
 * 3. Outside watch rooms, new builds are classified as "recommended".
 * 4. Identical build IDs return "current".
 */
export function evaluateUpdateState(
  current: AppBuildInfo,
  latest: AppBuildInfo,
  isWatchRoomActive: boolean
): UpdateState {
  if (latest.protocolVersion > current.protocolVersion) {
    return "required";
  }

  if (latest.buildId !== current.buildId) {
    if (isWatchRoomActive) {
      return "available";
    }
    return "recommended";
  }

  return "current";
}

/**
 * Determines whether a user-facing update prompt should be presented.
 *
 * @param state - The evaluated UpdateState.
 * @param dismissedBuildId - The buildId the user explicitly chose to defer ("Later") during this session.
 * @param latestBuildId - The buildId of the newly available deployment.
 */
export function shouldPromptUser(
  state: UpdateState,
  dismissedBuildId?: string | null,
  latestBuildId?: string
): boolean {
  if (state === "current") {
    return false;
  }

  // Required updates represent breaking protocol changes and cannot be dismissed
  if (state === "required") {
    return true;
  }

  // Available updates inside active watch rooms are deferred to prevent playback disruption
  if (state === "available") {
    return false;
  }

  // Recommended updates are shown unless the user previously dismissed this exact buildId
  if (state === "recommended") {
    if (!latestBuildId) {
      return false;
    }
    return dismissedBuildId !== latestBuildId;
  }

  return false;
}

/**
 * Conservatively determines whether an error represents a failed dynamic import,
 * missing chunk, or module script preload failure caused by a deployment asset replacement.
 *
 * Specifically avoids matching generic network errors (e.g. "Failed to fetch /api/data")
 * or ordinary application render errors.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === "object") {
    const errObj = error as { name?: string; message?: string; payload?: unknown };

    if (errObj.name === "ChunkLoadError" || errObj.name === "VitePreloadError") {
      return true;
    }

    // Vite preload error custom event payload
    if (errObj.payload && isChunkLoadError(errObj.payload)) {
      return true;
    }

    const message = typeof errObj.message === "string" ? errObj.message : "";
    if (message) {
      // Chrome / Chromium: "Failed to fetch dynamically imported module: https://..."
      if (/Failed to fetch dynamically imported module/i.test(message)) {
        return true;
      }
      // Firefox: "error loading dynamically imported module"
      if (/error loading dynamically imported module/i.test(message)) {
        return true;
      }
      // Safari / WebKit: "Importing a module script failed" or "error importing module" or "failed to load module script"
      if (
        /Importing a module script failed/i.test(message) ||
        /error importing module/i.test(message) ||
        /failed to load module script/i.test(message)
      ) {
        return true;
      }
      // Webpack / Rollup / Vite chunk preload errors
      if (
        /Loading chunk [\w-]+ failed/i.test(message) ||
        /Unable to preload CSS/i.test(message)
      ) {
        return true;
      }
    }
  }

  return false;
}

function getSafeStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function getNormalizedPath(pathname?: string): string {
  if (pathname) {
    return pathname;
  }
  if (typeof window !== "undefined" && window.location?.pathname) {
    return window.location.pathname;
  }
  return "/";
}

/**
 * Returns the recorded chunk reload marker if present in sessionStorage.
 */
export function getChunkReloadMarker(): ChunkReloadMarker | null {
  const storage = getSafeStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.path === "string" && typeof parsed.attemptedAt === "number") {
      return parsed;
    }
  } catch {
    // Ignore parse or storage restrictions
  }
  return null;
}

/**
 * Checks whether an automatic chunk reload has already been attempted for the given route.
 */
export function hasChunkReloadAttempted(pathname?: string): boolean {
  const targetPath = getNormalizedPath(pathname);
  if (inMemoryReloadMarkers.has(targetPath)) {
    return true;
  }
  const marker = getChunkReloadMarker();
  if (!marker) {
    return false;
  }
  return marker.path === targetPath;
}

/**
 * Clears the recovery marker once the route renders operational content without error.
 */
export function clearChunkReload(): void {
  inMemoryReloadMarkers.clear();
  const storage = getSafeStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

/**
 * Initiates an automatic page reload to fetch the newly deployed application assets.
 * Guarantees strict loop prevention: only ONE automatic reload per recovery incident.
 *
 * @param pathname - Optional route path (defaults to window.location.pathname).
 * @param reloader - Optional injection for testing/execution (defaults to window.location.reload).
 * @returns true if reload was initiated, false if already attempted or failed.
 */
export function triggerChunkReload(
  pathname?: string,
  reloader: () => void = () => {
    if (typeof window !== "undefined" && window.location?.reload) {
      window.location.reload();
    }
  }
): boolean {
  const targetPath = getNormalizedPath(pathname);

  // Invariant: Exactly one automatic recovery reload per recovery incident
  if (hasChunkReloadAttempted(targetPath)) {
    return false;
  }

  // Record marker before triggering reload
  inMemoryReloadMarkers.add(targetPath);
  const storage = getSafeStorage();
  if (storage) {
    try {
      const marker: ChunkReloadMarker = {
        path: targetPath,
        attemptedAt: Date.now(),
      };
      storage.setItem(CHUNK_RELOAD_STORAGE_KEY, JSON.stringify(marker));
    } catch {
      // Storage restricted, inMemoryReloadMarkers provides local fallback
    }
  }

  try {
    reloader();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps React.lazy with resilient chunk reload recovery.
 *
 * If the dynamic import fails due to outdated build hashes:
 * - If reload was initiated, returns a pending Promise so React Suspense displays
 *   the fallback loader while the browser completes the reload with fresh assets.
 * - If reload was NOT initiated (already attempted), rejects immediately so
 *   RootErrorBoundary can present the controlled recovery UI.
 */
export function lazyWithChunkRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T } | { [key: string]: any }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const module = await importer();
      return module as { default: T };
    } catch (error) {
      if (isChunkLoadError(error)) {
        const reloaded = triggerChunkReload();
        if (reloaded) {
          // Keep promise pending while the browser unloads and refreshes
          return new Promise<{ default: T }>(() => {});
        }
      }
      // Re-throw if already attempted or not a chunk error
      throw error;
    }
  });
}
