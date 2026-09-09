import assert from "node:assert/strict";
import {
  getYoutubeVideoID,
  normalizeYouTubeUrl,
  isYouTube,
} from "./utils";

console.log("Starting YouTube utility tests...");

// Test 1: Standard YouTube URLs
assert.equal(
  getYoutubeVideoID("https://www.youtube.com/watch?v=kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://www.youtube.com/watch?v=kJQP7kiw5Fk"),
  true
);
assert.equal(
  normalizeYouTubeUrl("https://www.youtube.com/watch?v=kJQP7kiw5Fk"),
  "https://www.youtube.com/watch?v=kJQP7kiw5Fk"
);

// Test 2: URLs without 'www.'
assert.equal(
  getYoutubeVideoID("https://youtube.com/watch?v=kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://youtube.com/watch?v=kJQP7kiw5Fk"),
  true
);
assert.equal(
  normalizeYouTubeUrl("https://youtube.com/watch?v=kJQP7kiw5Fk"),
  "https://www.youtube.com/watch?v=kJQP7kiw5Fk"
);

// Test 3: HTTP URLs
assert.equal(
  getYoutubeVideoID("http://www.youtube.com/watch?v=kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("http://www.youtube.com/watch?v=kJQP7kiw5Fk"),
  true
);

// Test 4: Mobile URLs
assert.equal(
  getYoutubeVideoID("https://m.youtube.com/watch?v=kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://m.youtube.com/watch?v=kJQP7kiw5Fk"),
  true
);

// Test 5: Shortened youtu.be URLs
assert.equal(
  getYoutubeVideoID("https://youtu.be/kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://youtu.be/kJQP7kiw5Fk"),
  true
);
assert.equal(
  normalizeYouTubeUrl("https://youtu.be/kJQP7kiw5Fk"),
  "https://www.youtube.com/watch?v=kJQP7kiw5Fk"
);

// Test 6: Embed URLs
assert.equal(
  getYoutubeVideoID("https://www.youtube.com/embed/kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://www.youtube.com/embed/kJQP7kiw5Fk"),
  true
);

// Test 7: YouTube Shorts
assert.equal(
  getYoutubeVideoID("https://www.youtube.com/shorts/kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://www.youtube.com/shorts/kJQP7kiw5Fk"),
  true
);

// Test 8: Live URLs
assert.equal(
  getYoutubeVideoID("https://www.youtube.com/live/kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("https://www.youtube.com/live/kJQP7kiw5Fk"),
  true
);

// Test 9: Protocol-less URLs
assert.equal(
  getYoutubeVideoID("youtube.com/watch?v=kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("youtube.com/watch?v=kJQP7kiw5Fk"),
  true
);
assert.equal(
  getYoutubeVideoID("youtu.be/kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("youtu.be/kJQP7kiw5Fk"),
  true
);

// Test 10: URLs with extra query params (e.g. timestamp, playlist, tracking)
assert.equal(
  getYoutubeVideoID("https://www.youtube.com/watch?v=kJQP7kiw5Fk&t=120s&feature=shared"),
  "kJQP7kiw5Fk"
);
assert.equal(
  getYoutubeVideoID("https://youtu.be/kJQP7kiw5Fk?t=45"),
  "kJQP7kiw5Fk"
);

// Test 11: Direct 11-char video ID
assert.equal(
  getYoutubeVideoID("kJQP7kiw5Fk"),
  "kJQP7kiw5Fk"
);
assert.equal(
  isYouTube("kJQP7kiw5Fk"),
  true
);

// Test 12: Non-YouTube inputs should return undefined/false
assert.equal(getYoutubeVideoID("https://example.com/video.mp4"), undefined);
assert.equal(isYouTube("https://example.com/video.mp4"), false);
assert.equal(isYouTube(""), false);
assert.equal(isYouTube("magnet:?xt=urn:btih:123"), false);

console.log("All YouTube utility tests passed successfully!");
