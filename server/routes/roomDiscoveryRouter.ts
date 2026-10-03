import { Router, type Request, type Response } from "express";
import pg from "pg";
import { Room } from "../room.js";
import config from "../config.js";
import { validateUserToken } from "../utils/supabase.js";
import { sanitizeRoomId } from "../strip_slashes.js";
import { resolveShard } from "../utils/resolveShard.js";

function defaultExtractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return undefined;
}

export interface RoomDiscoveryRouterOptions {
  rooms: Map<string, Room>;
  postgres: pg.Pool | null | undefined;
  getOrCreateRoom: (roomId: string) => Promise<Room | null>;
  configOverride?: { SHARD?: boolean };
  // Test injection hooks
  validateUserTokenFn?: (project: string, token: string) => Promise<any>;
  extractBearerTokenFn?: (req: Request) => string | undefined;
  sanitizeRoomIdFn?: (raw: string) => string;
  resolveShardFn?: (roomId: string) => number;
}

export function createRoomDiscoveryRouter(options: RoomDiscoveryRouterOptions): Router {
  const router = Router();
  const rooms = options.rooms;
  const postgres = options.postgres;
  const getOrCreateRoom = options.getOrCreateRoom;

  const validateToken = options.validateUserTokenFn || validateUserToken;
  const extractToken = options.extractBearerTokenFn || defaultExtractBearerToken;
  const sanitizeId = options.sanitizeRoomIdFn || sanitizeRoomId;
  const resolveShardHandler = options.resolveShardFn || resolveShard;

  router.get("/roomInfo/:roomId", async (req: Request, res: Response) => {
    const rawRoomId = req.params.roomId;
    if (!rawRoomId || typeof rawRoomId !== "string") {
      res.status(400).json({ error: "Missing room identifier" });
      return;
    }
    const cleanRoomId = sanitizeId(rawRoomId);

    // Attempt to decode caller token if provided strictly via Authorization header
    let callerUid: string | undefined;
    const token = extractToken(req);

    if (token) {
      try {
        const decoded = await validateToken("", token);
        if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
          callerUid = decoded.uid;
        }
      } catch {
        // Best-effort session check
      }
    }

    try {
      const result = await postgres?.query(
        `SELECT r."roomId", r."roomTitle", r."roomDescription", r."coverPhoto", r.status, r."expiresAt", r."isPermanent",
                (r.passcode IS NOT NULL AND r.passcode <> '') as "requiresPasscode", r.owner_id, r.participants_locked, r.max_participants,
                p.display_name as "hostName"
         FROM rooms r
         LEFT JOIN profiles p ON r.owner_id = p.id
         WHERE r."roomId" = $1`,
        [cleanRoomId]
      );

      if (!result || result.rows.length === 0) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      const row = result.rows[0];

      // Compute derived status if expired
      let derivedStatus = row.status;
      if ((row.status === "active" || row.status === "inactive") && !row.isPermanent && row.expiresAt) {
        const expiresAt = new Date(row.expiresAt).getTime();
        if (expiresAt <= Date.now()) {
          derivedStatus = "expired";
        }
      }

      const isOwner = Boolean(callerUid && row.owner_id && callerUid === row.owner_id);
      let isHost = isOwner;
      let memoryRoom = rooms.get(cleanRoomId);
      if (!memoryRoom) {
        memoryRoom = (await getOrCreateRoom(cleanRoomId)) || undefined;
      }
      let isHostPresent = false;
      if (memoryRoom && typeof (memoryRoom as any).isHostPresent === "function") {
        isHostPresent = (memoryRoom as any).isHostPresent();
      }
      if (memoryRoom && callerUid) {
        if (typeof (memoryRoom as any).isHostUid === "function") {
          isHost = isHost || (memoryRoom as any).isHostUid(callerUid);
        } else if ((memoryRoom as any).currentHostUid) {
          isHost = isHost || (memoryRoom as any).currentHostUid === callerUid;
        }
      }

      // Sanitize response: NEVER leak owner_id, passcode hash, or internal metadata
      res.json({
        roomId: row.roomId,
        roomTitle: row.roomTitle || row.roomId,
        roomDescription: row.roomDescription || "",
        coverPhoto: row.coverPhoto || null,
        status: derivedStatus,
        requiresPasscode: Boolean(row.requiresPasscode),
        participantsLocked: Boolean(row.participants_locked),
        maxParticipants: typeof row.max_participants === "number" ? row.max_participants : 10,
        isOwner,
        isHost,
        owner_id: isOwner ? row.owner_id : null,
        isHostPresent: Boolean(isHostPresent),
        hostName: row.hostName || "Host",
        isPermanent: Boolean(row.isPermanent),
      });
    } catch (err) {
      console.error("Error fetching roomInfo:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/resolveShard/:roomId", async (req: Request, res: Response) => {
    const cleanRoomId = sanitizeId(req.params.roomId);
    const shardNum = resolveShardHandler(cleanRoomId);
    const isShardConfigured = options.configOverride?.SHARD !== undefined
      ? options.configOverride.SHARD
      : config.SHARD;
    res.send(String(isShardConfigured ? shardNum : ""));
  });

  return router;
}
