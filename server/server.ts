import config from "./config.ts"; // force reload
import fs from "node:fs";
import express, { type Response } from "express";
import bodyParser from "body-parser";
import compression from "compression";
import cors from "cors";
import https from "node:https";
import http from "node:http";
import { Server } from "socket.io";
import { searchYoutube, youtubePlaylist } from "./utils/youtube.ts";
import { Room } from "./room.ts";
import { redis, redisCount } from "./utils/redis.ts";
import { deleteUser, validateUserToken, supabaseAdmin } from "./utils/supabase.ts";
import { getStartOfDay } from "./utils/time.ts";
import { getSessionLimitSeconds } from "./vm/utils.ts";
import { postgres, insertObject, upsertObject } from "./utils/postgres.ts";
import axios, { isAxiosError } from "axios";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolveShard } from "./utils/resolveShard.ts";
import { makeRoomName, makeUserName } from "./utils/moniker.ts";
import { getStats } from "./utils/getStats.ts";
import {
  hashRoomPasscode,
  encryptPasscodeForOwner,
  decryptPasscodeForOwner,
} from "./utils/roomPasscode.ts";

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in server process:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled promise rejection at:", promise, "reason:", reason);
});

if (process.env.NODE_ENV === "development") {
  axios.interceptors.request.use(
    (config) => {
      // console.log(config);
      return config;
    },
    (error) => {
      console.error(error);
    },
  );
}

const releaseInterval = 5 * 60 * 1000;
const app = express();
let server = null as https.Server | http.Server | null;
if (config.SSL_KEY_FILE && config.SSL_CRT_FILE) {
  const key = fs.readFileSync(config.SSL_KEY_FILE);
  const cert = fs.readFileSync(config.SSL_CRT_FILE);
  server = https.createServer({ key: key, cert: cert }, app);
} else {
  server = new http.Server(app);
}
const listenPort = Number(process.env.PORT || config.PORT || 8080);
const listenHost = config.HOST || "0.0.0.0";
server?.listen(listenPort, listenHost, () => {
  console.log(`Server listening on ${listenHost}:${listenPort}`);
});
server?.on("error", (err: any) => {
  console.error("Server listen error:", err);
});

const io = new Server(server, { cors: {}, transports: ["websocket"] });
io.engine.use(async (req: any, res: Response, next: () => void) => {
  const roomId = req._query.roomId;
  if (!roomId) {
    return next();
  }
  // Attempt to ensure the room being connected to is loaded in memory
  // If it doesn't exist, we may fail later with "invalid namespace"
  const shard = resolveShard(roomId);
  const key = roomId;
  // Check to make sure this shard should load this room
  const isCorrectShard = !config.SHARD || shard === Number(config.SHARD);
  // Get the room data from postgres
  const persistedRoom = (
    await postgres?.query<PersistentRoom>(
      `SELECT * from rooms where "roomId" = $1`,
      [key],
    )
  )?.rows?.[0];
  // Don't await after this because we may have a race condition where 2 rquests both try to load the room
  if (isCorrectShard && !rooms.has(key)) {
    const data = persistedRoom?.data
      ? JSON.stringify(persistedRoom.data)
      : undefined;
    if (data) {
      const room = new Room(io, key, data);
      if (persistedRoom) {
        room.status = persistedRoom.status || 'active';
        room.expiresAt = persistedRoom.expiresAt ? new Date(persistedRoom.expiresAt as string) : undefined;
        room.owner_id = persistedRoom.owner_id;
        room.isPermanent = persistedRoom.isPermanent || false;
      }
      rooms.set(key, room);
      console.log(
        "loading room %s into memory on shard %s",
        roomId,
        config.SHARD,
      );
    }
  }
  next();
});

const rooms = new Map<string, Room>();
// Following functions iterate over in-memory rooms
setInterval(minuteMetrics, 60 * 1000);
setInterval(release, releaseInterval);
setInterval(saveRooms, 1000);
setInterval(expireRooms, 60 * 1000);
if (process.env.NODE_ENV === "development") {
  try {
    import("./vmWorker.ts");
    // import('./syncSubs.ts');
    // import('./timeSeries.ts');
  } catch (e) {
    console.error(e);
  }
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "text/plain", limit: 1000000 }));

app.get("/ping", (_req, res) => {
  res.json("pong");
});

// Data's already compressed so go before the compression middleware
app.get("/subtitle/:hash", async (req, res) => {
  const key = "subtitle:" + req.params.hash;
  const buf = await redis?.getBuffer(key);
  if (!buf) {
    res.status(404).end("not found");
    return;
  }
  await redis?.expire(key, 24 * 60 * 60);
  res.setHeader("Content-Encoding", "gzip");
  res.end(buf);
});

app.use(compression());

