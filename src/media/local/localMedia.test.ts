/**
 * LOCAL-MEDIA-001: Client Local Media Distribution Test Suite
 */

import { LocalMediaCache } from "./LocalMediaCache";
import { LocalMediaChunker } from "./LocalMediaChunker";
import {
  LocalMediaManifest,
  calculateTotalChunks,
  detectMediaContainer,
  validateLocalMediaManifest,
} from "./LocalMediaManifest";
import { LocalMediaScheduler } from "./LocalMediaScheduler";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runLocalMediaClientTests() {
  console.log("----------------------------------------------------------------");
  console.log("LOCAL-MEDIA-001: Client Local Media Verification Suite");
  console.log("----------------------------------------------------------------");

  // Test 1: Container detection
  assert(detectMediaContainer("movie.mp4", "video/mp4") === "mp4", "Test 1: MP4 detection");
  assert(detectMediaContainer("clip.webm", "video/webm") === "webm", "Test 1: WebM detection");
  assert(detectMediaContainer("film.mkv", "video/x-matroska") === "mkv", "Test 1: MKV detection");
  console.log("  PASS [Test 1: Media container and format detection]");

  // Test 2: Chunk calculation
  assert(calculateTotalChunks(1000000, 131072) === 8, "Test 2: Total chunk calculation (ceil)");
  assert(calculateTotalChunks(262144, 131072) === 2, "Test 2: Exact chunk boundary");
  console.log("  PASS [Test 2: Chunk boundary and total calculations]");

  // Test 3: LocalMediaChunker with mock Blob
  const mockData = new Uint8Array(500000); // ~500KB
  for (let i = 0; i < mockData.length; i++) {
    mockData[i] = i % 256;
  }
  const mockBlob = new Blob([mockData], { type: "video/mp4" });

  const chunker = new LocalMediaChunker(mockBlob, {
    filename: "test_video.mp4",
    chunkSize: 100000,
    durationSeconds: 60,
  });

  assert(chunker.getTotalChunks() === 5, "Test 3: Chunker total chunks");
  const manifest = chunker.getManifest("room_xyz", "user_host");
  assert(validateLocalMediaManifest(manifest), "Test 3: Manifest validation");
  assert(manifest.container === "mp4", "Test 3: Manifest container MP4");
  console.log("  PASS [Test 3: LocalMediaChunker slicing and manifest generation]");

  // Test 4: Chunk retrieval & Checksum
  const chunk0 = await chunker.getChunk(0);
  assert(chunk0 !== null, "Test 4: Chunk 0 exists");
  assert(chunk0!.header.byteLength === 100000, "Test 4: Chunk 0 length");
  assert(chunk0!.header.chunkIndex === 0, "Test 4: Chunk index 0");
  assert(chunk0!.data.length === 100000, "Test 4: Binary payload length");
  console.log("  PASS [Test 4: Binary chunk extraction and header metadata]");

  // Test 5: LocalMediaCache operations
  const cache = new LocalMediaCache(manifest, 10);
  assert(cache.getAvailableChunks().length === 0, "Test 5: Empty cache");

  cache.putChunk(0, chunk0!.data);
  const chunk1 = await chunker.getChunk(1);
  cache.putChunk(1, chunk1!.data);

  assert(cache.hasChunk(0), "Test 5: Has chunk 0");
  assert(cache.hasChunk(1), "Test 5: Has chunk 1");
  assert(!cache.hasChunk(2), "Test 5: Does not have chunk 2");
  assert(cache.getContiguousCoverageFromStart() === 2, "Test 5: Contiguous coverage = 2");
  console.log("  PASS [Test 5: In-memory cache storage and contiguous coverage]");

  // Test 6: Contiguous byte segment extraction
  const mergedSegment = cache.getContiguousByteSegment(0, 2);
  assert(mergedSegment !== null, "Test 6: Segment merged");
  assert(mergedSegment!.length === 200000, "Test 6: Merged segment length");
  console.log("  PASS [Test 6: Contiguous byte segment extraction for MSE buffer]");

  // Test 7: Cache LRU eviction (retaining critical headers)
  const smallCache = new LocalMediaCache(manifest, 3);
  smallCache.putChunk(0, new Uint8Array(10));
  smallCache.putChunk(1, new Uint8Array(10));
  smallCache.putChunk(2, new Uint8Array(10));
  smallCache.putChunk(3, new Uint8Array(10)); // Triggers eviction of chunk 2, keeping 0 and 1

  assert(smallCache.hasChunk(0), "Test 7: Chunk 0 preserved");
  assert(smallCache.hasChunk(1), "Test 7: Chunk 1 preserved");
  assert(smallCache.hasChunk(3), "Test 7: Chunk 3 present");
  assert(!smallCache.hasChunk(2), "Test 7: Chunk 2 evicted by LRU");
  console.log("  PASS [Test 7: LRU chunk eviction with critical header protection]");

  // Test 8: LocalMediaScheduler window calculation
  const scheduler = new LocalMediaScheduler(manifest, cache);
  const chunkAt10s = scheduler.calculateCurrentChunkIndex(10); // 10s out of 60s
  assert(chunkAt10s === 0, "Test 8: Chunk at 10s = 0");
  const chunkAt30s = scheduler.calculateCurrentChunkIndex(30); // 30s out of 60s -> 50% of 5 = chunk 2
  assert(chunkAt30s === 2, "Test 8: Chunk at 30s = 2");
  const chunkAt60s = scheduler.calculateCurrentChunkIndex(60);
  assert(chunkAt60s === 4, "Test 8: Chunk at 60s = 4");
  console.log("  PASS [Test 8: Playback timestamp to chunk index mapping on seek]");

  // Test 9: Missing chunks detection
  const missing = cache.getMissingChunkIndices([0, 1, 2, 3, 4]);
  assert(missing.length === 3 && missing.includes(2) && missing.includes(3) && missing.includes(4), "Test 9: Missing indices");
  console.log("  PASS [Test 9: Missing chunk indices detection for P2P requests]");

  console.log("----------------------------------------------------------------");
  console.log("ALL 9 LOCAL-MEDIA-001 CLIENT TESTS PASSED SUCCESSFULLY!");
  console.log("----------------------------------------------------------------");
}

runLocalMediaClientTests().catch((err) => {
  console.error("Local Media Client Test Failed:", err);
  process.exit(1);
});
