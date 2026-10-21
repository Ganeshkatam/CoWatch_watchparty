import express, { type Request, type Response, Router } from "express";
import type { Server } from "socket.io";
import type { Pool } from "pg";
import type { Room } from "../room.ts";
import { validateUserToken as defaultValidateUserToken } from "../utils/supabase.ts";
import { sanitizeRoomId as defaultSanitizeRoomId } from "../strip_slashes.ts";

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export interface RoomLifecycleRouterOptions {
  rooms: Map<string, Room>;
  io: Server;
  postgres: Pool | null | undefined;
  getOrCreateRoom: (roomId: string) => Promise<Room | null>;
  unregisterRoomNamespace: (roomId: string) => void;
  validateUserTokenFn?: typeof defaultValidateUserToken;
  extractBearerTokenFn?: (req: Request) => string | undefined;
  sanitizeRoomIdFn?: (rawRoomId: string) => string;
}

export function createRoomLifecycleRouter(options: RoomLifecycleRouterOptions): Router {
  const router = express.Router();
  const rooms = options.rooms;
  const io = options.io;
  const postgres = options.postgres ?? null;
  const getOrCreateRoom = options.getOrCreateRoom;
  const unregisterRoomNamespace = options.unregisterRoomNamespace;

  const validateUserToken = options.validateUserTokenFn ?? defaultValidateUserToken;
  const extractBearer = options.extractBearerTokenFn ?? extractBearerToken;
  const sanitizeRoomId = options.sanitizeRoomIdFn ?? defaultSanitizeRoomId;

  // ============================================================================
  // EXTEND ROOM ENDPOINT
  // ============================================================================
  router.post("/extendRoom", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: { code: "FORBIDDEN", message: "Authentication required" } });
      return;
    }
    const decoded = await validateUserToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid user token" } });
      return;
    }
    const rawRoomId = req.body?.roomId;
    const durationSeconds = Number(req.body?.durationSeconds);
    if (!rawRoomId || !durationSeconds) {
      res.status(400).json({ error: { code: "FORBIDDEN", message: "Missing parameters" } });
      return;
    }
    const roomId = sanitizeRoomId(rawRoomId);

    // max duration 3 hours = 10800s
    if (durationSeconds > 10800 || durationSeconds < 0) {
      res.status(400).json({ error: { code: "FORBIDDEN", message: "Invalid duration" } });
      return;
    }

    try {
      const selectResult = await postgres?.query(
        `SELECT "startedAt", "expiresAt", "status" FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
        [roomId, decoded.uid]
      );

      if (!selectResult || selectResult.rows.length === 0) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
        return;
      }

      const roomRow = selectResult.rows[0];
      if (roomRow.status !== "active" && roomRow.status !== "scheduled" && roomRow.status !== "inactive") {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Room cannot be extended in its current state" } });
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
        "SELECT public.extend_room_authoritative($1, $2, $3) AS new_expires_at",
        [decoded.uid, roomId, new Date(proposedExpiresAt)],
      );

      if (updateResult && updateResult.rowCount && updateResult.rowCount > 0) {
        const newExpiresAt = updateResult.rows[0].new_expires_at;

        const memoryRoom = rooms.get(roomId);
        if (memoryRoom) {
          memoryRoom.expiresAt = new Date(newExpiresAt);
        }
        res.json({ expiresAt: newExpiresAt });
      } else {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
      }
    } catch (e) {
      console.error("Error extending room:", e);
      res.status(500).json({ error: { code: "FORBIDDEN", message: "Internal server error" } });
    }
  });

  // ============================================================================
  // START ROOM ENDPOINT
  // ============================================================================
  router.post("/startRoom", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: { code: "FORBIDDEN", message: "Authentication required" } });
      return;
    }
    const decoded = await validateUserToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid user token" } });
      return;
    }
    const rawRoomId = typeof req.body?.roomId === "string" ? req.body.roomId : "";
    if (!rawRoomId) {
      res.status(400).json({ error: { code: "FORBIDDEN", message: "Missing roomId" } });
      return;
    }
    const roomId = sanitizeRoomId(rawRoomId);

    try {
      if (!postgres) {
        res.status(503).json({ error: { code: "FORBIDDEN", message: "Database unavailable" } });
        return;
      }

      let memoryRoom = rooms.get(roomId);
      if (!memoryRoom) {
        memoryRoom = (await getOrCreateRoom(roomId)) || undefined;
      }

      if (memoryRoom) {
        if (!memoryRoom.isHostUid(decoded.uid) && memoryRoom.owner_id !== decoded.uid) {
          res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the room host or owner can start this room" } });
          return;
        }
      } else {
        // Non-resident room: verify owner authorization authoritatively from database
        const roomRow = (
          await postgres.query<{ owner_id: string }>(
            `SELECT owner_id FROM public.rooms WHERE "roomId" = $1 LIMIT 1`,
            [roomId]
          )
        )?.rows?.[0];

        if (!roomRow) {
          res.status(404).json({ error: { code: "NOT_FOUND", message: "Room not found" } });
          return;
        }

        if (roomRow.owner_id !== decoded.uid) {
          res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the room owner can start this room" } });
          return;
        }
      }

      const activateResult = await postgres.query(
        "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
        [roomId, decoded.uid]
      );

      const result = activateResult?.rows?.[0]?.result;
      if (!result || result.status === "expired") {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "This room has expired." } });
        return;
      }

      if (result.status !== "active") {
        res.status(400).json({ error: { code: "FORBIDDEN", message: "Failed to start the session." } });
        return;
      }

      if (!memoryRoom) {
        memoryRoom = (await getOrCreateRoom(roomId)) || undefined;
      }

      if (memoryRoom) {
        memoryRoom.status = 'active';
        memoryRoom.expiresAt = result.expiresAt ? new Date(result.expiresAt) : undefined;
        memoryRoom.lastUpdateTime = new Date();
        io.of(memoryRoom.roomId).emit("REC:sessionStarted", {
          status: "active",
          startedBy: decoded.uid,
        });
        memoryRoom.scheduleInactivityTimeoutIfNeeded();
        if (result.transitioned !== false && typeof memoryRoom.dispatchRoomStartedNotification === "function") {
          memoryRoom.dispatchRoomStartedNotification(decoded.uid, result.lifecycleEventId).catch((err: any) =>
            console.error(`[LifecycleRouter] Background notification error for ${memoryRoom.roomId}:`, err)
          );
        }
      }

      res.json({ success: true, status: 'active' });
    } catch (error) {
      console.error("Error starting room session:", error);
      res.status(500).json({ error: { code: "FORBIDDEN", message: "Internal server error" } });
    }
  });

  // ============================================================================
  // END ROOM ENDPOINT
  // ============================================================================
  router.post("/endRoom", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: { code: "FORBIDDEN", message: "Authentication required" } });
      return;
    }
    const decoded = await validateUserToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid user token" } });
      return;
    }
    const rawRoomId = typeof req.body?.roomId === "string" ? req.body.roomId : "";
    if (!rawRoomId) {
      res.status(400).json({ error: { code: "FORBIDDEN", message: "Missing roomId" } });
      return;
    }
    const roomId = sanitizeRoomId(rawRoomId);

    try {
      const memoryRoom = rooms.get(roomId);
      if (memoryRoom && !memoryRoom.isHostUid(decoded.uid) && memoryRoom.owner_id !== decoded.uid) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the room host or owner can end this room" } });
        return;
      }

      if (!postgres) {
        res.status(503).json({ error: { code: "FORBIDDEN", message: "Database unavailable" } });
        return;
      }

      // 1. Authoritative DB transition: atomic decision on status ('inactive' for permanent, 'ended' for temporary)
      let endResult: { status?: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired'; isPermanent?: boolean } | null = null;
      try {
        const qRes = await postgres.query(
          `SELECT public.end_room_authoritative($1, $2, 'host') AS result`,
          [decoded.uid, roomId]
        );
        endResult = qRes.rows?.[0]?.result as { status?: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired'; isPermanent?: boolean } | undefined ?? null;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[endRoom] DB error executing end_room_authoritative:", errMsg);
        if (errMsg.includes("ROOM_NOT_FOUND")) {
          res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the room host or owner can end this room" } });
          return;
        }
        res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to end room session" } });
        return;
      }

      const newStatus: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired' = endResult?.status === 'inactive' ? 'inactive' : 'ended';
      const isPermanent: boolean = Boolean(endResult?.isPermanent);

      if (!isPermanent && postgres) {
        postgres.query(
          `UPDATE public.room_admissions SET revoked_at = now(), revoked_reason = 'session_ended' WHERE room_id = $1 AND revoked_at IS NULL`,
          [roomId]
        ).catch((e) => console.warn("[Admission] Failed to revoke admissions for ended temporary room:", e));
      }

      // 2. Broadcast ROOM_SESSION_STOPPED and system message, stop VM, then disconnect
      if (memoryRoom) {
        memoryRoom.status = newStatus;
        memoryRoom.isPermanent = isPermanent;

        // Internal control signal to participant devices to terminate media and exit room immediately
        io.of(memoryRoom.roomId).emit("SIGNAL:terminateAndExit", {
          roomId,
          reason: isPermanent ? "host_stopped_permanent" : "host_ended_temporary",
          isPermanent,
        });

        // Explicit notification to all connected clients before disconnecting
        io.of(memoryRoom.roomId).emit("ROOM_SESSION_STOPPED", {
          isPermanent,
          status: newStatus,
          roomId,
        });

        memoryRoom.addChatMessage(null, {
          id: '',
          system: true,
          msg: isPermanent
            ? 'This room session has been stopped by the host.'
            : 'This watch party has been ended by the host.',
        });

        setTimeout(() => {
          try {
            memoryRoom.disconnectAllSockets();
          } catch (e) {
            console.warn("[endRoom] Error disconnecting sockets:", e);
          }
        }, 100);
      }

      res.json({
        success: true,
        roomId,
        status: newStatus,
        isPermanent,
      });
    } catch (error) {
      console.error("Error ending room session:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================================================
  // DELETE ROOM ENDPOINT
  // ============================================================================
  router.delete("/deleteRoom", async (req: Request, res: Response) => {
    try {
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
        res.status(400).json({ error: "invalid user token" });
        return;
      }
      if (!postgres) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const rawRoomId = typeof req.query.roomId === "string" ? req.query.roomId : "";
      if (!rawRoomId) {
        res.status(400).json({ error: "missing roomId" });
        return;
      }
      const roomId = sanitizeRoomId(rawRoomId);

      const memoryRoom = rooms.get(roomId);
      if (memoryRoom && memoryRoom.owner_id && memoryRoom.owner_id !== decoded.uid) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Only the room owner can delete this room" } });
        return;
      }

      // Authoritative DB deletion with lock-first serialization and quota reclamation
      try {
        await postgres.query(
          `SELECT public.delete_room_authoritative($1, $2) AS result`,
          [decoded.uid, roomId]
        );
      } catch (dbErr: any) {
        const msg = dbErr?.message || "";
        if (msg.includes("ROOM_NOT_FOUND")) {
          res.status(404).json({ error: "Room not found or unauthorized" });
          return;
        }
        if (msg.includes("ROOM_ACTIVE_CANNOT_DELETE")) {
          res.status(409).json({ error: "Cannot delete an active room. Stop the session first." });
          return;
        }
        throw dbErr;
      }

      // Clean up memory structures ONLY after authoritative DB deletion succeeds
      if (memoryRoom) {
        io.of(memoryRoom.roomId).emit("SIGNAL:terminateAndExit", {
          roomId,
          reason: "unavailable",
          isPermanent: false,
        });
        io.of(memoryRoom.roomId).emit("ROOM_SESSION_STOPPED", {
          isPermanent: false,
          status: "ended",
          roomId,
        });
        memoryRoom.disconnectAllSockets();
        rooms.delete(roomId);
        unregisterRoomNamespace(roomId);
        memoryRoom.destroy();
      }

      res.status(204).end();
    } catch (error) {
      console.error("Error deleting room:", error);
      res.status(500).json({ error: "Failed to delete room" });
    }
  });

  return router;
}
