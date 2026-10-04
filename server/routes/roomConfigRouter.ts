import express, { type Request, type Response, Router } from "express";
import type { Server } from "socket.io";
import type { Pool } from "pg";
import config from "../config.ts";
import { Room } from "../room.ts";
import { redisCount as defaultRedisCount } from "../utils/redis.ts";
import { validateUserToken as defaultValidateUserToken } from "../utils/supabase.ts";
import { sanitizeRoomId as defaultSanitizeRoomId } from "../strip_slashes.ts";
import { makeRoomName as defaultMakeRoomName } from "../utils/moniker.ts";
import {
  hashRoomPasscode as defaultHashRoomPasscode,
  encryptPasscodeForOwner as defaultEncryptPasscodeForOwner,
  computePasscodeFingerprint as defaultComputePasscodeFingerprint,
} from "../utils/roomPasscode.ts";

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export interface RoomEntitlementResponse {
  planId: string;
  planDisplayName: string;
  enabled: boolean;
  maxTotalRooms: number;
  maxWatchRooms: number;
  maxPermanentRooms: number;
  maxParticipantCapacity: number;
  maxRoomDurationHours: number;
  hasOverrides: boolean;
  usageTotalRooms: number;
  usageWatchRooms: number;
  usagePermanentRooms: number;
}

export interface RoomConfigRouterOptions {
  rooms: Map<string, Room>;
  io: Server;
  postgres: Pool | null | undefined;
  configOverride?: Partial<typeof config>;
  redisCountFn?: (prefix: string) => Promise<void> | void;
  validateUserTokenFn?: typeof defaultValidateUserToken;
  extractBearerTokenFn?: (req: Request) => string | undefined;
  sanitizeRoomIdFn?: (rawRoomId: string) => string;
  makeRoomNameFn?: typeof defaultMakeRoomName;
  hashRoomPasscodeFn?: typeof defaultHashRoomPasscode;
  encryptPasscodeForOwnerFn?: typeof defaultEncryptPasscodeForOwner;
  computePasscodeFingerprintFn?: typeof defaultComputePasscodeFingerprint;
}

