import assert from "node:assert/strict";
import type { AppBuildInfo } from "./appVersion";
import {
  evaluateUpdateState,
  shouldPromptUser,
  isChunkLoadError,
  triggerChunkReload,
  hasChunkReloadAttempted,
  clearChunkReload,
  CHUNK_RELOAD_STORAGE_KEY,
} from "./updatePolicy";

const CURRENT: AppBuildInfo = {
  buildId: "20260918-1200-abcdef1",
  commit: "abcdef1234567890",
  appVersion: "1.1.0",
  protocolVersion: 1,
  deploymentTime: "2026-09-18T12:00:00.000Z",
};

console.log("Running updatePolicy test suite...");

// Test 1: Identical build returns "current"
{
  const latest: AppBuildInfo = { ...CURRENT };
  const stateInWatch = evaluateUpdateState(CURRENT, latest, true);
  const stateOutsideWatch = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(stateInWatch, "current", "Identical build in watch room must be 'current'");
  assert.equal(stateOutsideWatch, "current", "Identical build outside watch room must be 'current'");
  assert.equal(shouldPromptUser(stateOutsideWatch, null, latest.buildId), false, "Current state must never prompt user");
}

// Test 2: New build while in active watch room returns "available" (deferred)
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1300-fedcba9",
    commit: "fedcba9876543210",
  };
  const state = evaluateUpdateState(CURRENT, latest, true);
  assert.equal(state, "available", "New build in watch room must be 'available' (deferred)");
  assert.equal(shouldPromptUser(state, null, latest.buildId), false, "Deferred update in watch room must not prompt user");
}

// Test 3: New build while outside watch room returns "recommended"
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1300-fedcba9",
    commit: "fedcba9876543210",
  };
  const state = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(state, "recommended", "New build outside watch room must be 'recommended'");
  assert.equal(shouldPromptUser(state, null, latest.buildId), true, "Recommended update without prior dismissal must prompt user");
}

// Test 4: Recommended update dismissed with "Later" is not re-prompted for same buildId
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1300-fedcba9",
  };
  const state = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(shouldPromptUser(state, "20260918-1300-fedcba9", latest.buildId), false, "Dismissed buildId must not prompt user");
  assert.equal(shouldPromptUser(state, "older-build-id", latest.buildId), true, "Newer buildId must prompt user even if older build was dismissed");
}

// Test 5: Protocol version increase is strictly "required" even inside watch room
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1400-protocol2",
    protocolVersion: 2,
  };
  const stateInWatch = evaluateUpdateState(CURRENT, latest, true);
  const stateOutsideWatch = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(stateInWatch, "required", "Protocol mismatch inside watch room must be 'required'");
  assert.equal(stateOutsideWatch, "required", "Protocol mismatch outside watch room must be 'required'");
  assert.equal(shouldPromptUser("required", "20260918-1400-protocol2", latest.buildId), true, "Required update must prompt user even if dismissed");
}

// =========================================================================
// Chunk Error Classification & Reload Recovery Test Matrix
// =========================================================================

console.log("Running chunk error classification tests...");

// Test 6: Chrome / Chromium dynamic import failure
{
  const chromeError = new TypeError(
    "Failed to fetch dynamically imported module: https://cowatch-puce.vercel.app/assets/Join-Dy9aB.js"
  );
  assert.equal(isChunkLoadError(chromeError), true, "Chrome dynamic import error must be detected");
}

// Test 7: Firefox dynamic import failure
{
  const firefoxError = new TypeError("error loading dynamically imported module");
  assert.equal(isChunkLoadError(firefoxError), true, "Firefox dynamic import error must be detected");
}

// Test 8: Safari / WebKit dynamic import failure
{
  const safariError1 = new TypeError("Importing a module script failed");
  const safariError2 = new TypeError("error importing module");
  const safariError3 = new TypeError("failed to load module script");
  assert.equal(isChunkLoadError(safariError1), true, "Safari error 1 must be detected");
  assert.equal(isChunkLoadError(safariError2), true, "Safari error 2 must be detected");
  assert.equal(isChunkLoadError(safariError3), true, "Safari error 3 must be detected");
}

