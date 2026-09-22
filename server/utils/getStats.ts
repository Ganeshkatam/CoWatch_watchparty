import type { AssignedVM } from "../vm/base.ts";
import { postgres } from "./postgres.ts";
import os from "node:os";
import { getRedisCountDay, getRedisCountDayDistinct, edgeRedis, metricsRedis, redisEdge, RedisMetrics } from "./redis.ts";
import config from "../config.ts";
import { apps } from "../ecosystem.config.js";

export async function getStats() {
  const now = Date.now();

  let currentUsers = 0;

  // Render each shard metrics as its own object
  const shardMetrics: Record<string, ShardMetric> = {};
  const shardKeys = new Set(
    apps.map((app) => `shardMetrics:${app.env?.SHARD ?? 0}`),
  );
  for (let key of shardKeys) {
    const resp2 = await edgeRedis.execute("stats", "get", (c) => c.get(key));
    if (resp2) {
      shardMetrics[key] = JSON.parse(resp2);
      currentUsers += shardMetrics[key].users;
    }
  }

  // Count these from postgres data
  let currentHttp = 0;
  let currentVBrowser = 0;
  let currentVBrowserLarge = 0;
  let currentScreenShare = 0;
  let currentFileShare = 0;
  const currentRoomSizes: Record<string, number> = {};

  const result = await postgres?.query<{
    roomId: string;
    creationTime: Date;
    lastUpdateTime: Date;

    isSubRoom: boolean;
    roomTitle: string;
    roomDescription: string;
    mediaPath: string;
    owner_id: string;
    password: string;
    video: string;
    videoTS: number;
    vBrowser: AssignedVM;
    creator: string;
    lock: string;
  }>(
    `SELECT "roomId", "creationTime", "lastUpdateTime", "isSubRoom", "roomTitle", "roomDescription", "mediaPath", owner_id, password,
    data->'video' as video, data->'videoTS' as "videoTS", data->'vBrowser' as "vBrowser", data->'creator' as creator, data->'lock' as lock
    FROM rooms
    WHERE "lastUpdateTime" > NOW() - INTERVAL '7 day'
    AND length(data->>'video') > 0
    ORDER BY "creationTime" DESC`,
  );
  // Batch presence read: 1 single HGETALL command instead of 2 * N GET commands
  const batchPresence = await redisEdge.getRoomPresenceBatch().catch(() => ({} as Record<string, string>));

  const currentRoomData = await Promise.all(
    (result?.rows ?? []).map(async (dbRoom) => {
      const vBrowser = dbRoom.vBrowser;
      if (vBrowser) {
        currentVBrowser += 1;
      }
      if (vBrowser?.large) {
        currentVBrowserLarge += 1;
      }

      let rosterLength = 0;
      let roster: any[] = [];
      const batchData = batchPresence[dbRoom.roomId];
      if (batchData) {
        try {
          const parsed = JSON.parse(batchData);
          rosterLength = Number(parsed.count) || 0;
          roster = parsed.roster || [];
        } catch {
          rosterLength = Number(batchData) || 0;
        }
      } else if (edgeRedis.client) {
        // Fallback to legacy keys if batch presence entry not found
        rosterLength = Number(await edgeRedis.execute("presence", "get", (c) => c.get(`roomCounts:${dbRoom.roomId}`))) || 0;
        if (rosterLength > 0) {
          const resp = await edgeRedis.execute("presence", "get", (c) => c.get(`roomRosters:${dbRoom.roomId}`));
          if (resp) {
            try { roster = JSON.parse(resp); } catch {}
          }
        }
      }

      if (rosterLength) {
        currentRoomSizes[rosterLength] =
          (currentRoomSizes[rosterLength] ?? 0) + 1;
      }
      const obj = {
        roomId: dbRoom.roomId,
        video: dbRoom.video || undefined,
        videoTS: dbRoom.videoTS || undefined,
        creationTime: dbRoom.creationTime || undefined,
        lastUpdateTime: dbRoom.lastUpdateTime || undefined,

        isSubRoom: dbRoom.isSubRoom || undefined,
        owner: dbRoom.owner_id || undefined,
        password: dbRoom.password || undefined,
        roomTitle: dbRoom.roomTitle || undefined,
        roomDescription: dbRoom.roomDescription || undefined,
        mediaPath: dbRoom.mediaPath || undefined,
        vBrowser,
        vBrowserElapsed: vBrowser?.assignTime && now - vBrowser?.assignTime,
        lock: dbRoom.lock || undefined,
        creator: dbRoom.creator || undefined,
        rosterLength,
        roster,
      };
      if (obj.video?.startsWith("http") && rosterLength) {
        currentHttp += 1;
      }
      if (obj.video?.startsWith("screenshare://") && rosterLength) {
        currentScreenShare += 1;
      }
      if (obj.video?.startsWith("fileshare://") && rosterLength) {
        currentFileShare += 1;
      }
      return obj;
    }),
  );
  // Singleton stats below (same for all shards)
  const currentVideoChat = 0;
  const cpuUsage = os.loadavg()[1] * 100;
  const redisUsage = Number(
    (await metricsRedis.execute("metrics", "info", (c) => c.info()))
      ?.split("\n")
      .find((line: string) => line.startsWith("used_memory:"))
      ?.split(":")[1]
      .trim(),
  );
  const postgresUsage = Number(
    (await postgres?.query(`SELECT pg_database_size('postgres');`))?.rows[0]
      .pg_database_size,
  );
  const numPermaRooms = Number(
    (await postgres?.query("SELECT count(1) from rooms WHERE \"isPermanent\" = true"))
      ?.rows[0].count,
  );
  const numAllRooms = Number(
    (await postgres?.query("SELECT count(1) from rooms"))?.rows[0].count,
  );
  const numSubs = Number(
    (await postgres?.query("SELECT count(1) from subscriber"))?.rows[0].count,
  );

  const createRoomErrors = await getRedisCountDay("createRoomError");
  const deleteAccounts = await getRedisCountDay("deleteAccount");
  const chatMessages = await getRedisCountDay("chatMessages");
  const addReactions = await getRedisCountDay("addReaction");
  const hetznerApiRemaining = Number(await edgeRedis.execute("hetzner", "get", (c) => c.get("hetznerApiRemaining")));
  const vBrowserStarts = await getRedisCountDay("vBrowserStarts");
  const vBrowserLaunches = await getRedisCountDay("vBrowserLaunches");
  const vBrowserFails = await getRedisCountDay("vBrowserFails");
  const vBrowserStagingFails = await getRedisCountDay("vBrowserStagingFails");
  const vBrowserReimages = await getRedisCountDay("vBrowserReimage");
  const vBrowserCleanups = await getRedisCountDay("vBrowserCleanup");
  const vBrowserStopTimeout = await getRedisCountDay(
    "vBrowserTerminateTimeout",
  );
  const vBrowserStopEmpty = await getRedisCountDay("vBrowserTerminateEmpty");
  const vBrowserStopManual = await getRedisCountDay("vBrowserTerminateManual");
  const vBrowserStartMS = await metricsRedis.execute("analytics", "lrange", (c) => c.lrange("vBrowserStartMS", 0, -1));
  const vBrowserStageRetries = await metricsRedis.execute("analytics", "lrange", (c) => c.lrange("vBrowserStageRetries", 0, -1));
  const vBrowserStageFails = await metricsRedis.execute("analytics", "lrange", (c) => c.lrange("vBrowserStageFails", 0, -1));
  const vBrowserSessionMS = await metricsRedis.execute("analytics", "lrange", (c) => c.lrange("vBrowserSessionMS", 0, -1));
  // const vBrowserVMLifetime = await metricsRedis.execute("analytics", "lrange", (c) => c.lrange('vBrowserVMLifetime', 0, -1));
  const proxyReqs = await getRedisCountDay("proxyReqs");
  const urlStarts = await getRedisCountDay("urlStarts");
  const streamStarts = await getRedisCountDay("streamStarts");
  const convertStarts = await getRedisCountDay("convertStarts");
  const playlistAdds = await getRedisCountDay("playlistAdds");
  const screenShareStarts = await getRedisCountDay("screenShareStarts");
  const fileShareStarts = await getRedisCountDay("fileShareStarts");
  const mediasoupStarts = await getRedisCountDay("mediasoupStarts");
  const videoChatStarts = await getRedisCountDay("videoChatStarts");
  const connectStarts = await getRedisCountDay("connectStarts");
  const connectStartsDistinct = await getRedisCountDayDistinct(
    "connectStartsDistinct",
  );
  const subUploads = await getRedisCountDay("subUploads");
  const subDownloadsOS = await getRedisCountDay("subDownloadsOS");
  const subSearchesOS = await getRedisCountDay("subSearchesOS");
  const youtubeSearch = await getRedisCountDay("youtubeSearch");
  const vBrowserClientIDsCard = await metricsRedis.execute("analytics", "zcard", (c) => c.zcard("vBrowserClientIDs"));
  const vBrowserUIDsCard = await metricsRedis.execute("analytics", "zcard", (c) => c.zcard("vBrowserUIDs"));
  const createRoomPreloads = await getRedisCountDay("createRoomPreload");

  const vBrowserClientIDs = altArrayToObject(
    await metricsRedis.execute("analytics", "zrevrangebyscore", (c) => c.zrevrangebyscore(
      "vBrowserClientIDs",
      "+inf",
      "-inf",
      "WITHSCORES",
      "LIMIT",
      0,
      20,
    )),
  );
  const vBrowserUIDs = altArrayToObject(
    await metricsRedis.execute("analytics", "zrevrangebyscore", (c) => c.zrevrangebyscore(
      "vBrowserUIDs",
      "+inf",
      "-inf",
      "WITHSCORES",
      "LIMIT",
      0,
      20,
    )),
  );
  const vBrowserClientIDMinutes = altArrayToObject(
    await metricsRedis.execute("analytics", "zrevrangebyscore", (c) => c.zrevrangebyscore(
      "vBrowserClientIDMinutes",
      "+inf",
      "0",
      "WITHSCORES",
      "LIMIT",
      0,
      20,
    )),
  );
  const vBrowserUIDMinutes = altArrayToObject(
    await metricsRedis.execute("analytics", "zrevrangebyscore", (c) => c.zrevrangebyscore(
      "vBrowserUIDMinutes",
      "+inf",
      "0",
      "WITHSCORES",
      "LIMIT",
      0,
      20,
    )),
  );

  // Fetch VM stats from vmworker
  const resp = await fetch(
    "http://localhost:" + config.VMWORKER_PORT + "/stats",
  );
  const vmManagerStats = await resp.json();

  return {
    ...shardMetrics,
    currentRoomSizes,
    counts: {
      currentUsers,
      currentVideoChat,
      currentVBrowser,
      currentVBrowserLarge,
      currentHttp,
      currentScreenShare,
      currentFileShare,
      cpuUsage,
      redisUsage,
      postgresUsage,
      numPermaRooms,
      numAllRooms,
      numSubs,

      createRoomErrors,
      createRoomPreloads,
      deleteAccounts,
      chatMessages,
      addReactions,
      proxyReqs,
      urlStarts,
      streamStarts,
      convertStarts,
      playlistAdds,
      screenShareStarts,
      fileShareStarts,
      mediasoupStarts,
      subUploads,
      subDownloadsOS,
      subSearchesOS,
      youtubeSearch,
      videoChatStarts,
      connectStarts,
      connectStartsDistinct,
      hetznerApiRemaining,
      vBrowserStarts,
      vBrowserLaunches,
      vBrowserFails,
      vBrowserStagingFails,
      vBrowserReimages,
      vBrowserCleanups,
      vBrowserStopManual,
      vBrowserStopEmpty,
      vBrowserStopTimeout,
      vBrowserClientIDsCard,
      vBrowserUIDsCard,
    },
    // Stats object from vmWorker (render as JSON)
    vmManagerStats,
    // Array of room data (render as JSON)
    currentRoomData,
    // Arrays of last values (render as one column table)
    vBrowserStartMS,
    vBrowserStageRetries,
    vBrowserStageFails,
    vBrowserSessionMS,
    // Maps of vbrowser users
    vBrowserClientIDs,
    vBrowserClientIDMinutes,
    vBrowserUIDs,
    vBrowserUIDMinutes,
    redisMetrics: RedisMetrics.getSnapshot(),
  };
}

function altArrayToObject(arr: string[] | undefined) {
  const result: Record<string, number> = {};
  if (!arr) {
    return result;
  }
  for (let i = 0; i < arr.length; i += 2) {
    const k = arr[i];
    const v = arr[i + 1];
    result[k] = Number(v);
  }
  return result;
}