app.post("/subtitle", async (req, res) => {
  const data = req.body;
  if (!redis) {
    return;
  }
  // calculate hash, gzip and save to redis
  const hash = crypto
    .createHash("sha256")
    .update(data, "utf8")
    .digest()
    .toString("hex");
  let gzipData = gzipSync(data);
  await redis.setex("subtitle:" + hash, 24 * 60 * 60, gzipData);
  redisCount("subUploads");
  res.json({ hash });
});

app.get("/downloadSubtitles", async (req, res) => {
  // Request the URL from OS
  try {
    const urlResp = await axios<{ link: string }>({
      url: "https://api.opensubtitles.com/api/v1/download",
      method: "POST",
      headers: {
        "User-Agent": "cowatch v1",
        "Api-Key": config.OPENSUBTITLES_KEY,
        Accept: "application/json",
        "Content-Type": "application/json",
        // 'Authorization': 'Bearer ' + config.OPENSUBTITLES_KEY,
      },
      data: {
        file_id: req.query.file_id,
        // sub_format: 'srt',
      },
    });
    redisCount("subDownloadsOS");
    if (!redis) {
      // Return the direct link to the user, will work for about 3 hours
      res.json(urlResp.data);
      return;
    }
    // Cache the contents in Redis (longer retention)
    const subResp = await axios.get(urlResp.data.link, {
      responseType: "arraybuffer",
    });
    const data = subResp.data;
    const hash = crypto
      .createHash("sha256")
      .update(data, "utf8")
      .digest()
      .toString("hex");
    let gzipData = gzipSync(data);
    await redis.setex("subtitle:" + hash, 24 * 60 * 60, gzipData);
    res.json({ link: "/subtitle/" + hash });
  } catch (e) {
    if (isAxiosError(e)) {
      console.log(e.response);
    }
    throw e;
  }
});

app.get("/searchSubtitles", async (req, res) => {
  try {
    const title = req.query.title ? String(req.query.title) : "";
    const url = req.query.url ? String(req.query.url) : "";
    let subUrl = "";
    if (url) {
      const startResp = await axios({
        method: "get",
        url: url,
        headers: {
          Range: "bytes=0-65535",
        },
        responseType: "arraybuffer",
      });
      const start = startResp.data;
      const size = Number(startResp.headers["content-range"].split("/")[1]);
      const endResp = await axios({
        method: "get",
        url: url,
        headers: {
          Range: `bytes=${size - 65536}-`,
        },
        responseType: "arraybuffer",
      });
      const end = endResp.data;
      // console.log(start, end, size);
      let hash = computeOpenSubtitlesHash(start, end, size);
      // hash = 'f65334e75574f00f';
      // Search API for subtitles by hash
      subUrl = `https://api.opensubtitles.com/api/v1/subtitles?moviehash=${hash}&languages=en`;
    } else if (title) {
      subUrl = `https://api.opensubtitles.com/api/v1/subtitles?query=${title}&languages=en`;
    }
    // Alternative, web client calls this to get back some JS with the download URL embedded
    // https://www.opensubtitles.com/nocache/download/7585196/subreq.js?file_name=Borgen.S04E01.en&locale=en&np=true&sub_frmt=srt&subtitle_id=6615808&ext_installed=false
    // Up to 10 downloads per IP per day, but proxyable and doesn't require key
    const response = await axios.get(subUrl, {
      headers: {
        "User-Agent": "cowatch v1",
        "Api-Key": config.OPENSUBTITLES_KEY,
      },
    });
    // console.log(subUrl, response.data);
    const subtitles = response.data;
    res.json(subtitles.data);
  } catch (e: any) {
    console.error(e.message);
    res.json([]);
  }
  redisCount("subSearchesOS");
});

app.get("/stats", async (req, res) => {
  if (req.query.key && req.query.key === config.STATS_KEY) {
    const stats = await getStats();
    res.json(stats);
  } else {
    res.status(403).json({ error: "Access Denied" });
  }
});

