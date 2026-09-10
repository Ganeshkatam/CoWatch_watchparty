import {
  findPlaylistVideoByUrl,
  findPlaylistIndexByUrl,
} from "./playlist.ts";
import { Room } from "../room.ts";

async function runTests() {
  console.log("Running playlist utility & caching tests...");

  const samplePlaylist: PlaylistVideo[] = [
    {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      name: "Never Gonna Give You Up",
      channel: "Rick Astley",
      duration: 213,
      img: "https://example.com/thumb1.jpg",
      type: "youtube",
    },
    {
      url: "https://example.com/stream.m3u8",
      name: "Live Stream",
      channel: "Web",
      duration: 0,
      type: "file",
    },
  ];

  // Test 1: Canonical YouTube matching (youtu.be matches youtube.com/watch?v=)
  const found1 = findPlaylistVideoByUrl(
    samplePlaylist,
    "https://youtu.be/dQw4w9WgXcQ",
  );
  if (!found1 || found1.name !== "Never Gonna Give You Up") {
    throw new Error(
      `Expected canonical youtu.be match, got ${JSON.stringify(found1)}`,
    );
  }

  // Test 2: Canonical YouTube matching (youtube.com without www)
  const found2 = findPlaylistVideoByUrl(
    samplePlaylist,
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
  );
  if (!found2 || found2.name !== "Never Gonna Give You Up") {
    throw new Error(
      `Expected canonical youtube.com match, got ${JSON.stringify(found2)}`,
    );
  }

  // Test 3: Canonical YouTube matching with raw 11-char ID
  const found3 = findPlaylistVideoByUrl(samplePlaylist, "dQw4w9WgXcQ");
  if (!found3 || found3.name !== "Never Gonna Give You Up") {
    throw new Error(
      `Expected canonical 11-char ID match, got ${JSON.stringify(found3)}`,
    );
  }

  // Test 4: Direct non-YouTube URL matching
  const found4 = findPlaylistVideoByUrl(
    samplePlaylist,
    "https://example.com/stream.m3u8",
  );
  if (!found4 || found4.name !== "Live Stream") {
    throw new Error(`Expected direct file URL match`);
  }

  // Test 5: Index lookup adheres to canonical rules
  const idx1 = findPlaylistIndexByUrl(
    samplePlaylist,
    "https://youtu.be/dQw4w9WgXcQ",
  );
  if (idx1 !== 0) {
    throw new Error(`Expected index 0 for canonical YouTube match, got ${idx1}`);
  }

  const idx2 = findPlaylistIndexByUrl(
    samplePlaylist,
    "https://example.com/stream.m3u8",
  );
  if (idx2 !== 1) {
    throw new Error(`Expected index 1 for file match, got ${idx2}`);
  }

  const idxMissing = findPlaylistIndexByUrl(
    samplePlaylist,
    "https://example.com/missing.mp4",
  );
  if (idxMissing !== -1) {
    throw new Error(`Expected -1 for missing URL, got ${idxMissing}`);
  }

  // Test 6: Behavioral Integration Test on Room:
  // Verifies that playlistAdd() reuses existing metadata and avoids external fetch
  // when an item with identical canonical URL is already queued in room.playlist.
  const mockNamespace = {
    emit: () => {},
    use: () => {},
    on: () => {},
  };
  const mockIo: any = {
    of: () => mockNamespace,
  };

  const room = new Room(mockIo, "test-playlist-room");
  if ((room as any).tsInterval) {
    clearInterval((room as any).tsInterval);
  }

  // Set an active video so room does not auto-advance the playlist via playlistNext()
  room.video = "https://example.com/currently-playing.mp4";

  // Pre-seed an existing item in room.playlist with custom metadata
  room.playlist = [
    {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      name: "Cached Custom Title",
      channel: "Cached Verified Channel",
      duration: 999,
      img: "https://example.com/cached-thumb.jpg",
      type: "youtube",
    },
  ];

  // Add the same video via a shortened URL: https://youtu.be/dQw4w9WgXcQ
  // Under the hood, playlistAdd() must find existing via canonical normalization
  // and clone it rather than falling back or making an external API request.
  await room.playlistAdd(null, "https://youtu.be/dQw4w9WgXcQ");

  if (room.playlist.length !== 2) {
    throw new Error(`Expected room playlist to have 2 items, got ${room.playlist.length}`);
  }

  const addedItem = room.playlist[1];
  if (addedItem.name !== "Cached Custom Title") {
    throw new Error(
      `Expected cached name 'Cached Custom Title', got '${addedItem.name}'`,
    );
  }
  if (addedItem.channel !== "Cached Verified Channel") {
    throw new Error(
      `Expected cached channel 'Cached Verified Channel', got '${addedItem.channel}'`,
    );
  }
  if (addedItem.duration !== 999) {
    throw new Error(
      `Expected cached duration 999, got ${addedItem.duration}`,
    );
  }
  if (addedItem.img !== "https://example.com/cached-thumb.jpg") {
    throw new Error(
      `Expected cached thumbnail 'https://example.com/cached-thumb.jpg', got '${addedItem.img}'`,
    );
  }

  console.log("All playlist utility & caching tests passed successfully!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