export function createRoomConfigRouter(options: RoomConfigRouterOptions): Router {
  const router = express.Router();
  const rooms = options.rooms;
  const io = options.io;
  const postgres = options.postgres ?? null;
  const cfg = options.configOverride ? { ...config, ...options.configOverride } : config;

  const redisCount = options.redisCountFn ?? defaultRedisCount;
  const validateUserToken = options.validateUserTokenFn ?? defaultValidateUserToken;
  const extractBearer = options.extractBearerTokenFn ?? extractBearerToken;
  const sanitizeRoomId = options.sanitizeRoomIdFn ?? defaultSanitizeRoomId;
  const makeRoomName = options.makeRoomNameFn ?? defaultMakeRoomName;
  const hashRoomPasscode = options.hashRoomPasscodeFn ?? defaultHashRoomPasscode;
  const encryptPasscodeForOwner = options.encryptPasscodeForOwnerFn ?? defaultEncryptPasscodeForOwner;
  const computePasscodeFingerprint = options.computePasscodeFingerprintFn ?? defaultComputePasscodeFingerprint;

  // ============================================================================
  // GET ROOM ENTITLEMENTS ENDPOINT
  // ============================================================================
  router.get("/roomEntitlements", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const decoded = await validateUserToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(401).json({ error: "Invalid authentication token." });
      return;
    }

    if (!postgres) {
      res.status(503).json({ error: "Database unavailable." });
      return;
    }

    try {
      const result = await postgres.query(
        `SELECT
           e.plan_id            AS "planId",
           e.plan_display_name  AS "planDisplayName",
           e.enabled,
           e.max_total_rooms    AS "maxTotalRooms",
           e.max_watch_rooms    AS "maxWatchRooms",
           e.max_permanent_rooms AS "maxPermanentRooms",
           e.max_participant_capacity AS "maxParticipantCapacity",
           e.max_room_duration_hours  AS "maxRoomDurationHours",
           e.has_overrides      AS "hasOverrides",
           COALESCE(u.total_rooms,     0) AS "usageTotalRooms",
           COALESCE(u.watch_rooms,     0) AS "usageWatchRooms",
           COALESCE(u.permanent_rooms, 0) AS "usagePermanentRooms"
         FROM public.resolve_account_entitlement($1) e
         LEFT JOIN public.account_room_usage u ON u.account_id = $1`,
        [decoded.uid]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          error: { code: "ACCOUNT_ENTITLEMENT_NOT_FOUND", message: "No subscription plan found for this account." },
        });
        return;
      }

      const row = result.rows[0];
      const response: RoomEntitlementResponse = {
        planId: String(row.planId ?? ""),
        planDisplayName: String(row.planDisplayName ?? ""),
        enabled: Boolean(row.enabled),
        maxTotalRooms: Number(row.maxTotalRooms),
        maxWatchRooms: Number(row.maxWatchRooms),
        maxPermanentRooms: Number(row.maxPermanentRooms),
        maxParticipantCapacity: Number(row.maxParticipantCapacity),
        maxRoomDurationHours: Number(row.maxRoomDurationHours),
        hasOverrides: Boolean(row.hasOverrides),
        usageTotalRooms: Number(row.usageTotalRooms),
        usageWatchRooms: Number(row.usageWatchRooms),
        usagePermanentRooms: Number(row.usagePermanentRooms),
      };
      res.json(response);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("ACCOUNT_ENTITLEMENT_NOT_FOUND")) {
        res.status(404).json({
          error: { code: "ACCOUNT_ENTITLEMENT_NOT_FOUND", message: "No subscription plan found for this account." },
        });
        return;
      }
      console.error("GET /roomEntitlements error:", err);
      res.status(500).json({ error: "Failed to load entitlement data." });
    }
  });

  // ============================================================================
  // CHECK PASSCODE AVAILABILITY ENDPOINT
  // ============================================================================
  router.post("/checkPasscodeAvailability", async (req: Request, res: Response) => {
    const passcode = req.body?.passcode;
    if (typeof passcode !== "string" || passcode.length !== 8) {
      res.status(400).json({
        available: false,
        error: "Passcode must be strictly 8 characters long.",
      });
      return;
    }

    if (!postgres) {
      res.json({ available: true });
      return;
    }

    try {
      const fingerprint = computePasscodeFingerprint(passcode);
      const existing = await postgres.query(
        `SELECT "roomId" FROM rooms WHERE passcode_fingerprint = $1 LIMIT 1`,
        [fingerprint]
      );
      res.json({ available: existing.rows.length === 0 });
    } catch (err: any) {
      console.error("checkPasscodeAvailability error:", err);
      res.status(500).json({ error: "Failed to verify passcode availability." });
    }
  });

  // ============================================================================
  // CREATE ROOM ENDPOINT
  // ============================================================================
  router.post("/createRoom", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: "Authentication is required to create a room." });
      return;
    }
    const decoded = await validateUserToken("", token);
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

    const rawPasscode = req.body?.passcode;
    if (typeof rawPasscode !== "string" || rawPasscode.length !== 8) {
      res.status(400).json({
        error: "Passcode is required and must be strictly 8 characters long.",
      });
      return;
    }

    if (!postgres) {
      res.status(503).json({ error: "Database unavailable." });
      return;
    }
    const entRow = await postgres.query(
      `SELECT max_participant_capacity, max_room_duration_hours
       FROM public.resolve_account_entitlement($1)`,
      [decoded.uid]
    );
    if (entRow.rows.length === 0) {
      res.status(403).json({
        error: {
          code: "ACCOUNT_ENTITLEMENT_NOT_FOUND",
          message: "No active subscription plan found for this account.",
        },
      });
      return;
    }
    const planCapacityCeiling = Number(entRow.rows[0].max_participant_capacity);
    const planDurationCeiling = Number(entRow.rows[0].max_room_duration_hours);
    if (!Number.isFinite(planCapacityCeiling) || !Number.isFinite(planDurationCeiling)) {
      console.error("createRoom: malformed entitlement row for uid:", decoded.uid, entRow.rows[0]);
      res.status(503).json({ error: "Malformed entitlement data." });
      return;
    }

    let maxParticipants = planCapacityCeiling;
    if (req.body?.maxParticipants !== undefined && req.body?.maxParticipants !== null) {
      const parsedCapacity = Number(req.body.maxParticipants);
      if (!Number.isInteger(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > planCapacityCeiling) {
        res.status(400).json({
          error: `Participant capacity must be an integer between 2 and ${planCapacityCeiling}.`,
        });
        return;
      }
      maxParticipants = parsedCapacity;
    }

    const passcodeFingerprint = computePasscodeFingerprint(rawPasscode);

    if (postgres) {
      const duplicateCheck = await postgres.query(
        `SELECT "roomId" FROM rooms WHERE passcode_fingerprint = $1 LIMIT 1`,
        [passcodeFingerprint]
      );
      if (duplicateCheck.rows.length > 0) {
        res.status(409).json({
          error: "This passcode is already taken. Each room passcode must be unique.",
        });
        return;
      }
    }

    const genName = () => makeRoomName(cfg.SHARD);
    let name = sanitizeRoomId(genName());
    console.log("createRoom: ", name, "by user:", decoded.email);

    const isPermanent = Boolean(req.body?.isPermanent);
    const roomKind = isPermanent ? "permanent" : "watch";
    const now = new Date();
    let requestedDurationHours = Math.min(3, planDurationCeiling);
    if (typeof req.body?.durationHours === "number" && req.body.durationHours > 0) {
      requestedDurationHours = Math.min(Math.max(1, Math.floor(req.body.durationHours)), planDurationCeiling);
    } else if (typeof req.body?.sessionTimeHours === "number" && req.body.sessionTimeHours > 0) {
      requestedDurationHours = Math.min(Math.max(1, Math.floor(req.body.sessionTimeHours)), planDurationCeiling);
    }
    const expiresAt = isPermanent ? null : new Date(now.getTime() + requestedDurationHours * 60 * 60 * 1000);

    if (postgres) {
      try {
        const passcodeHash = await hashRoomPasscode(rawPasscode);
        const ownerPasscodeEncrypted = encryptPasscodeForOwner(rawPasscode);

        await postgres.query(
          `SELECT public.create_room_authoritative(
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
          ) AS result`,
          [
            decoded.uid,
            name,
            roomKind,
            roomTitle,
            req.body?.roomDescription || null,
            passcodeHash,
            ownerPasscodeEncrypted,
            passcodeFingerprint,
            typeof req.body?.coverPhoto === "string" ? req.body.coverPhoto : null,
            Boolean(req.body?.isChatDisabled),
            expiresAt,
            maxParticipants,
          ]
        );
      } catch (e: any) {
        redisCount("createRoomError");
        const errMsg = e?.message || "";
        if (errMsg.includes("INVALID_PARTICIPANT_CAPACITY")) {
          res.status(400).json({
            error: "Participant capacity must be an integer between 2 and 100.",
          });
          return;
        }
        if (errMsg.includes("ROOM_DURATION_EXCEEDS_PLAN_LIMIT")) {
          res.status(400).json({
            error: "Requested room duration exceeds the maximum duration permitted by your subscription plan.",
          });
          return;
        }
        if (errMsg.includes("ACCOUNT_ENTITLEMENT_NOT_FOUND")) {
          res.status(403).json({
            error: "No active subscription plan or entitlement found for this account.",
          });
          return;
        }
        if (errMsg.includes("TOTAL_ROOM_LIMIT_EXCEEDED")) {
          res.status(409).json({
            error: {
              code: "TOTAL_ROOM_LIMIT_EXCEEDED",
              message: "You have reached your room limit. Delete an existing room to create a new one.",
            },
          });
          return;
        }
        if (errMsg.includes("PERMANENT_ROOM_LIMIT_EXCEEDED")) {
          res.status(409).json({
            error: {
              code: "PERMANENT_ROOM_LIMIT_EXCEEDED",
              message: "You have reached your permanent room limit.",
            },
          });
          return;
        }
        if (errMsg.includes("WATCH_ROOM_LIMIT_EXCEEDED")) {
          res.status(409).json({
            error: {
              code: "WATCH_ROOM_LIMIT_EXCEEDED",
              message: "You have reached your temporary room limit.",
            },
          });
          return;
        }
        if (errMsg.includes("ACCOUNT_ROOMS_DISABLED")) {
          res.status(403).json({
            error: {
              code: "ACCOUNT_ROOMS_DISABLED",
              message: "Room creation is disabled for this account.",
            },
          });
          return;
        }
        if (e?.code === "23505" && e?.constraint === "rooms_passcode_fingerprint_key") {
          res.status(409).json({
            error: "This passcode is already taken. Each room passcode must be unique.",
          });
          return;
        }
        throw e;
      }
    }

    // Authoritative in-memory registration ONLY after DB commit succeeds
    const newRoom = new Room(io, name);
    if (req.body?.lock) {
      newRoom.lock = decoded.uid;
    }
    newRoom.isChatDisabled = Boolean(req.body?.isChatDisabled);
    newRoom.creator = decoded.email || "";
    newRoom.expiresAt = expiresAt ?? undefined;
    newRoom.status = 'inactive';
    newRoom.owner_id = decoded.uid;
    newRoom.isPermanent = isPermanent;
    newRoom.maxParticipants = maxParticipants;

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

  // ============================================================================
  // UPDATE ROOM COVER ENDPOINT
  // ============================================================================
  router.post("/updateRoomCover", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: { code: "FORBIDDEN", message: "Authentication required" } });
      return;
    }
    const decoded = await validateUserToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
      return;
    }

    const rawRoomId = req.body?.roomId;
    const coverPhoto = req.body?.coverPhoto;

    if (!rawRoomId || coverPhoto === undefined) {
      res.status(400).json({ error: { code: "FORBIDDEN", message: "Missing parameters" } });
      return;
    }

    if (!postgres) {
      res.status(500).json({ error: { code: "FORBIDDEN", message: "Database not configured" } });
      return;
    }

    const cleanRoomId = sanitizeRoomId(rawRoomId);
    const memRoom = rooms.get(cleanRoomId);
    const isMemActive = Boolean(memRoom && (memRoom.status === 'active' || (memRoom.roster && memRoom.roster.length > 0)));

    const roomCheck = await postgres.query(
      `SELECT status, "expiresAt", "isPermanent" FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
      [cleanRoomId, decoded.uid]
    );

    if (roomCheck.rowCount === 0) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
      return;
    }

    const roomRow = roomCheck.rows[0];
    const now = Date.now();
    const isExpired = !roomRow.isPermanent && roomRow.expiresAt && new Date(roomRow.expiresAt).getTime() <= now;
    const isDbActive = roomRow.status === 'active' && !isExpired;

    if (isDbActive || isMemActive) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Cannot change room cover while the room is active. Please end the watch session or wait until all participants leave.",
        },
      });
      return;
    }

    const result = await postgres.query(
      `SELECT public.update_room_metadata_authoritative(
        $1::uuid, $2::text, NULL, NULL, NULL, $3::text, NULL, NULL, NULL, false
      ) AS result`,
      [decoded.uid, cleanRoomId, coverPhoto]
    );
    if (result.rowCount === 0) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
      return;
    }
    res.json({ success: true });
  });

  // ============================================================================
  // UPDATE ROOM SETTINGS ENDPOINT
  // ============================================================================
  router.post("/updateRoomSettings", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const decoded = await validateUserToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
      return;
    }

    const { roomId: rawRoomId, roomTitle, roomDescription, isPermanent, isChatDisabled, password, removePassword } = req.body;

    if (!rawRoomId || typeof roomTitle !== 'string' || typeof isPermanent !== 'boolean' || typeof isChatDisabled !== 'boolean') {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const roomId = sanitizeRoomId(rawRoomId);

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
    let passcodeFingerprint: string | null = null;
    const isClearingPassword = removePassword === true || password === "";

    if (!isClearingPassword && typeof password === 'string' && password.length > 0) {
      if (password.length !== 8) {
        res.status(400).json({ error: "Passcode must be strictly 8 characters long." });
        return;
      }
      if (Buffer.byteLength(password, 'utf8') > 72) {
        res.status(400).json({ error: "Password too long" });
        return;
      }
      passcodeFingerprint = computePasscodeFingerprint(password);
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

      const existingRoom = await client.query(
        `SELECT status, "expiresAt", "isSubRoom", "isPermanent" FROM rooms WHERE "roomId" = $1 AND owner_id = $2 FOR UPDATE`,
        [roomId, decoded.uid]
      );

      if (existingRoom.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
        return;
      }

      const room = existingRoom.rows[0];

      if (passcodeFingerprint) {
        const duplicateCheck = await client.query(
          `SELECT "roomId" FROM rooms WHERE passcode_fingerprint = $1 AND "roomId" != $2 LIMIT 1`,
          [passcodeFingerprint, roomId]
        );
        if (duplicateCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          res.status(409).json({ error: "This passcode is already taken by another room. Each room passcode must be unique." });
          return;
        }
      }

      const cleanRoomId = roomId;
      const memRoom = rooms.get(cleanRoomId);
      const isMemActive = Boolean(memRoom && (memRoom.status === 'active' || (memRoom.roster && memRoom.roster.length > 0)));
      const now = Date.now();
      const isExpired = !room.isPermanent && room.expiresAt && new Date(room.expiresAt).getTime() <= now;
      const isDbActive = room.status === 'active' && !isExpired;

      if (isDbActive || isMemActive) {
        await client.query('ROLLBACK');
        res.status(403).json({
          error: "Cannot change room details while the room is active. Please end the watch session or wait until all participants leave.",
        });
        return;
      }

      const currentlyPermanent = Boolean(room.isPermanent);
      const permanenceChanged = isPermanent !== currentlyPermanent;

      if (permanenceChanged) {
        await client.query(
          `SELECT public.set_room_permanence_authoritative($1, $2, $3) AS result`,
          [decoded.uid, roomId, isPermanent]
        );
      }

      await client.query(
        `SELECT public.update_room_metadata_authoritative(
          $1::uuid, $2::text, $3::text, $4::text, $5::boolean, NULL, $6::text, $7::text, $8::text, $9::boolean
        )`,
        [
          decoded.uid,
          roomId,
          titleTrimmed,
          roomDescription || null,
          isChatDisabled,
          isClearingPassword ? null : passcodeHash,
          isClearingPassword ? null : ownerPasscodeEncrypted,
          isClearingPassword ? null : passcodeFingerprint,
          isClearingPassword,
        ]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch { }
      console.error("updateRoomSettings error:", err);
      if (err?.code === "23505" && err?.constraint === "rooms_passcode_fingerprint_key") {
        res.status(409).json({ error: "This passcode is already taken by another room. Each room passcode must be unique." });
        return;
      }
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}