app.post("/api/account/delete", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    const token = authHeader.split(" ")[1];

    // Authenticate and get uid
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    const uid = user.id;

    // Clean up Storage (avatars bucket)
    const { data: existingFiles, error: listError } = await supabaseAdmin.storage.from("avatars").list(uid);
    if (listError) {
      console.error("Storage list error during account deletion:", listError);
      res.status(500).json({ error: "Failed to list avatars" });
      return;
    }

    if (existingFiles && existingFiles.length > 0) {
      const filesToRemove = existingFiles.map((f: any) => `${uid}/${f.name}`);
      const { error: removeError } = await supabaseAdmin.storage.from("avatars").remove(filesToRemove);
      if (removeError) {
        console.error("Storage remove error during account deletion:", removeError);
        res.status(500).json({ error: "Failed to delete avatars" });
        return;
      }
    }

    // Delete Auth User (Postgres handles cascades automatically)
    const { error: deleteError } = await deleteUser(uid);
    if (deleteError) {
      console.error("Auth delete error during account deletion:", deleteError);
      res.status(500).json({ error: "Failed to delete auth user" });
      return;
    }

    res.status(204).send();
  } catch (e: any) {
    console.error("Error during account deletion:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health/:metric", async (req, res) => {
  const vmManagerStats = (
    await axios.get("http://localhost:" + config.VMWORKER_PORT + "/stats")
  ).data;
  const result = vmManagerStats[req.params.metric]?.availableVBrowsers?.length;
  res.status(result ? 200 : 500).json(result);
});

app.get("/timeSeries", async (req, res) => {
  if (req.query.key && req.query.key === config.STATS_KEY && redis) {
    const timeSeriesData = await redis.lrange("timeSeries", 0, -1);
    const timeSeries = timeSeriesData.map((entry) => JSON.parse(entry));
    res.json(timeSeries);
  } else {
    res.status(403).json({ error: "Access Denied" });
  }
});

app.get("/youtube", async (req, res) => {
  if (typeof req.query.q === "string") {
    try {
      redisCount("youtubeSearch");
      const items = await searchYoutube(req.query.q);
      res.json(items);
    } catch {
      res.status(500).json({ error: "youtube error" });
    }
  } else {
    res.status(500).json({ error: "query must be a string" });
  }
});

app.get("/youtubePlaylist/:playlistId", async (req, res) => {
  try {
    const items = await youtubePlaylist(req.params.playlistId);
    res.json(items);
  } catch {
    res.status(500).json({ error: "youtube error" });
  }
});

app.post("/createRoom", async (req, res) => {
  // Authentication is required to create a room
  if (!req.body?.token || !req.body?.uid) {
    res.status(401).json({ error: "Authentication is required to create a room." });
    return;
  }
  const decoded = await validateUserToken(req.body.uid, req.body.token);
  if (!decoded) {
    res.status(401).json({ error: "Invalid authentication token." });
    return;
  }
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }

  const roomTitle =
    typeof req.body.roomTitle === "string"
      ? req.body.roomTitle.trim()
      : "";

  if (roomTitle.length === 0) {
    res.status(400).json({
      error: "Room title is required.",
    });
    return;
  }
  if (roomTitle.length > 50) {
    res.status(400).json({
      error: "Room title is too long (max 50 characters).",
    });
    return;
  }

  const genName = () => makeRoomName(config.SHARD);
  let name = genName();
  console.log("createRoom: ", name, "by user:", decoded.email);
  const newRoom = new Room(io, name);

  if (req.body?.lock) {
    newRoom.lock = decoded.uid;
  }
  newRoom.isChatDisabled = Boolean(req.body?.isChatDisabled);
  newRoom.creator = decoded.email || "";

  const isPermanent = Boolean(req.body?.isPermanent);
  const now = new Date();
  const expiresAt = isPermanent ? undefined : new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours from now
  newRoom.expiresAt = expiresAt;
  newRoom.status = 'active';
  newRoom.owner_id = decoded.uid;
  newRoom.isPermanent = isPermanent;

  if (postgres) {
    const rawPasscode = req.body?.passcode;
    const roomObj = {
      roomId: newRoom.roomId,
      lastUpdateTime: now,
      creationTime: now,
      passcode: await hashRoomPasscode(rawPasscode),
      owner_passcode: encryptPasscodeForOwner(rawPasscode),

      isChatDisabled: Boolean(req.body?.isChatDisabled),
      roomTitle: roomTitle,
      roomDescription: req.body?.roomDescription || null,
      owner_id: decoded.uid,
      isSubRoom: isPermanent,
      status: 'active',
      startedAt: now,
      expiresAt: expiresAt ?? null,
      isPermanent: isPermanent,
    };
    try {
      await insertObject(postgres, "rooms", roomObj);
      await postgres.query(`
        INSERT INTO room_lifecycle_events 
        ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [newRoom.roomId, decoded.uid, 'room.created', 'active', expiresAt ?? null, isPermanent ? 'permanent room creation' : 'temporary room creation']);
    } catch (e) {
      redisCount("createRoomError");
      throw e;
    }
  }

  const preload = (req.body?.video || "").slice(0, 20000);
  if (preload) {
    redisCount("createRoomPreload");
    newRoom.video = preload;
    newRoom.paused = true;
    await newRoom.saveRoom();
  }
  const prePlaylist = Array.isArray(req.body?.playlist) && req.body?.playlist;
  if (prePlaylist) {
    for (let item of req.body.playlist) {
      newRoom.playlistAdd(null, item);
    }
  }
  rooms.set(name, newRoom);
  res.json({ name });
});

app.post("/updateRoomCover", async (req, res) => {
  const decoded = await validateUserToken(req.body?.uid, req.body?.token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(400).json({ error: "invalid user token" });
    return;
  }

  const roomId = req.body?.roomId;
  const coverPhoto = req.body?.coverPhoto;

  if (!roomId || coverPhoto === undefined) {
    res.status(400).json({ error: "missing roomId or coverPhoto" });
    return;
  }

  if (postgres) {
    const result = await postgres.query(
      `UPDATE rooms SET "coverPhoto" = $1 WHERE "roomId" = $2 AND owner_id = $3 RETURNING "roomId"`,
      [coverPhoto, roomId, decoded.uid]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Database not configured" });
  }
});

app.post("/updateRoomSettings", async (req, res) => {
  const decoded = await validateUserToken(req.body?.uid, req.body?.token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(400).json({ error: "invalid user token" });
    return;
  }

  const { roomId, roomTitle, roomDescription, isPermanent, isChatDisabled, password, removePassword } = req.body;

  if (!roomId || typeof roomTitle !== 'string' || typeof isPermanent !== 'boolean' || typeof isChatDisabled !== 'boolean') {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const titleTrimmed = roomTitle.trim();
  if (titleTrimmed.length === 0 || titleTrimmed.length > 50) {
    res.status(400).json({ error: "Invalid title length" });
    return;
  }

  if (roomDescription && roomDescription.length > 500) {
    res.status(400).json({ error: "Description too long" });
    return;
  }

  let passcodeHash: string | null = null;
  let ownerPasscodeEncrypted: string | null = null;
  const isClearingPassword = removePassword === true || password === "";

  if (!isClearingPassword && typeof password === 'string' && password.length > 0) {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      res.status(400).json({ error: "Password too long" });
      return;
    }
    passcodeHash = await hashRoomPasscode(password);
    ownerPasscodeEncrypted = encryptPasscodeForOwner(password);
  }

  if (!postgres) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }

  const client = await postgres.connect();
  try {
    await client.query('BEGIN');

    const existingRoom = await client.query(`SELECT "expiresAt", "isSubRoom", "isPermanent" FROM rooms WHERE "roomId" = $1 AND owner_id = $2 FOR UPDATE`, [roomId, decoded.uid]);

    if (existingRoom.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }

    const room = existingRoom.rows[0];
    const currentlyPermanent = Boolean(room.isPermanent);

    let newExpiresAt = room.expiresAt;
    let newIsSubRoom = room.isSubRoom;
    let permanenceChanged = false;

    if (isPermanent && !currentlyPermanent) {
      newExpiresAt = null;
      newIsSubRoom = true;
      permanenceChanged = true;
    } else if (!isPermanent && currentlyPermanent) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      newExpiresAt = tomorrow;
      newIsSubRoom = false;
      permanenceChanged = true;
    }

    let updateQuery = `UPDATE rooms SET "roomTitle" = $1, "roomDescription" = $2, "expiresAt" = $3, "isSubRoom" = $4, "isChatDisabled" = $5, "isPermanent" = $6`;
    const updateValues: any[] = [titleTrimmed, roomDescription || null, newExpiresAt, newIsSubRoom, isChatDisabled, isPermanent];

    if (isClearingPassword) {
      updateQuery += `, passcode = NULL, owner_passcode = NULL`;
    } else if (passcodeHash && ownerPasscodeEncrypted) {
      updateValues.push(passcodeHash, ownerPasscodeEncrypted);
      updateQuery += `, passcode = $${updateValues.length - 1}, owner_passcode = $${updateValues.length}`;
    }

    updateValues.push(roomId, decoded.uid);
    updateQuery += ` WHERE "roomId" = $${updateValues.length - 1} AND owner_id = $${updateValues.length}`;

    await client.query(updateQuery, updateValues);

    if (permanenceChanged) {
      await client.query(
        `INSERT INTO room_lifecycle_events (room_id, actor_id, event_type, previous_status, new_status, previous_expires_at, new_expires_at, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [roomId, decoded.uid, 'room.permanence_changed', null, null, room.expiresAt, newExpiresAt, isPermanent ? "Room converted from temporary to permanent" : "Room converted from permanent to temporary"]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error("updateRoomSettings error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete("/deleteAccount", async (req, res) => {
  // TODO pass this in req.query instead
  const decoded = await validateUserToken(req.body?.uid, req.body?.token, false);
  if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  if (postgres) {
    // Delete rooms
    await postgres.query("DELETE FROM rooms WHERE owner_id = $1", [decoded.uid]);
    // Delete linked accounts
    await postgres.query("DELETE FROM link_account WHERE uid = $1", [
      decoded.uid,
    ]);
  }
  await deleteUser(decoded.uid);
  redisCount("deleteAccount");
  res.json({});
});

app.get("/metadata", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.query?.uid),
    String(req.query?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  let isFreePoolFull = false;
  if (config.VM_MANAGER_CONFIG) {
    try {
      isFreePoolFull = (
        await axios.get(
          "http://localhost:" + config.VMWORKER_PORT + "/isFreePoolFull",
        )
      ).data.isFull;
    } catch (e: any) {
      console.warn("[WARNING]: free pool check failed: %s", e.code);
    }
  }
  const beta =
    decoded?.email != null &&
    Boolean(config.BETA_USER_EMAILS.split(",").includes(decoded?.email));
  const streamPath = beta ? config.STREAM_PATH : undefined;
  // Available to all authenticated users
  const convertPath = decoded ? config.CONVERT_PATH : undefined;

  // log metrics but don't wait for it
  if (postgres && decoded?.uid) {
    upsertObject(
      postgres,
      "active_user",
      { uid: decoded?.uid, lastActiveTime: new Date() },
      { uid: true },
    ).catch((e: any) => {
      console.warn("[WARNING]: active_user upsert failed:", e.message);
    });
  }
  res.json({
    isFreePoolFull,
    beta,
    streamPath,
    convertPath,
  });
});

app.get("/roomData/:roomId", async (req, res) => {
  // Returns the room data given a room ID
  // Only return data if the room doesn't have a passcode
  // If it does, we could accept it as a URL parameter but for now just don't support
  const result = await postgres?.query(
    `SELECT data from room WHERE "roomId" = $1 and passcode IS NULL`,
    [req.params.roomId],
  );
  res.json(result?.rows[0]?.data);
});

app.get("/resolveShard/:roomId", async (req, res) => {
  const shardNum = resolveShard(req.params.roomId);
  res.send(String(config.SHARD ? shardNum : ""));
});

app.get("/listRooms", async (req, res) => {
  try {
    const decoded = await validateUserToken(
      String(req.query?.uid),
      String(req.query?.token),
    );
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(400).json({ error: "invalid user token" });
      return;
    }
    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const result = await postgres.query(
      `SELECT "roomId", (passcode IS NOT NULL AND passcode <> '') AS "isPasscodeProtected",
                "creationTime", "roomTitle", "roomDescription", "coverPhoto", "isChatDisabled", "isSubRoom",
                status, "startedAt", "expiresAt", "endedAt", "isPermanent", owner_passcode
         FROM rooms WHERE owner_id = $1 ORDER BY "creationTime" DESC`,
      [decoded.uid],
    );

    const now = Date.now();
    const warningWindow = 15 * 60 * 1000; // 15 minutes
    const rows = (result?.rows ?? []).map((r: any) => {
      let derivedStatus = r.status;
      if ((r.status === 'active' || r.status === 'inactive') && !r.isPermanent && r.expiresAt) {
        const expiresAt = new Date(r.expiresAt).getTime();
        if (expiresAt <= now) {
          derivedStatus = 'expired';
        } else if (expiresAt <= now + warningWindow) {
          derivedStatus = 'expiring';
        }
      }
      const currentPasscode = r.owner_passcode ? decryptPasscodeForOwner(r.owner_passcode) : null;
      return {
        ...r,
        owner_passcode: undefined,
        currentPasscode,
        status: derivedStatus,
      };
    });

    res.json(rows);
  } catch (err: any) {
    console.error("Error in /listRooms:", err);
    res.status(500).json({ error: err?.message || "Failed to list rooms" });
  }
});

app.get("/roomDetails", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.query?.uid),
    String(req.query?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }

  const roomId = req.query.roomId;
  if (!roomId) {
    res.status(400).json({ error: "missing roomId" });
    return;
  }

  try {
    const roomResult = await postgres?.query(
      `SELECT "roomId", (passcode IS NOT NULL AND passcode <> '') AS "isPasscodeProtected",
              "creationTime", "roomTitle", "roomDescription", "coverPhoto", "isChatDisabled", "isSubRoom",
              status, "startedAt", "expiresAt", "endedAt", "isPermanent", owner_passcode
       FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
      [roomId, decoded.uid],
    );

    if (!roomResult || roomResult.rows.length === 0) {
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }

    const room = roomResult.rows[0];

    const now = Date.now();
    const warningWindow = 15 * 60 * 1000; // 15 minutes
    let derivedStatus = room.status;
    if ((room.status === 'active' || room.status === 'inactive') && !room.isPermanent && room.expiresAt) {
      const expiresAt = new Date(room.expiresAt).getTime();
      if (expiresAt <= now) {
        derivedStatus = 'expired';
      } else if (expiresAt <= now + warningWindow) {
        derivedStatus = 'expiring';
      }
    }
    room.status = derivedStatus;

    const currentPasscode = room.owner_passcode ? decryptPasscodeForOwner(room.owner_passcode) : null;

    // Fetch lifecycle events
    const lifecycleResult = await postgres?.query(
      `SELECT id, actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp
       FROM room_lifecycle_events WHERE "roomId" = $1
       ORDER BY timestamp DESC`,
      [roomId]
    );

    // Fetch chat summary
    const chatSummaryResult = await postgres?.query(
      `SELECT count(id)::int as "messagesCount", max(created_at) as "lastMessageAt"
       FROM room_messages WHERE room_id = $1`,
      [roomId]
    );
    const chatSummary = chatSummaryResult?.rows[0] || { messagesCount: 0, lastMessageAt: null };

    res.json({
      ...room,
      owner_passcode: undefined,
      currentPasscode,
      lifecycleEvents: lifecycleResult?.rows ?? [],
      chatSummary: {
        messagesCount: chatSummary.messagesCount || 0,
        lastMessageAt: chatSummary.lastMessageAt || null
      }
    });

  } catch (error) {
    console.error("Error fetching room details:", error);
    res.status(500).json({ error: "internal server error" });
  }
});

app.post("/extendRoom", async (req, res) => {
  const decoded = await validateUserToken(
    String(req.body?.uid),
    String(req.body?.token),
  );
  if (decoded === "EMAIL_NOT_VERIFIED") {
    res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
    return;
  }
  if (!decoded) {
    res.status(400).json({ error: "invalid user token" });
    return;
  }
  const roomId = req.body?.roomId;
  const durationSeconds = Number(req.body?.durationSeconds);
  if (!roomId || !durationSeconds) {
    res.status(400).json({ error: "missing parameters" });
    return;
  }

  // max duration 3 hours = 10800s
  if (durationSeconds > 10800 || durationSeconds < 0) {
    res.status(400).json({ error: "invalid duration" });
    return;
  }

  try {
    const selectResult = await postgres?.query(
      `SELECT "startedAt", "expiresAt", "status" FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
      [roomId, decoded.uid]
    );

    if (!selectResult || selectResult.rows.length === 0) {
      res.status(400).json({ error: "Room not found or unowned" });
      return;
    }

    const roomRow = selectResult.rows[0];
    if (roomRow.status !== "active" && roomRow.status !== "scheduled" && roomRow.status !== "inactive") {
      res.status(400).json({ error: "Room cannot be extended in its current state" });
      return;
    }

    const startedAt = new Date(roomRow.startedAt || Date.now()).getTime();
    const proposedExpiresAt = Date.now() + durationSeconds * 1000;
    const maxExpiresAt = startedAt + 3 * 60 * 60 * 1000; // 3 hours max active duration

    if (proposedExpiresAt > maxExpiresAt) {
      res.status(400).json({
        error: {
          code: "ROOM_MAX_DURATION_EXCEEDED",
          message: "This room cannot be extended beyond its maximum duration.",
        },
      });
      return;
    }

    const updateResult = await postgres?.query(
      `UPDATE rooms 
       SET "expiresAt" = $1 
       WHERE "roomId" = $2 AND owner_id = $3 AND status IN ('active', 'scheduled', 'inactive')
       RETURNING "expiresAt"`,
      [new Date(proposedExpiresAt), roomId, decoded.uid],
    );

    if (updateResult && updateResult.rowCount && updateResult.rowCount > 0) {
      const newExpiresAt = updateResult.rows[0].expiresAt;

      // Insert audit log
      await postgres?.query(`
        INSERT INTO room_lifecycle_events 
        ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [roomId, decoded.uid, 'room.extended', roomRow.status, roomRow.status, roomRow.expiresAt, newExpiresAt, 'user extended']);

      const memoryRoom = rooms.get(roomId);
      if (memoryRoom) {
        memoryRoom.expiresAt = new Date(newExpiresAt);
      }
      res.json({ expiresAt: newExpiresAt });
    } else {
      res.status(400).json({ error: "Room not found, unowned, or cannot be extended" });
    }
  } catch (e) {
    console.error("Error extending room:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/deleteRoom", async (req, res) => {
  try {
    const decoded = await validateUserToken(
      String(req.query?.uid),
      String(req.query?.token),
    );
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(400).json({ error: "invalid user token" });
      return;
    }
    if (!postgres) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
    if (!roomId) {
      res.status(400).json({ error: "missing roomId" });
      return;
    }

    const result = await postgres.query(
      `DELETE FROM rooms WHERE owner_id = $1 AND "roomId" = $2 RETURNING "roomId"`,
      [decoded.uid, roomId],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }

    // Prevent an active room from being persisted again after its row is deleted.
    const memoryRoom = rooms.get(roomId);
    if (memoryRoom) {
      memoryRoom.disconnectAllSockets();
      rooms.delete(roomId);
      io._nsps.delete(roomId);
      memoryRoom.destroy();
      await memoryRoom.stopVBrowserInternal();
    }

    res.status(204).end();
  } catch (error) {
    console.error("Error deleting room:", error);
    res.status(500).json({ error: "Failed to delete room" });
  }
});


app.get("/generateName", async (req, res) => {
  res.send(makeUserName());
});

// Proxy video segments
app.get("/proxy/*splat", async (req, res) => {
  redisCount("proxyReqs");
  try {
    const parsed = new URL("http://localhost" + req.url);
    const pathname = parsed.pathname.slice("/proxy".length);
    const host = parsed.searchParams.get("host");
    if (pathname.endsWith("index-dvr.m3u8")) {
      // VOD
      // https://d2vjef5jvl6bfs.cloudfront.net/3012391a6c3e84c79ef6_gamesdonequick_41198403369_1681059003/chunked/index-dvr.m3u8
      const resp = await axios.get("https://" + host + pathname);
      const re2 = /(.*.ts)/g;
      let repl = resp.data.replaceAll(re2, `$1?host=${host}`);
      // Mark this as a VOD
      repl += "#EXT-X-ENDLIST";
      res.send(repl);
    } else if (pathname.endsWith(".m3u8")) {
      // Stream
      // https://video-weaver.sea02.hls.ttvnw.net/v1/playlist/CrQEgv7Mz6nnsfJH3XtVQxeYXk8mViy1zNGWglcybvxZsI1rv3iLnjAnnqwCiVXCJ-DdD27J6RuFrLy7YUYwHUCKazIKICIupUCn9UXtaBYhBM5JIYqg9dz6NWYrCWU9HZJj2TGROv9mAOKuTR51YS82hdYL4PFZa3xxWXhgDsxXQHNDB03kY6S0aG0-EVva1xYrn5Ge6IAXRwug9QDGlb-ydtF3BtYppoTklVI7CVLySPPwbbt5Ow1JXdnKhLSwQEs4bh3BLwMnRBwUFI5nmE18BLYbkMOUivgYP5SSMgnGGlSkJO-iJNPWvepunEgyBUzB_7L-b1keTcV-Qak9IcWIITIWbRvmg6qB3ZSuWdcJgWKmdXdIn4qoRM4o16G1_0N_WRqPtMQFo0hmTlAVmHrzRArJQmaSgqAxZxRbFMd9RFeX6qjP9NtwguPbSeStdVbQxMNC34iavYUIxo8Ug812BHsG7J_kIlof2zkIqkEbP3oV3UkSByIo7xh9EEVargjaGDuQRt8zPQ6-fNBWJJe9F6IFu7lXBPIJ016lopyfcvTWjbLbBHsVkg6vG-3UISh0nud7KB5g5ipQePhtcFSI5hvjlfX1DAVHEpTWXkvlnL4wNqEqpBYL2btSXYeE1Cb-RAvrAT0s61usERcL2eI-S5aTcSO8_hxQ2afC7c9vlypOWgP6p6XNpViZHXmdXv4t-d68Z-MpLtSU7VbB3pRWnSswFFyA3W39ITic4lb97Djp3wHhGgz0Sy8aDb9r0tnphIYgASoJdXMtZWFzdC0yMKQG.m3u8
      // Extract the edge URL host and add it to URL so proxy can fetch
      const resp = await axios.get("https://" + host + pathname);
      // const re = /https:\/\/(.*)\/v1\/segment\/(.*)/g;
      // const match = re.exec(resp.data);
      // const edgehost = match?.[1];
      // const repl = resp.data.replaceAll(
      //   re,
      //   `/proxy/v1/segment/$2?host=${edgehost}`,
      // );
      const repl = resp.data;
      res.send(repl);
    } else if (pathname.endsWith(".ts")) {
      // Segment
      const resp = await axios.get("https://" + host + pathname, {
        responseType: "arraybuffer",
      });
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": resp.data.length,
        "Transfer-Encoding": "chunked",
      });
      res.write(resp.data);
      res.end();
    } else {
      res.status(404);
      res.end();
    }
  } catch (e) {
    // console.log(e);
    console.log("proxy failed: %s", req.url);
  }
});

async function saveRooms() {
  // Unload rooms that are empty and idle
  // Frees up some JS memory space when process is long-running
  // On reconnect, we'll attempt to reload the room
  let saveCount = 0;
  let skipCount = 0;
  const start = Date.now();
  await Promise.all(
    Array.from(rooms.entries()).map(async ([key, room]) => {
      if (
        room.roster.length === 0 &&
        !room.vBrowser &&
        Number(room.lastUpdateTime) < Date.now() - 8 * 60 * 60 * 1000
      ) {
        console.log(
          "freeing room %s from memory on shard %s",
          key,
          config.SHARD,
        );
        await room.saveRoom();
        room.destroy();
        rooms.delete(key);
        saveCount += 1;
        // Unregister the namespace to avoid dupes on reload
        io._nsps.delete(key);
      } else if (room.roster.length) {
        room.lastUpdateTime = new Date();
        await room.saveRoom();
        saveCount += 1;
      } else {
        skipCount += 1;
      }
    }),
  );
  const end = Date.now();
  console.log(
    "[SAVEROOMS] %s saved in %sms, %s skipped",
    saveCount,
    end - start,
    skipCount,
  );
}

async function expireRooms() {
  if (!postgres) return;
  try {
    const result = await postgres.query(`
      UPDATE rooms
      SET status = 'expired', "endedAt" = NOW()
      WHERE status IN ('active', 'inactive') AND "expiresAt" <= NOW() AND "isPermanent" = false
      RETURNING "roomId", "expiresAt" as "previousExpiresAt", "endedAt" as "timestamp"
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[EXPIRE] Expired ${result.rowCount} rooms`);
      for (const row of result.rows) {
        const room = rooms.get(row.roomId);
        if (room) {
          room.status = 'expired';
          room.addChatMessage(null, {
            id: '',
            system: true,
            msg: 'This room has expired.',
          });

          if (room.vBrowser) {
            room.stopVBrowserInternal();
          }

          room.disconnectAllSockets();
        }

        // Insert audit log
        await postgres.query(`
          INSERT INTO room_lifecycle_events 
          ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          row.roomId,
          'system',
          'room.expired',
          'active_or_inactive',
          'expired',
          row.previousExpiresAt,
          row.previousExpiresAt, // For expiry, new is same as previous since we don't extend
          'time limit reached',
          row.timestamp
        ]).catch(e => console.error("Failed to insert audit log for expiration:", e));
      }
    }
  } catch (e) {
    console.error("Error expiring rooms:", e);
  }
}

