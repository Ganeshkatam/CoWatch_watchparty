import assert from "node:assert/strict";
import {
  formatDocumentTitle,
  setDocumentMetadata,
} from "./useDocumentMetadata";
import {
  isMediaSessionSupported,
  resolveArtwork,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPosition,
  setupMediaSessionActionHandlers,
  clearMediaSession,
  type MediaSessionActions,
} from "./mediaSession";

// Setup a mock DOM environment
class MockElement {
  tagName: string;
  attributes: Record<string, string> = {};

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  remove() {
    const idx = (global as any).document.head.children.indexOf(this);
    if (idx !== -1) {
      (global as any).document.head.children.splice(idx, 1);
    }
  }
}

class MockHead {
  children: MockElement[] = [];

  appendChild(el: MockElement) {
    this.children.push(el);
  }
}

class MockDocument {
  head = new MockHead();
  title = "CoWatch Initial";

  createElement(tagName: string) {
    return new MockElement(tagName);
  }

  querySelector(selector: string): MockElement | null {
    // Basic attribute selector parser: (meta|link)[attr="val"]
    const match = selector.match(/(?:meta|link)\[([a-zA-Z0-9_-]+)="([^"]+)"\]/);
    if (!match) return null;
    const [, attr, val] = match;
    for (const child of this.head.children) {
      if (child.getAttribute(attr) === val) {
        return child;
      }
    }
    return null;
  }
}

// ----------------------------------------------------
// Test 1: formatDocumentTitle
// ----------------------------------------------------
console.log("Running Test 1: formatDocumentTitle");
assert.equal(formatDocumentTitle(""), "CoWatch - Watch Together with Friends");
assert.equal(formatDocumentTitle("   "), "CoWatch - Watch Together with Friends");
assert.equal(formatDocumentTitle("Home"), "Home | CoWatch");
assert.equal(formatDocumentTitle("Movie • Room | CoWatch"), "Movie • Room | CoWatch");
assert.equal(
  formatDocumentTitle("CoWatch - Watch Party & Synchronized Streaming"),
  "CoWatch - Watch Party & Synchronized Streaming"
);

// ----------------------------------------------------
// Test 2: setDocumentMetadata creation, update, and restoration
// ----------------------------------------------------
console.log("Running Test 2: setDocumentMetadata lifecycle and restoration");
(global as any).document = new MockDocument();

// Initial metadata
const cleanup1 = setDocumentMetadata({
  title: "First Page",
  description: "First description",
  noIndex: false,
});

assert.equal((global as any).document.title, "First Page | CoWatch");
const descMeta = (global as any).document.querySelector('meta[name="description"]');
assert.ok(descMeta);
assert.equal(descMeta.getAttribute("content"), "First description");

// Second metadata overrides
const cleanup2 = setDocumentMetadata({
  title: "Second Page",
  description: "Second description",
  noIndex: true,
});

assert.equal((global as any).document.title, "Second Page | CoWatch");
assert.equal(descMeta.getAttribute("content"), "Second description");
const robotsMeta = (global as any).document.querySelector('meta[name="robots"]');
assert.ok(robotsMeta);
assert.equal(robotsMeta.getAttribute("content"), "noindex, nofollow");

// Cleanup second metadata -> should restore First Page metadata
cleanup2();
assert.equal((global as any).document.title, "First Page | CoWatch");
assert.equal(descMeta.getAttribute("content"), "First description");
const robotsMetaAfter = (global as any).document.querySelector('meta[name="robots"]');
assert.equal(robotsMetaAfter, null); // restored to non-existent

// Cleanup first metadata -> should restore initial document state
cleanup1();
assert.equal((global as any).document.title, "CoWatch Initial");

// Test canonical URL management
const cleanupCanonical = setDocumentMetadata({
  canonicalUrl: "https://cowatch.tv/create",
});
const canonicalLink = (global as any).document.querySelector('link[rel="canonical"]');
assert.ok(canonicalLink);
assert.equal(canonicalLink.getAttribute("href"), "https://cowatch.tv/create");
cleanupCanonical();
const afterLink = (global as any).document.querySelector('link[rel="canonical"]');
assert.equal(afterLink, null);

// ----------------------------------------------------
// Test 3: MediaSession unsupported environment
// ----------------------------------------------------
console.log("Running Test 3: MediaSession unsupported environment");
Object.defineProperty(globalThis, "window", {
  value: {},
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: {},
  configurable: true,
  writable: true,
});

assert.equal(isMediaSessionSupported(), false);
// All functions must safely no-op without throwing
updateMediaSessionMetadata({ title: "Test" });
updateMediaSessionPlaybackState(true);
updateMediaSessionPosition({ duration: 100, currentTime: 10 });
setupMediaSessionActionHandlers({ play: () => {} });
clearMediaSession();

// ----------------------------------------------------
// Test 4: MediaSession deterministic artwork resolution
// ----------------------------------------------------
console.log("Running Test 4: resolveArtwork deterministic hierarchy");
(global as any).window = { location: { origin: "https://cowatch.me" } };

// Hierarchy: Thumbnail -> Cover -> Default
const artworkWithThumb = resolveArtwork("https://example.com/thumb.jpg", "https://example.com/cover.jpg");
assert.equal(artworkWithThumb.length, 1);
assert.equal(artworkWithThumb[0].src, "https://example.com/thumb.jpg");

const artworkWithCoverOnly = resolveArtwork(null, "https://example.com/cover.jpg");
assert.equal(artworkWithCoverOnly.length, 1);
assert.equal(artworkWithCoverOnly[0].src, "https://example.com/cover.jpg");

