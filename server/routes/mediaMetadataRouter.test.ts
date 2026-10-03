import { strict as assert } from "node:assert";
import express from "express";
import http from "node:http";
import { createMediaMetadataRouter } from "./mediaMetadataRouter.ts";

async function runMediaMetadataRouterTests() {
  console.log("================================================================");
  console.log("STARTING MEDIA METADATA ROUTER TEST SUITE");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(desc: string, condition: boolean) {
    if (condition) {
      console.log(`  PASS [${desc}]`);
      passed++;
    } else {
      console.error(`  FAIL [${desc}]`);
      failed++;
    }
  }

  // --- Mock State ---
  let redisCounterCalls: Record<string, number> = {};
  const mockRedisCount = async (counterName: string): Promise<void> => {
    redisCounterCalls[counterName] = (redisCounterCalls[counterName] || 0) + 1;
  };

  let searchShouldFail = false;
  let lastSearchQuery: string | undefined;
  let lastSearchPageToken: string | undefined;
  const mockSearchYoutube = async (q: string, pageToken?: string) => {
    if (searchShouldFail) {
      throw new Error("YouTube API quota exceeded");
    }
    lastSearchQuery = q;
    lastSearchPageToken = pageToken;
    return {
      items: [
        { id: "vid1", title: `Video for ${q}` },
        { id: "vid2", title: `Another video for ${q}` },
      ],
      nextPageToken: pageToken ? "next_tok_after_" + pageToken : "next_tok_1",
    };
  };

  let playlistShouldFail = false;
  let lastPlaylistId: string | undefined;
  const mockYoutubePlaylist = async (playlistId: string) => {
    if (playlistShouldFail) {
      throw new Error("Playlist not found");
    }
    lastPlaylistId = playlistId;
    return [
      { id: "p1", title: `Item 1 in ${playlistId}` },
      { id: "p2", title: `Item 2 in ${playlistId}` },
    ];
  };

  let tokenValidationResponse: any = { uid: "user-123", email: "user@cowatch.test", email_verified: true };
  const mockValidateUserToken = async (_path: string, _token: string) => {
    return tokenValidationResponse;
  };

  let upsertCalls: any[] = [];
  let upsertShouldThrow = false;
  const mockUpsertObject = async (_db: any, table: string, obj: any, keys: any) => {
    if (upsertShouldThrow) {
      throw new Error("PostgreSQL write timeout");
    }
    upsertCalls.push({ table, obj, keys });
    return {};
  };

  let mockDbAvailable = true;
  const mockPostgres = {
    query: async () => ({ rows: [] }),
  };

  const mockConfig = {
    BETA_USER_EMAILS: "beta@cowatch.test,founder@cowatch.test",
    STREAM_PATH: "https://stream.cowatch.test/hls",
    CONVERT_PATH: "https://convert.cowatch.test/transcode",
  };

  const app = express();
  app.use(express.json());
  app.use(
    createMediaMetadataRouter({
      searchYoutubeFn: mockSearchYoutube as any,
      youtubePlaylistFn: mockYoutubePlaylist as any,
      redisCountFn: mockRedisCount,
      validateUserTokenFn: mockValidateUserToken as any,
      postgres: {
        get query() {
          return mockDbAvailable ? mockPostgres.query : undefined;
        },
      } as any,
      upsertObjectFn: mockUpsertObject as any,
      configOverride: mockConfig as any,
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(path: string, options: { method?: string; headers?: Record<string, string> } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        ...options.headers,
      },
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // not json
    }
    return { status: res.status, json };
  }

  try {
    // -------------------------------------------------------------
    // Test Group 1: GET /youtube
    // -------------------------------------------------------------
    {
      // 1. Missing q parameter
      const resMissingQ = await request("/youtube");
      test("GET /youtube returns 500 when q parameter missing", resMissingQ.status === 500 && resMissingQ.json.error === "query must be a string");

      // 2. Valid q parameter (unpaginated)
      redisCounterCalls = {};
      const resOk = await request("/youtube?q=lofi%20hip%20hop");
      test(
        "GET /youtube returns 200 with raw items array by default",
        resOk.status === 200 && Array.isArray(resOk.json) && resOk.json.length === 2 && resOk.json[0].id === "vid1"
      );
      test("GET /youtube increments youtubeSearch metric in Redis", redisCounterCalls["youtubeSearch"] === 1);
      test("GET /youtube passes query to searchYoutube provider", lastSearchQuery === "lofi hip hop" && lastSearchPageToken === undefined);

      // 3. Valid q parameter with paginated=1
      const resPaginated = await request("/youtube?q=coding%20music&paginated=1");
      test(
        "GET /youtube returns { items, nextPageToken } when paginated=1",
        resPaginated.status === 200 &&
          Array.isArray(resPaginated.json.items) &&
          resPaginated.json.nextPageToken === "next_tok_1"
      );

      // 4. Valid q parameter with pageToken
      const resPageToken = await request("/youtube?q=chill&pageToken=token_abc");
      test(
        "GET /youtube forwards pageToken to provider and returns paginated envelope",
        resPageToken.status === 200 &&
          lastSearchPageToken === "token_abc" &&
          resPageToken.json.nextPageToken === "next_tok_after_token_abc"
      );

      // 5. Upstream error
      searchShouldFail = true;
      const resError = await request("/youtube?q=fails");
      test("GET /youtube returns 500 { error: 'youtube error' } when provider throws", resError.status === 500 && resError.json.error === "youtube error");
      searchShouldFail = false;
    }

    // -------------------------------------------------------------
    // Test Group 2: GET /youtubePlaylist/:playlistId
    // -------------------------------------------------------------
    {
      // 6. Valid playlist
      const resPlaylist = await request("/youtubePlaylist/PL1234567890");
      test(
        "GET /youtubePlaylist/:playlistId returns 200 with items array",
        resPlaylist.status === 200 &&
          Array.isArray(resPlaylist.json) &&
          resPlaylist.json.length === 2 &&
          lastPlaylistId === "PL1234567890"
      );

      // 7. Upstream error
      playlistShouldFail = true;
      const resPlaylistError = await request("/youtubePlaylist/PL_invalid");
      test(
        "GET /youtubePlaylist/:playlistId returns 500 on provider failure",
        resPlaylistError.status === 500 && resPlaylistError.json.error === "youtube error"
      );
      playlistShouldFail = false;
    }

    // -------------------------------------------------------------
    // Test Group 3: GET /metadata
    // -------------------------------------------------------------
    {
      // 8. Unauthenticated request (no Authorization header)
      upsertCalls = [];
      const resGuest = await request("/metadata");
      test(
        "GET /metadata returns 200 with { beta: false } for unauthenticated guest",
        resGuest.status === 200 &&
          resGuest.json.beta === false &&
          resGuest.json.streamPath === undefined &&
          resGuest.json.convertPath === undefined
      );
      test("GET /metadata does not record active_user for guest", upsertCalls.length === 0);

      // 9. Malformed Authorization header
      const resMalformed = await request("/metadata", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      test(
        "GET /metadata ignores non-Bearer authorization header and treats as guest",
        resMalformed.status === 200 && resMalformed.json.beta === false
      );

      // 10. Authenticated non-beta user
      upsertCalls = [];
      tokenValidationResponse = { uid: "user-456", email: "standard@cowatch.test", email_verified: true };
      const resAuthUser = await request("/metadata", {
        headers: { Authorization: "Bearer valid-token-standard" },
      });
      test(
        "GET /metadata returns convertPath and beta:false for standard authenticated user",
        resAuthUser.status === 200 &&
          resAuthUser.json.beta === false &&
          resAuthUser.json.convertPath === "https://convert.cowatch.test/transcode" &&
          resAuthUser.json.streamPath === undefined
      );
      test(
        "GET /metadata logs active_user upsert with uid and lastActiveTime",
        upsertCalls.length === 1 &&
          upsertCalls[0].table === "active_user" &&
          upsertCalls[0].obj.uid === "user-456" &&
          upsertCalls[0].obj.lastActiveTime instanceof Date
      );

      // 11. Authenticated beta user
      upsertCalls = [];
      tokenValidationResponse = { uid: "beta-uid-789", email: "beta@cowatch.test", email_verified: true };
      const resBetaUser = await request("/metadata", {
        headers: { Authorization: "Bearer valid-token-beta" },
      });
      test(
        "GET /metadata returns streamPath, convertPath, and beta:true for beta user",
        resBetaUser.status === 200 &&
          resBetaUser.json.beta === true &&
          resBetaUser.json.streamPath === "https://stream.cowatch.test/hls" &&
          resBetaUser.json.convertPath === "https://convert.cowatch.test/transcode"
      );

      // 12. Unverified email user
      tokenValidationResponse = "EMAIL_NOT_VERIFIED";
      const resUnverified = await request("/metadata", {
        headers: { Authorization: "Bearer unverified-token" },
      });
      test(
        "GET /metadata returns 403 EMAIL_NOT_VERIFIED when user email unverified",
        resUnverified.status === 403 &&
          resUnverified.json.error?.code === "EMAIL_NOT_VERIFIED"
      );

      // 13. Fire-and-forget upsert failure resilience
      tokenValidationResponse = { uid: "user-resilient", email: "user@cowatch.test", email_verified: true };
      upsertShouldThrow = true;
      const resUpsertError = await request("/metadata", {
        headers: { Authorization: "Bearer token-resilient" },
      });
      test(
        "GET /metadata succeeds with 200 even if active_user upsert throws",
        resUpsertError.status === 200 && resUpsertError.json.convertPath !== undefined
      );
      upsertShouldThrow = false;

      // 14. Database null/offline resilience
      mockDbAvailable = false;
      const resDbOffline = await request("/metadata", {
        headers: { Authorization: "Bearer token-offline" },
      });
      test(
        "GET /metadata succeeds with 200 when database connection is unavailable",
        resDbOffline.status === 200 && resDbOffline.json.beta === false
      );
      mockDbAvailable = true;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n================================================================");
  console.log(`MEDIA METADATA ROUTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runMediaMetadataRouterTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution aborted:", err);
    process.exit(1);
  });