async function release() {
  // Reset VMs in rooms that are:
  // older than the session limit
  // assigned to a room with no users
  const roomArr = Array.from(rooms.values());
  console.log("[RELEASE] %s rooms in batch", roomArr.length);
  for (let room of roomArr) {
    if (room.vBrowser && room.vBrowser.assignTime) {
      const maxTime = getSessionLimitSeconds(room.vBrowser.large) * 1000;
      const elapsed = Date.now() - room.vBrowser.assignTime;
      const ttl = maxTime - elapsed;
      const isTimedOut = ttl && ttl < releaseInterval;
      const isAlmostTimedOut = ttl && ttl < releaseInterval * 2;
      const isRoomEmpty = room.roster.length === 0;
      const isRoomIdle =
        Date.now() - Number(room.lastUpdateTime) > 5 * 60 * 1000;
      if (isTimedOut || (isRoomEmpty && isRoomIdle)) {
        console.log("[RELEASE] VM in room:", room.roomId);
        room.stopVBrowserInternal();
        if (isTimedOut) {
          room.addChatMessage(null, {
            id: "",
            system: true,
            cmd: "vBrowserTimeout",
            msg: "",
          });
          redisCount("vBrowserTerminateTimeout");
        } else if (isRoomEmpty) {
          redisCount("vBrowserTerminateEmpty");
        }
      } else if (isAlmostTimedOut) {
        room.addChatMessage(null, {
          id: "",
          system: true,
          cmd: "vBrowserAlmostTimeout",
          msg: "",
        });
      }
    }
    // We want to spread out the jobs over about half the release interval
    // This gives other jobs some CPU time
    const waitTime = releaseInterval / 2 / roomArr.length;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}

async function minuteMetrics() {
  const roomArr = Array.from(rooms.values());
  let vbWaiting = 0;
  for (let room of roomArr) {
    if (room.vBrowser && room.vBrowser.id) {
      // Update the heartbeat
      await postgres?.query(
        `UPDATE vbrowser SET "heartbeatTime" = NOW() WHERE "roomId" = $1 and vmid = $2`,
        [room.roomId, room.vBrowser.id],
      );

      const expireTime = getStartOfDay() / 1000 + 86400;
      if (room.vBrowser?.creatorClientID) {
        await redis?.zincrby(
          "vBrowserClientIDMinutes",
          1,
          room.vBrowser.creatorClientID,
        );
        await redis?.expireat("vBrowserClientIDMinutes", expireTime);
      }
      if (room.vBrowser?.creatorUID) {
        await redis?.zincrby(
          "vBrowserUIDMinutes",
          1,
          room.vBrowser?.creatorUID,
        );
        await redis?.expireat("vBrowserUIDMinutes", expireTime);
      }
    }
    const users = room.roster.length;
    if (users) {
      await redis?.setex(`roomCounts:${room.roomId}`, 120, users);
      await redis?.setex(
        `roomRosters:${room.roomId}`,
        120,
        JSON.stringify(room.getRosterForStats()),
      );
    }
    vbWaiting += room.vBrowserQueue ? 1 : 0;
  }
  // Report shard metrics
  const obj: ShardMetric = {
    uptime: process.uptime(),
    mem: process.memoryUsage().rss,
    roomCount: rooms.size,
    users: io.engine.clientsCount,
    vbWaiting,
  };
  await redis?.setex(
    `shardMetrics:${config.SHARD ?? 0}`,
    120,
    JSON.stringify(obj),
  );
}

function computeOpenSubtitlesHash(first: Buffer, last: Buffer, size: number) {
  // console.log(first.length, last.length, size);
  let temp = BigInt(size);
  process(first);
  process(last);

  temp = temp & BigInt("0xffffffffffffffff");
  return temp.toString(16).padStart(16, "0");

  function process(chunk: Buffer) {
    for (let i = 0; i < chunk.length; i += 8) {
      const long = chunk.readBigUInt64LE(i);
      temp += long;
    }
  }
}
