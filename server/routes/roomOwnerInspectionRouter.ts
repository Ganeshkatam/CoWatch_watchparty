import { Router, type Request, type Response } from "express";
import pg from "pg";
import { validateUserToken } from "../utils/supabase.js";
import { sanitizeRoomId } from "../strip_slashes.js";
import { decryptPasscodeForOwner } from "../utils/roomPasscode.js";

function defaultExtractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return undefined;
}

export interface RoomOwnerInspectionRouterOptions {
  postgres: pg.Pool | null | undefined;
  // Test injection hooks
  validateUserTokenFn?: (project: string, token: string, checkVerified?: boolean) => Promise<any>;
  extractBearerTokenFn?: (req: Request) => string | undefined;
  sanitizeRoomIdFn?: (raw: string) => string;
  decryptPasscodeForOwnerFn?: typeof decryptPasscodeForOwner;
}

export function createRoomOwnerInspectionRouter(options: RoomOwnerInspectionRouterOptions): Router {
  const router = Router();
  const postgres = options.postgres;

  const validateToken = options.validateUserTokenFn || validateUserToken;
  const extractToken = options.extractBearerTokenFn || defaultExtractBearerToken;
  const sanitizeId = options.sanitizeRoomIdFn || sanitizeRoomId;
  const decryptPasscode = options.decryptPasscodeForOwnerFn || decryptPasscodeForOwner;

  router.get("/roomData/:roomId", async (req: Request, res: Response) => {
    const cleanRoomId = sanitizeId(req.params.roomId);
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const decoded = await validateToken("", token, false);
    if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: "Unauthorized or unverified email" });
      return;
    }

    if (!postgres) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    const result = await postgres.query(
      `SELECT data FROM rooms WHERE "roomId" = $1 AND owner_id = $2`,
      [cleanRoomId, decoded.uid],
    );

    if (!result || result.rows.length === 0) {
      res.status(404).json({ error: "Room not found or unauthorized" });
      return;
    }

    res.json(result.rows[0].data);
  });

  router.get("/listRooms", async (req: Request, res: Response) => {
    try {
      const token = extractToken(req);
      if (!token) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const decoded = await validateToken("", token);
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
      const hasPagination = req.query.limit !== undefined || req.query.page !== undefined;
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
      const limit = hasPagination ? Math.max(1, Math.min(100, parseInt(String(req.query.limit || "12"), 10) || 12)) : 0;
      const offset = (page - 1) * limit;

      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
      const access = typeof req.query.access === "string" ? req.query.access.trim() : "";
      const chat = typeof req.query.chat === "string" ? req.query.chat.trim() : "";
      const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "newest";

      const whereClauses: string[] = [`owner_id = $1`];
      const params: any[] = [decoded.uid];

      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        const idx = params.length;
        whereClauses.push(`(LOWER("roomTitle") LIKE $${idx} OR LOWER("roomDescription") LIKE $${idx} OR LOWER("roomId") LIKE $${idx})`);
      }

      if (status && status !== "all") {
        if (status === "active") {
          whereClauses.push(`status = 'active'`);
        } else if (status === "inactive") {
          whereClauses.push(`status = 'inactive'`);
        } else if (status === "permanent") {
          whereClauses.push(`"isPermanent" = true`);
        } else if (status === "expiring") {
          whereClauses.push(`(status = 'expiring' OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" > NOW() AND "expiresAt" <= NOW() + INTERVAL '15 minutes'))`);
        } else if (status === "finished") {
          whereClauses.push(`(status IN ('expired', 'ended') OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" <= NOW()))`);
        }
      }

      if (access && access !== "all") {
        if (access === "protected") {
          whereClauses.push(`(passcode IS NOT NULL AND passcode <> '')`);
        } else if (access === "public") {
          whereClauses.push(`(passcode IS NULL OR passcode = '')`);
        }
      }

      if (chat && chat !== "all") {
        if (chat === "enabled") {
          whereClauses.push(`"isChatDisabled" IS NOT TRUE`);
        } else if (chat === "disabled") {
          whereClauses.push(`"isChatDisabled" IS TRUE`);
        }
      }

      let orderBy = `"creationTime" DESC`;
      if (sort === "oldest") {
        orderBy = `"creationTime" ASC`;
      } else if (sort === "title-asc") {
        orderBy = `LOWER(COALESCE("roomTitle", "roomId")) ASC`;
      } else if (sort === "title-desc") {
        orderBy = `LOWER(COALESCE("roomTitle", "roomId")) DESC`;
      } else if (sort === "expiring") {
        orderBy = `CASE WHEN status IN ('active', 'expiring') THEN 0 ELSE 1 END, "expiresAt" ASC NULLS LAST, "creationTime" DESC`;
      }

      const whereSql = whereClauses.join(" AND ");

      let totalCount = 0;
      let stats = { total: 0, active: 0, expiring: 0, finished: 0 };

      if (hasPagination) {
        const statsPromise = postgres.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(CASE WHEN status = 'active' THEN 1 END)::int AS active,
             COUNT(CASE WHEN (status = 'expiring' OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" > NOW() AND "expiresAt" <= NOW() + INTERVAL '15 minutes')) THEN 1 END)::int AS expiring,
             COUNT(CASE WHEN (status IN ('expired', 'ended') OR (status IN ('active', 'inactive') AND "isPermanent" IS NOT TRUE AND "expiresAt" IS NOT NULL AND "expiresAt" <= NOW())) THEN 1 END)::int AS finished
           FROM rooms WHERE owner_id = $1`,
          [decoded.uid]
        );

        const countPromise = postgres.query(
          `SELECT COUNT(*)::int AS count FROM rooms WHERE ${whereSql}`,
          params
        );

        const [statsRes, countRes] = await Promise.all([statsPromise, countPromise]);
        if (statsRes?.rows?.[0]) {
          stats = {
            total: Number(statsRes.rows[0].total) || 0,
            active: Number(statsRes.rows[0].active) || 0,
            expiring: Number(statsRes.rows[0].expiring) || 0,
            finished: Number(statsRes.rows[0].finished) || 0,
          };
        }
        totalCount = Number(countRes?.rows?.[0]?.count) || 0;
      }

      let querySql = `SELECT "roomId", (passcode IS NOT NULL AND passcode <> '') AS "isPasscodeProtected",
                             "creationTime", "roomTitle", "roomDescription", "coverPhoto", "isChatDisabled", "isSubRoom",
                             status, "startedAt", "expiresAt", "endedAt", "isPermanent", owner_passcode
                      FROM rooms WHERE ${whereSql} ORDER BY ${orderBy}`;

      const queryParams = [...params];
      if (hasPagination) {
        queryParams.push(limit, offset);
        querySql += ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
      }

      const result = await postgres.query(querySql, queryParams);

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
        const isEnded = derivedStatus === 'ended' || derivedStatus === 'expired';
        const currentPasscode = (isEnded || !r.owner_passcode) ? null : decryptPasscode(r.owner_passcode);
        return {
          ...r,
          owner_passcode: undefined,
          currentPasscode,
          status: derivedStatus,
        };
      });

      if (hasPagination) {
        res.json({
          rooms: rows,
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          stats,
        });
      } else {
        res.json(rows);
      }
    } catch (err: any) {
      console.error("Error in /listRooms:", err);
      res.status(500).json({ error: err?.message || "Failed to list rooms" });
    }
  });

  router.get("/roomDetails", async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const decoded = await validateToken("", token);
    if (decoded === "EMAIL_NOT_VERIFIED") {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required." } });
      return;
    }
    if (!decoded) {
      res.status(400).json({ error: "invalid user token" });
      return;
    }

    const rawRoomId = req.query.roomId;
    if (!rawRoomId || typeof rawRoomId !== "string") {
      res.status(400).json({ error: "missing roomId" });
      return;
    }
    const roomId = sanitizeId(rawRoomId);

    try {
      const roomResult = await postgres?.query(
        `SELECT "roomId", (passcode IS NOT NULL AND passcode <> '') AS "isPasscodeProtected",
                "creationTime", "roomTitle", "roomDescription", "coverPhoto", "isChatDisabled", "isSubRoom",
                status, "startedAt", "expiresAt", "endedAt", "isPermanent", owner_passcode, max_participants
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

      const isEnded = derivedStatus === 'ended' || derivedStatus === 'expired';
      const currentPasscode = (isEnded || !room.owner_passcode) ? null : decryptPasscode(room.owner_passcode);

      // Fetch lifecycle events
      const lifecycleResult = await postgres?.query(
        `SELECT id, actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp
         FROM room_lifecycle_events WHERE "roomId" = $1
         ORDER BY timestamp DESC`,
        [roomId]
      );

      // Fetch recent messages
      const messagesResult = await postgres?.query(
        `SELECT rm.id, rm.user_id, rm.message, rm.message_type, rm.event_type, rm.metadata, rm.created_at, rm.updated_at, rm.is_deleted, p.display_name as profile_name, p.avatar_url as profile_picture
         FROM room_messages rm
         LEFT JOIN profiles p ON rm.user_id = p.id
         WHERE rm.room_id = $1
         ORDER BY rm.created_at DESC, rm.id DESC LIMIT 20`,
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
        recentMessages: messagesResult?.rows.reverse() ?? [],
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

  return router;
}
