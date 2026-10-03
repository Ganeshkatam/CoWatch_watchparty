import { Router, type Request, type Response } from "express";
import pg from "pg";
import config from "../config.js";
import { makeUserName as defaultMakeUserName } from "../utils/moniker.js";

export function defaultSanitizeActionUrl(url?: string | null): string | null {
  if (!url || typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  // Allow internal relative paths starting with a single '/'
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
    return trimmed;
  }
  // Allow absolute https:// URLs (and http:// in dev)
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || (config.NODE_ENV === "development" && parsed.protocol === "http:")) {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

export interface PublicUtilityRouterOptions {
  postgres: pg.Pool | null | undefined;
  sanitizeActionUrlFn?: (url?: string | null) => string | null;
  makeUserNameFn?: () => string;
}

export function createPublicUtilityRouter(options: PublicUtilityRouterOptions): Router {
  const router = Router();
  const postgres = options.postgres;
  const sanitizeActionUrl = options.sanitizeActionUrlFn || defaultSanitizeActionUrl;
  const makeUserName = options.makeUserNameFn || defaultMakeUserName;

  router.get("/announcements", async (_req: Request, res: Response) => {
    if (!postgres) {
      console.warn("[WARNING]: postgres not configured, returning empty announcements");
      res.json({ announcements: [] });
      return;
    }

    try {
      const result = await postgres.query(`
        SELECT
          id,
          title,
          body,
          level,
          action_label,
          action_url,
          published_at,
          updated_at
        FROM public.announcements
        WHERE is_active = true
          AND published_at <= NOW()
        ORDER BY published_at DESC
        LIMIT 10
      `);

      const announcements = (result.rows || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        level: row.level,
        action_label: row.action_label || null,
        action_url: sanitizeActionUrl(row.action_url),
        published_at: row.published_at,
        updated_at: row.updated_at,
      }));

      res.json({ announcements });
    } catch (err: any) {
      console.warn("[WARNING]: Failed to fetch announcements:", err.message);
      res.json({ announcements: [] });
    }
  });

  router.get("/generateName", async (_req: Request, res: Response) => {
    res.send(makeUserName());
  });

  return router;
}