// Test 9: Vite preload & Webpack chunk errors
{
  const vitePreloadObj = { name: "VitePreloadError", message: "Vite preload failed" };
  const viteCssError = new Error("Unable to preload CSS: /assets/Home-123.css");
  const webpackError = { name: "ChunkLoadError", message: "Loading chunk 42 failed" };
  const viteEventPayload = {
    payload: new TypeError("Failed to fetch dynamically imported module: /assets/Create-abc.js"),
  };

  assert.equal(isChunkLoadError(vitePreloadObj), true, "VitePreloadError object must be detected");
  assert.equal(isChunkLoadError(viteCssError), true, "Vite CSS preload error must be detected");
  assert.equal(isChunkLoadError(webpackError), true, "Webpack ChunkLoadError must be detected");
  assert.equal(isChunkLoadError(viteEventPayload), true, "Vite event payload must be detected");
}

// Test 10: Negative cases — ordinary network/application errors must NOT be detected
{
  const ordinaryFetchError = new TypeError("Failed to fetch");
  const apiEndpointError = new Error("Failed to fetch /api/rooms: 500 Internal Server Error");
  const ordinaryReactError = new TypeError("Cannot read properties of undefined (reading 'map')");
  const genericErrorWithModuleWord = new Error("Auth module initialized with empty session token");
  const genericErrorWithChunkWord = new Error("Chunk size calculation exceeded maximum stream buffer");

  assert.equal(isChunkLoadError(ordinaryFetchError), false, "Generic fetch error must NOT be detected");
  assert.equal(isChunkLoadError(apiEndpointError), false, "API 500 error must NOT be detected");
  assert.equal(isChunkLoadError(ordinaryReactError), false, "Ordinary React render error must NOT be detected");
  assert.equal(isChunkLoadError(genericErrorWithModuleWord), false, "Generic module word must NOT be detected");
  assert.equal(isChunkLoadError(genericErrorWithChunkWord), false, "Generic chunk word must NOT be detected");
  assert.equal(isChunkLoadError(null), false, "Null must NOT be detected");
  assert.equal(isChunkLoadError(undefined), false, "Undefined must NOT be detected");
}

// =========================================================================
// Reload Lifecycle, Loop Prevention & Storage Resilience
// =========================================================================

console.log("Running reload lifecycle and loop prevention tests...");

class MockStorage {
  private map = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  public removeItem(key: string): void {
    this.map.delete(key);
  }
  public clear(): void {
    this.map.clear();
  }
}

// Setup mock browser window for storage testing
const mockSessionStorage = new MockStorage();
(globalThis as any).window = {
  location: {
    pathname: "/join/test-room",
    reload: () => {},
  },
  sessionStorage: mockSessionStorage,
};

// Test 11: First reload attempt succeeds and records marker
{
  clearChunkReload();
  let reloadCount = 0;
  const mockReloader = () => {
    reloadCount++;
  };

  const result = triggerChunkReload("/join/test-room", mockReloader);
  assert.equal(result, true, "First reload attempt must return true");
  assert.equal(reloadCount, 1, "Reloader function must be called once");
  assert.equal(hasChunkReloadAttempted("/join/test-room"), true, "Recovery marker must be present");
}

// Test 12: Second attempt in same session/recovery incident is blocked (Loop Prevention)
{
  let reloadCount = 0;
  const mockReloader = () => {
    reloadCount++;
  };

  const result = triggerChunkReload("/join/test-room", mockReloader);
  assert.equal(result, false, "Second reload attempt on same route must return false");
  assert.equal(reloadCount, 0, "Reloader must NOT be called on second attempt");
}

// Test 13: Marker survives simulated browser reload
{
  // Check that raw storage retains the JSON marker
  const rawMarker = mockSessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
  assert.ok(rawMarker, "Storage must contain the reload marker");
  const parsed = JSON.parse(rawMarker!);
  assert.equal(parsed.path, "/join/test-room", "Stored marker path must match");
  assert.equal(typeof parsed.attemptedAt, "number", "Stored marker must have timestamp");
}

