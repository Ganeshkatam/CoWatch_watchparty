import assert from "node:assert/strict";
import { RoomPlaybackCoordinator } from "./roomPlaybackCoordinator.ts";

function createMockDeps(overrides?: Partial<any>) {
  const tsMap: Record<string, number> = {};
  return {
    roomId: "test-room",
    io: {
      of: () => ({
        emit: () => {},
      }),
    } as any,
    tsMap,
    canControlPlayback: () => true,
    hasProcessedOperation: () => false,
    recordProcessedOperation: () => {},
    addChatMessage: async () => {},
    terminateSignalingSession: () => {},
    sendRoster: () => {},
    getHostState: () => ({} as any),
    resetSubtitle: () => {},
    ...overrides,
  };
}

async function runTests() {
  console.log("=== RoomPlaybackCoordinator Twitch Guarding Test Suite ===\n");

  console.log("1. Empty or whitespace proxy configuration...");
  {
    let getStreamCalls = 0;
    const deps = createMockDeps({
      twitchProxyPath: "",
      twitchClient: {
        getStream: async () => {
          getStreamCalls++;
          return [];
        },
        getVod: async () => {
          getStreamCalls++;
          return [];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/ninja");

    assert.equal(
      coordinator.video,
      "https://www.twitch.tv/ninja",
      "Video must remain original unproxied URL when proxy is empty"
    );
    assert.equal(getStreamCalls, 0, "Twitch API must not be called when proxy path is empty");
    console.log("  PASS: Empty proxy configuration bypasses API calls and leaves URL unchanged");
  }

  {
    let getStreamCalls = 0;
    const deps = createMockDeps({
      twitchProxyPath: "   ",
      twitchClient: {
        getStream: async () => {
          getStreamCalls++;
          return [];
        },
        getVod: async () => {
          getStreamCalls++;
          return [];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://twitch.tv/ninja");

    assert.equal(coordinator.video, "https://twitch.tv/ninja");
    assert.equal(getStreamCalls, 0, "Twitch API must not be called when proxy path is whitespace");
    console.log("  PASS: Whitespace proxy configuration bypasses API calls and leaves URL unchanged");
  }

  console.log("\n2. Invalid proxy configuration validation...");
  {
    let getStreamCalls = 0;
    const deps = createMockDeps({
      twitchProxyPath: "ftp://proxy.example.com",
      twitchClient: {
        getStream: async () => {
          getStreamCalls++;
          return [];
        },
        getVod: async () => {
          getStreamCalls++;
          return [];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/ninja");

    assert.equal(coordinator.video, "https://www.twitch.tv/ninja");
    assert.equal(getStreamCalls, 0, "Non-HTTP(S) proxy protocol must be rejected");
    console.log("  PASS: Non-HTTP(S) proxy protocol is rejected with 0 network calls");
  }

  {
    let getStreamCalls = 0;
    const deps = createMockDeps({
      twitchProxyPath: "https://user:pass@proxy.example.com",
      twitchClient: {
        getStream: async () => {
          getStreamCalls++;
          return [];
        },
        getVod: async () => {
          getStreamCalls++;
          return [];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/ninja");

    assert.equal(coordinator.video, "https://www.twitch.tv/ninja");
    assert.equal(getStreamCalls, 0, "Embedded proxy credentials must be rejected");
    console.log("  PASS: Embedded proxy credentials rejected with 0 network calls");
  }

  {
    let getStreamCalls = 0;
    const deps = createMockDeps({
      twitchProxyPath: "not a valid url",
      twitchClient: {
        getStream: async () => {
          getStreamCalls++;
          return [];
        },
        getVod: async () => {
          getStreamCalls++;
          return [];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/ninja");

    assert.equal(coordinator.video, "https://www.twitch.tv/ninja");
    assert.equal(getStreamCalls, 0, "Malformed proxy URL must be rejected");
    console.log("  PASS: Malformed proxy URL rejected with 0 network calls");
  }

  console.log("\n3. Deceptive domain prefix protection...");
  {
    let getStreamCalls = 0;
    const deps = createMockDeps({
      twitchProxyPath: "https://proxy.example.com",
      twitchClient: {
        getStream: async () => {
          getStreamCalls++;
          return [];
        },
        getVod: async () => {
          getStreamCalls++;
          return [];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv.evil.com/phishing");

    assert.equal(coordinator.video, "https://www.twitch.tv.evil.com/phishing");
    assert.equal(getStreamCalls, 0, "Deceptive domain must not trigger Twitch stream resolution");
    console.log("  PASS: Deceptive hostname prefix (twitch.tv.evil.com) rejected");
  }

  console.log("\n4. API failures and invalid target URLs...");
  {
    const deps = createMockDeps({
      twitchProxyPath: "https://proxy.example.com",
      twitchClient: {
        getStream: async () => {
          throw new Error("Channel offline / upstream network error");
        },
        getVod: async () => [],
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/offlinechannel");

    assert.equal(coordinator.video, "https://www.twitch.tv/offlinechannel");
    console.log("  PASS: Upstream Twitch API failure gracefully preserves original URL");
  }

  {
    const deps = createMockDeps({
      twitchProxyPath: "https://proxy.example.com",
      twitchClient: {
        getStream: async () => [{ quality: "1080p", url: "javascript:alert(1)" }],
        getVod: async () => [],
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/ninja");

    assert.equal(coordinator.video, "https://www.twitch.tv/ninja");
    console.log("  PASS: Target stream URL with non-HTTP(S) scheme rejected");
  }

  console.log("\n5. Valid Twitch live stream and VOD proxying...");
  {
    let calledChannel = "";
    const deps = createMockDeps({
      twitchProxyPath: "https://proxy.example.com",
      twitchClient: {
        getStream: async (ch: string) => {
          calledChannel = ch;
          return [
            { quality: "720p", url: "https://video-edge.twitch.tv/v1/720.m3u8" },
            { quality: "1080p (source)", url: "https://video-edge.twitch.tv/v1/source.m3u8" },
          ];
        },
        getVod: async () => [],
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/shroud");

    assert.equal(calledChannel, "shroud");
    assert(
      coordinator.video.startsWith("https://proxy.example.com/proxy/v1/source.m3u8"),
      `Video URL must point to proxy path, got: ${coordinator.video}`
    );
    const parsed = new URL(coordinator.video);
    assert.equal(parsed.searchParams.get("host"), "video-edge.twitch.tv");
    assert.equal(parsed.searchParams.get("displayName"), "https://www.twitch.tv/shroud");
    console.log("  PASS: Valid live stream proxied with source quality and metadata query params");
  }

  {
    let calledVod = "";
    const deps = createMockDeps({
      twitchProxyPath: "https://proxy.example.com",
      twitchClient: {
        getStream: async () => [],
        getVod: async (vod: string) => {
          calledVod = vod;
          return [
            { quality: "(source)", url: "https://vod-secure.twitch.tv/hls/vod12345/master.m3u8" },
          ];
        },
      },
    });
    const coordinator = new RoomPlaybackCoordinator(deps);
    await coordinator.startHosting(null as any, "https://www.twitch.tv/videos/12345");

    assert.equal(calledVod, "12345");
    assert(
      coordinator.video.startsWith("https://proxy.example.com/proxy/hls/vod12345/master.m3u8"),
      `Video URL must point to VOD proxy path, got: ${coordinator.video}`
    );
    console.log("  PASS: Valid VOD URL invokes getVod and constructs proxied URL");
  }

  console.log("\nAll RoomPlaybackCoordinator Twitch Guarding tests PASSED successfully!\n");
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });

