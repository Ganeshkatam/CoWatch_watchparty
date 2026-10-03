import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import pg from "pg";
import { Room } from "../room.js";
import { validateUserToken } from "../utils/supabase.js";
import { sanitizeRoomId } from "../strip_slashes.js";
import {
  checkPasscodeRateLimits,
  recordPasscodeFailure,
  resetPasscodeLimits,
} from "../utils/rateLimit.js";
import { isTerminalRoom } from "../lifecycle/types.js";
import { isBcryptHash, verifyRoomPasscode } from "../utils/roomPasscode.js";
import { issueRoomAdmissionToken } from "../utils/admissionToken.js";

function defaultExtractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return undefined;
}

export interface RoomAdmissionRouterOptions {
  rooms: Map<string, Room>;
  postgres: pg.Pool | null | undefined;
  getOrCreateRoom: (roomId: string) => Promise<Room | null>;
  // Test injection hooks
  validateUserTokenFn?: (project: string, token: string) => Promise<any>;
  extractBearerTokenFn?: (req: Request) => string | undefined;
  sanitizeRoomIdFn?: (raw: string) => string;
  checkPasscodeRateLimitsFn?: (targets: any) => Promise<any>;
  recordPasscodeFailureFn?: typeof recordPasscodeFailure;
  resetPasscodeLimitsFn?: typeof resetPasscodeLimits;
  isTerminalRoomFn?: typeof isTerminalRoom;
  verifyRoomPasscodeFn?: typeof verifyRoomPasscode;
  isBcryptHashFn?: typeof isBcryptHash;
  issueRoomAdmissionTokenFn?: typeof issueRoomAdmissionToken;
}

export function createRoomAdmissionRouter(options: RoomAdmissionRouterOptions): Router {
  const router = Router();
  const rooms = options.rooms;
  const postgres = options.postgres;
  const getOrCreateRoom = options.getOrCreateRoom;

  const validateToken = options.validateUserTokenFn || validateUserToken;
  const extractToken = options.extractBearerTokenFn || defaultExtractBearerToken;
  const sanitizeId = options.sanitizeRoomIdFn || sanitizeRoomId;
  const checkRateLimits = options.checkPasscodeRateLimitsFn || checkPasscodeRateLimits;
  const recordFailure = options.recordPasscodeFailureFn || recordPasscodeFailure;
  const resetLimits = options.resetPasscodeLimitsFn || resetPasscodeLimits;
  const isTerminal = options.isTerminalRoomFn || isTerminalRoom;
  const verifyPasscode = options.verifyRoomPasscodeFn || verifyRoomPasscode;
  const checkBcryptHash = options.isBcryptHashFn || isBcryptHash;
  const issueToken = options.issueRoomAdmissionTokenFn || issueRoomAdmissionToken;

  router.post("/verifyPasscode", async (req: Request, res: Response) => {
    const { roomId, passcode, sessionId } = req.body || {};
    if (!roomId || typeof roomId !== "string") {
      res.status(400).json({ valid: false, error: "Missing room identifier." });
      return;
    }

    const cleanRoomId = sanitizeId(roomId);

    // Extract client IP and user identity for rate limiting & token binding
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    // Authenticate caller strictly from Supabase token
    let callerUid: string | undefined;
    const token = extractToken(req);

    if (token) {
      try {
        const decoded = await validateToken("", token);
        if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
          callerUid = decoded.uid;
        }
      } catch { }
    }

    if (!callerUid) {
      res.status(401).json({
        valid: false,
        error: "Authentication required to enter room.",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    const cleanSessionId =
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.trim()
        : crypto.randomUUID();

    const rateLimitTarget = { ip, roomId: cleanRoomId, userId: callerUid };

    // Multi-dimensional rate limit check (IP, Room, User)
    const rateLimitStatus = await checkRateLimits(rateLimitTarget);
    if (!rateLimitStatus.allowed) {
      res.set("Retry-After", String(rateLimitStatus.retryAfterSeconds));
      res.status(429).json({
        valid: false,
        error: "Too many passcode attempts. Please wait a few minutes before trying again.",
        retryAfterSeconds: rateLimitStatus.retryAfterSeconds,
      });
      return;
    }

    try {
      const result = await postgres?.query(
        `SELECT passcode, status, owner_id, participants_locked, max_participants, "isPermanent", "expiresAt" FROM rooms WHERE "roomId" = $1`,
        [cleanRoomId]
      );

      // If room does not exist, return generic 401 failure to avoid enumeration attacks
      if (!result || result.rows.length === 0) {
        await recordFailure(rateLimitTarget);
        res.status(401).json({ valid: false, error: "Incorrect room passcode. Please try again." });
        return;
      }

      const row = result.rows[0];
      const roomPasscode = row.passcode;

      // Expired or ended rooms cannot be joined (evaluates dynamic expiresAt on temporary rooms)
      if (isTerminal(row)) {
        res.status(401).json({ valid: false, error: "This room has ended or expired." });
        return;
      }

      let isValid = false;
      if (roomPasscode) {
        const cleanPasscode = typeof passcode === "string" ? passcode.trim() : "";
        if (cleanPasscode.length !== 8) {
          res.status(400).json({ valid: false, error: "Passcode must be strictly 8 characters." });
          return;
        }
        if (checkBcryptHash(roomPasscode)) {
          isValid = await verifyPasscode(cleanPasscode, roomPasscode);
        } else {
          isValid = cleanPasscode === roomPasscode;
        }
      } else {
        // Room without passcode: authenticated admission authorized directly
        isValid = true;
      }

      if (!isValid) {
        await recordFailure(rateLimitTarget);
        res.status(401).json({ valid: false, error: "Incorrect room passcode. Please try again." });
        return;
      }

      // Resolve host authority for participant lock and capacity bypass
      const isOwner = Boolean(row.owner_id && callerUid === row.owner_id);
      let isHost = isOwner;
      const memoryRoom = rooms.get(cleanRoomId);
      if (memoryRoom && callerUid) {
        if (typeof (memoryRoom as any).isHostUid === "function") {
          isHost = isHost || (memoryRoom as any).isHostUid(callerUid);
        } else if ((memoryRoom as any).currentHostUid) {
          isHost = isHost || (memoryRoom as any).currentHostUid === callerUid;
        }
      }

      // Authoritative post-credential admission evaluation
      const admissionAuth = issueToken({
        roomId: cleanRoomId,
        callerUid,
        sessionId: cleanSessionId,
        roomRow: row,
        memoryRoom,
        isHost,
      });

      if (!admissionAuth.allowed) {
        res.status(admissionAuth.status).json({
          valid: false,
          error: admissionAuth.error,
          code: admissionAuth.code,
        });
        return;
      }

      if (postgres) {
        try {
          await postgres.query(
            `INSERT INTO public.room_admissions (room_id, user_id, admission_method, admitted_at, revoked_at, revoked_reason)
             VALUES ($1, $2::uuid, 'passcode', now(), NULL, NULL)
             ON CONFLICT (room_id, user_id) DO UPDATE
             SET admitted_at = now(), revoked_at = NULL, revoked_reason = NULL, admission_method = 'passcode'`,
            [cleanRoomId, callerUid]
          );
        } catch (admDbErr) {
          console.error("[Admission] Failed to record durable admission in DB:", admDbErr);
          res.status(500).json({ valid: false, error: "Database error recording room admission. Please try again.", code: "DATABASE_ERROR" });
          return;
        }
      }

      if (memoryRoom && callerUid) {
        memoryRoom.admittedMembers.add(callerUid);
      }

      // Success: reset rate limit attempts for this target and return token
      await resetLimits(rateLimitTarget);
      res.json({ valid: true, admissionToken: admissionAuth.admissionToken, sessionId: cleanSessionId });
    } catch (err) {
      console.error("Error verifying passcode:", err);
      res.status(500).json({ valid: false, error: "Server error verifying passcode." });
    }
  });

  router.post("/room-admission/restore", async (req: Request, res: Response) => {
    const { roomId } = req.body || {};
    if (!roomId || typeof roomId !== "string") {
      res.status(400).json({ valid: false, error: "Missing room identifier." });
      return;
    }

    const cleanRoomId = sanitizeId(roomId);

    const token = extractToken(req);

    let callerUid: string | undefined;
    if (token) {
      try {
        const decoded = await validateToken("", token);
        if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
          callerUid = decoded.uid;
        }
      } catch { }
    }

    if (!callerUid) {
      res.status(401).json({
        valid: false,
        error: "Authentication required to restore room admission.",
        code: "AUTH_REQUIRED",
      });
      return;
    }

    try {
      const roomResult = await postgres?.query(
        `SELECT passcode, status, owner_id, participants_locked, max_participants, "isPermanent", "expiresAt" FROM rooms WHERE "roomId" = $1`,
        [cleanRoomId]
      );

      if (!roomResult || roomResult.rows.length === 0) {
        res.status(404).json({ valid: false, error: "Room not found.", code: "ROOM_NOT_FOUND" });
        return;
      }

      const row = roomResult.rows[0];
      if (isTerminal(row)) {
        res.status(401).json({ valid: false, error: "This room has ended or expired.", code: "ROOM_TERMINAL" });
        return;
      }

      const isOwner = Boolean(row.owner_id && callerUid === row.owner_id);

      // 1. Check bans in database
      const banResult = await postgres?.query(
        `SELECT id FROM room_bans WHERE room_id = $1 AND user_id = $2::uuid LIMIT 1`,
        [cleanRoomId, callerUid]
      );
      if (banResult && banResult.rows.length > 0) {
        res.status(403).json({ valid: false, error: "You have been banned from this room.", code: "BANNED" });
        return;
      }

      // 2. Check live memory room ban state
      let memoryRoom = rooms.get(cleanRoomId);
      if (!memoryRoom) {
        memoryRoom = (await getOrCreateRoom(cleanRoomId)) || undefined;
      }
      if (memoryRoom && (memoryRoom as any).isBanned?.(undefined, callerUid)) {
        res.status(403).json({ valid: false, error: "You have been removed from this room.", code: "BANNED" });
        return;
      }

      // 3. Durable admission check (non-owners must have an active admission record)
      if (!isOwner) {
        const admResult = await postgres?.query(
          `SELECT admission_method, admitted_at, revoked_at FROM room_admissions WHERE room_id = $1 AND user_id = $2::uuid`,
          [cleanRoomId, callerUid]
        );
        if (!admResult || admResult.rows.length === 0 || admResult.rows[0].revoked_at) {
          res.status(401).json({
            valid: false,
            error: "No active room admission found.",
            code: "NO_ACTIVE_ADMISSION",
          });
          return;
        }
      }

      // 4. Resolve host authority
      let isHost = isOwner;
      if (memoryRoom && callerUid) {
        if (typeof (memoryRoom as any).isHostUid === "function") {
          isHost = isHost || (memoryRoom as any).isHostUid(callerUid);
        } else if ((memoryRoom as any).currentHostUid) {
          isHost = isHost || (memoryRoom as any).currentHostUid === callerUid;
        }
      }

      // 5. Generate fresh session ID for this new connection
      const freshSessionId = crypto.randomUUID();

      // 6. Use shared authoritative admission engine issueRoomAdmissionToken with isRestoration: true
      const admissionAuth = issueToken({
        roomId: cleanRoomId,
        callerUid,
        sessionId: freshSessionId,
        roomRow: row,
        memoryRoom,
        isHost,
        isRestoration: true,
      });

      if (!admissionAuth.allowed) {
        res.status(admissionAuth.status).json({
          valid: false,
          error: admissionAuth.error,
          code: admissionAuth.code,
        });
        return;
      }

      if (memoryRoom && callerUid) {
        memoryRoom.admittedMembers.add(callerUid);
      }

      res.json({
        valid: true,
        admissionToken: admissionAuth.admissionToken,
        sessionId: freshSessionId,
        restored: true,
      });
    } catch (err) {
      console.error("Error restoring room admission:", err);
      res.status(500).json({ valid: false, error: "Server error restoring admission." });
    }
  });

  return router;
}
