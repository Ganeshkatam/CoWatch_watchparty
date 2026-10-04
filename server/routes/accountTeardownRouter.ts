import express, { type Request, type Response, Router } from "express";
import type { Pool } from "pg";
import type { Room } from "../room.ts";
import { validateUserToken as defaultValidateUserToken } from "../utils/supabase.ts";
import { deleteUser as defaultDeleteUser } from "../utils/supabase.ts";
import { redisCount as defaultRedisCount } from "../utils/redis.ts";

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export interface AccountTeardownRouterOptions {
  rooms: Map<string, Room>;
  postgres: Pool | null | undefined;
  unregisterRoomNamespaceFn: (roomId: string) => void;
  validateUserTokenFn?: typeof defaultValidateUserToken;
  extractBearerTokenFn?: (req: Request) => string | undefined;
  deleteUserFn?: typeof defaultDeleteUser;
  redisCountFn?: (metric: string) => void;
}

export function createAccountTeardownRouter(options: AccountTeardownRouterOptions): Router {
  const router = express.Router();
  const rooms = options.rooms;
  const postgres = options.postgres ?? null;
  const unregisterRoomNamespace = options.unregisterRoomNamespaceFn;

  const validateUserToken = options.validateUserTokenFn ?? defaultValidateUserToken;
  const extractBearer = options.extractBearerTokenFn ?? extractBearerToken;
  const deleteUser = options.deleteUserFn ?? defaultDeleteUser;
  const redisCount = options.redisCountFn ?? defaultRedisCount;

  router.delete("/deleteAccount", async (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: "invalid user token" });
      return;
    }
    const decoded = await validateUserToken("", token, false);
    if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
      res.status(400).json({ error: "invalid user token" });
      return;
    }
    if (postgres) {
      // Authoritatively purge all rooms under lock, retaining policy and zeroed usage row
      const purgeRes = await postgres.query(
        "SELECT public.purge_account_rooms_authoritative($1) AS deleted_ids",
        [decoded.uid]
      );
      const deletedIds: string[] = purgeRes.rows?.[0]?.deleted_ids || [];
      for (const rId of deletedIds) {
        const memRoom = rooms.get(rId);
        if (memRoom) {
          memRoom.destroy();
          rooms.delete(rId);
          unregisterRoomNamespace(rId);
        }
      }

      // Delete linked accounts
      await postgres.query("DELETE FROM link_account WHERE uid = $1", [
        decoded.uid,
      ]);
    }
    await deleteUser(decoded.uid);
    redisCount("deleteAccount");
    res.json({});
  });

  return router;
}