// Test 14: Clear marker resets recovery state
{
  clearChunkReload();
  assert.equal(hasChunkReloadAttempted("/join/test-room"), false, "Marker must be cleared");
  assert.equal(mockSessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY), null, "Storage item must be removed");

  // After clearing, a new recovery incident can be triggered
  let reloadCount = 0;
  const result = triggerChunkReload("/join/test-room", () => reloadCount++);
  assert.equal(result, true, "Reload can occur after marker is cleared");
  assert.equal(reloadCount, 1, "Reloader must be called");
  clearChunkReload();
}

// Test 15: Different route allows independent recovery attempt
{
  clearChunkReload();
  triggerChunkReload("/create", () => {});
  assert.equal(hasChunkReloadAttempted("/create"), true, "/create must have marker");
  assert.equal(hasChunkReloadAttempted("/profile"), false, "/profile must NOT have marker");

  let profileReloadCount = 0;
  const profileResult = triggerChunkReload("/profile", () => profileReloadCount++);
  assert.equal(profileResult, true, "Different route must allow reload");
  assert.equal(profileReloadCount, 1, "Profile reloader must be called");
  clearChunkReload();
}

// Test 16: Storage unavailable or throwing does not crash
{
  clearChunkReload();
  const throwingStorage = {
    getItem() {
      throw new Error("QuotaExceededError or SecurityError in private browsing");
    },
    setItem() {
      throw new Error("QuotaExceededError or SecurityError in private browsing");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  (globalThis as any).window.sessionStorage = throwingStorage;

  let reloadCalled = false;
  const result = triggerChunkReload("/join", () => {
    reloadCalled = true;
  });
  assert.equal(result, true, "Must still initiate reload even if storage throws");
  assert.equal(reloadCalled, true, "Reloader was executed");

  // Local fallback prevents infinite loop even when storage throws
  const secondResult = triggerChunkReload("/join", () => {});
  assert.equal(secondResult, false, "Local memory fallback prevents duplicate reload when storage throws");

  // Restore normal mock storage
  (globalThis as any).window.sessionStorage = mockSessionStorage;
  clearChunkReload();
}

// Test 17: Reloader function throws controlled fallback
{
  clearChunkReload();
  const throwingReloader = () => {
    throw new Error("Navigation blocked");
  };
  const result = triggerChunkReload("/join", throwingReloader);
  assert.equal(result, false, "Must return false if reloader itself throws");
  clearChunkReload();
}

// Test 18: Core two-stage deployment scenario
{
  clearChunkReload();

  // Stage 1: User navigates to /join, old chunk is missing on server, import rejects
  const deploymentError = new TypeError(
    "Failed to fetch dynamically imported module: https://cowatch-puce.vercel.app/assets/Join-oldhash.js"
  );
  assert.equal(isChunkLoadError(deploymentError), true, "Stage 1: Chunk error recognized");

  let browserReloadCount = 0;
  const browserReloader = () => {
    browserReloadCount++;
  };

  // First occurrence: automatic reload initiated
  const stage1ReloadInitiated = triggerChunkReload("/join", browserReloader);
  assert.equal(stage1ReloadInitiated, true, "Stage 1: Automatic reload initiated");
  assert.equal(browserReloadCount, 1, "Stage 1: Browser reload triggered once");

  // Stage 2: Browser has reloaded at /join, but server is still serving old HTML or offline
  // The import rejects again with chunk error:
  assert.equal(isChunkLoadError(deploymentError), true, "Stage 2: Chunk error recognized again");

  // Second occurrence: automatic reload is BLOCKED to prevent crash loop
  const stage2ReloadInitiated = triggerChunkReload("/join", browserReloader);
  assert.equal(stage2ReloadInitiated, false, "Stage 2: Automatic reload BLOCKED (guard active)");
  assert.equal(browserReloadCount, 1, "Stage 2: Browser reload count remains 1 (no infinite loop)");
  assert.equal(hasChunkReloadAttempted("/join"), true, "Stage 2: RootErrorBoundary can detect alreadyAttempted=true to render State B recovery UI");

  clearChunkReload();
}

console.log("All updatePolicy tests passed successfully!");