const artworkDefault = resolveArtwork(null, null);
assert.equal(artworkDefault.length, 1);
assert.equal(artworkDefault[0].src, "https://cowatch.me/screenshot_full.png");

// ----------------------------------------------------
// Test 5: MediaSession position validation
// ----------------------------------------------------
console.log("Running Test 5: MediaSession setPositionState validation");

let lastSetPosition: any = null;
const mockMediaSession: any = {
  metadata: null,
  playbackState: "none",
  actionHandlers: {} as Record<string, any>,
  setActionHandler(action: string, handler: any) {
    if (action === "throw_action") {
      throw new Error("Unsupported action");
    }
    this.actionHandlers[action] = handler;
  },
  setPositionState(state: any) {
    lastSetPosition = state;
  },
};

(global as any).navigator.mediaSession = mockMediaSession;
(global as any).window.MediaMetadata = class MockMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: any[];
  constructor(data: any) {
    this.title = data.title;
    this.artist = data.artist;
    this.album = data.album;
    this.artwork = data.artwork;
  }
};

assert.equal(isMediaSessionSupported(), true);

// Invalid duration (zero, negative, NaN, Infinity) should NOT update position
lastSetPosition = null;
updateMediaSessionPosition({ duration: 0, currentTime: 10 }, true);
assert.equal(lastSetPosition, null);

updateMediaSessionPosition({ duration: -100, currentTime: 10 }, true);
assert.equal(lastSetPosition, null);

updateMediaSessionPosition({ duration: Infinity, currentTime: 10 }, true);
assert.equal(lastSetPosition, null);

updateMediaSessionPosition({ duration: NaN, currentTime: 10 }, true);
assert.equal(lastSetPosition, null);

// Invalid currentTime (negative, NaN) should NOT update position
lastSetPosition = null;
updateMediaSessionPosition({ duration: 100, currentTime: -5 }, true);
assert.equal(lastSetPosition, null);

// Valid inputs with position exceeding duration should clamp to duration
lastSetPosition = null;
updateMediaSessionPosition({ duration: 100, currentTime: 150, playbackRate: 1.5 }, true);
assert.deepEqual(lastSetPosition, {
  duration: 100,
  position: 100,
  playbackRate: 1.5,
});

// Non-positive playback rate should default to 1.0
lastSetPosition = null;
updateMediaSessionPosition({ duration: 100, currentTime: 50, playbackRate: 0 }, true);
assert.deepEqual(lastSetPosition, {
  duration: 100,
  position: 50,
  playbackRate: 1.0,
});

// ----------------------------------------------------
// Test 6: Action handlers & playlist conditional registration
// ----------------------------------------------------
console.log("Running Test 6: MediaSession action handlers & playlist conditional registration");

const actions: MediaSessionActions = {
  play: () => {},
  pause: () => {},
  seek: (_s) => {},
  seekBackward: (_o) => {},
  seekForward: (_o) => {},
  next: () => {},
  previous: () => {},
};

// When hasNext is false, nexttrack must be set to null
setupMediaSessionActionHandlers(actions, { hasNext: false, hasPrevious: false });
assert.ok(mockMediaSession.actionHandlers["play"]);
assert.ok(mockMediaSession.actionHandlers["pause"]);
assert.ok(mockMediaSession.actionHandlers["seekto"]);
assert.ok(mockMediaSession.actionHandlers["seekbackward"]);
assert.ok(mockMediaSession.actionHandlers["seekforward"]);
assert.equal(mockMediaSession.actionHandlers["nexttrack"], null);
assert.equal(mockMediaSession.actionHandlers["previoustrack"], null);

// When hasNext is true, nexttrack must be registered
setupMediaSessionActionHandlers(actions, { hasNext: true, hasPrevious: false });
assert.ok(mockMediaSession.actionHandlers["nexttrack"]);
assert.equal(mockMediaSession.actionHandlers["previoustrack"], null);

// Action registration failures: must not throw or crash
let registrationFailureIntercepted = false;
const originalSet = mockMediaSession.setActionHandler;
mockMediaSession.setActionHandler = (action: string, handler: any) => {
  if (action === "seekto") {
    registrationFailureIntercepted = true;
    throw new Error("Simulated browser error for unsupported action");
  }
  originalSet.call(mockMediaSession, action, handler);
};

assert.doesNotThrow(() => {
  setupMediaSessionActionHandlers(actions, { hasNext: true });
});
assert.ok(registrationFailureIntercepted, "Registration failure was simulated and caught cleanly");
mockMediaSession.setActionHandler = originalSet;

// ----------------------------------------------------
// Test 7: clearMediaSession Idempotency
// ----------------------------------------------------
console.log("Running Test 7: clearMediaSession idempotency");

mockMediaSession.playbackState = "playing";
updateMediaSessionMetadata({ title: "Playing Now" });
assert.ok(mockMediaSession.metadata);

// First clear
clearMediaSession();
assert.equal(mockMediaSession.playbackState, "none");
assert.equal(mockMediaSession.metadata, null);
assert.equal(mockMediaSession.actionHandlers["play"], null);
assert.equal(mockMediaSession.actionHandlers["pause"], null);
assert.equal(mockMediaSession.actionHandlers["nexttrack"], null);
assert.equal(lastSetPosition, undefined);

// Second and third calls must be completely safe (idempotent)
assert.doesNotThrow(() => clearMediaSession());
assert.doesNotThrow(() => clearMediaSession());
assert.equal(mockMediaSession.playbackState, "none");
assert.equal(mockMediaSession.metadata, null);

console.log("\nAll 7 unit test suites passed successfully!");
