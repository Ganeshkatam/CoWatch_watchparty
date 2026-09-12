/**
 * NOTIFY-001 Notification REST Router
 *
 * All mutations are server-authoritative. read_at is the ONLY column that
 * can be modified through this API (and only by the authenticated owner).
 *
 * Routes:
 *   GET    /api/notifications               - List recent notifications (paginated)
 *   GET    /api/notifications/unread-count  - Get unread count
 *   POST   /api/notifications/:id/read      - Mark single notification read
 *   POST   /api/notifications/read-all      - Mark all notifications read
 *   GET    /api/notifications/preferences   - Get delivery preferences
 *   PUT    /api/notifications/preferences   - Update delivery preferences
 */

import express, { type Request, type Response, type RequestHandler } from 'express';
import { supabaseAdmin } from '../utils/supabase.ts';
import {
  listRecentNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getPreferences,
  upsertPreferences,
} from './notificationRepository.ts';
import {
  emitNotificationRead,
  emitNotificationsReadAll,
} from './notificationSocketNamespace.ts';
import type { Server } from 'socket.io';

// ---------------------------------------------------------------------------
// Auth middleware helper (reuse pattern from existing endpoints)
// ---------------------------------------------------------------------------

async function extractVerifiedUid(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

function requireAuth(
  handler: (req: Request, res: Response, uid: string) => Promise<void>,
): RequestHandler {
  return async (req, res) => {
    const uid = await extractVerifiedUid(req);
    if (!uid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    await handler(req, res, uid);
  };
}

// ---------------------------------------------------------------------------
// Router factory — accepts io for realtime echo
// ---------------------------------------------------------------------------

export function createNotificationRouter(io: Server) {
  const router = express.Router();

  // -------------------------------------------------------------------------
  // GET /api/notifications
  // Query params: limit (1-50, default 20), before_id (cursor)
  // -------------------------------------------------------------------------
  router.get(
    '/',
    requireAuth(async (req, res, uid) => {
      const rawLimit = parseInt(String(req.query.limit ?? '20'), 10);
      const limit = Math.max(1, Math.min(50, isNaN(rawLimit) ? 20 : rawLimit));
      const before_id =
        typeof req.query.before_id === 'string' && req.query.before_id.trim()
          ? req.query.before_id.trim()
          : undefined;

      const notifications = await listRecentNotifications({ user_id: uid, limit, before_id });
      res.json({ notifications });
    }),
  );

  // -------------------------------------------------------------------------
  // GET /api/notifications/unread-count
  // -------------------------------------------------------------------------
  router.get(
    '/unread-count',
    requireAuth(async (_req, res, uid) => {
      const count = await getUnreadCount(uid);
      res.json({ count });
    }),
  );

  // -------------------------------------------------------------------------
  // GET /api/notifications/preferences
  // -------------------------------------------------------------------------
  router.get(
    '/preferences',
    requireAuth(async (_req, res, uid) => {
      const prefs = await getPreferences(uid);
      if (!prefs) {
        // Provision defaults if missing (should not happen after migration backfill)
        const defaulted = await upsertPreferences({ user_id: uid });
        res.json({ preferences: defaulted });
        return;
      }
      res.json({ preferences: prefs });
    }),
  );

  // -------------------------------------------------------------------------
  // PUT /api/notifications/preferences
  // Allowed fields: email_enabled, room_invitations, room_events, moderation_events, system_announcements
  // -------------------------------------------------------------------------
  router.put(
    '/preferences',
    requireAuth(async (req, res, uid) => {
      const ALLOWED_KEYS = new Set([
        'email_enabled',
        'room_invitations',
        'room_events',
        'moderation_events',
        'system_announcements',
      ]);

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
      }

      const bodyKeys = Object.keys(req.body);
      const forbidden = bodyKeys.filter((k) => !ALLOWED_KEYS.has(k));
      if (forbidden.length > 0) {
        res.status(400).json({ error: `Unknown or forbidden fields: ${forbidden.join(', ')}` });
        return;
      }

      // Validate all provided values are booleans
      for (const key of bodyKeys) {
        if (typeof req.body[key] !== 'boolean') {
          res.status(400).json({ error: `Field "${key}" must be a boolean` });
          return;
        }
      }

      const updated = await upsertPreferences({ user_id: uid, ...req.body });
      res.json({ preferences: updated });
    }),
  );

  // -------------------------------------------------------------------------
  // POST /api/notifications/:id/read
  // -------------------------------------------------------------------------
  router.post(
    '/:id/read',
    requireAuth(async (req, res, uid) => {
      const notifId = req.params.id;
      if (!notifId?.match(/^[0-9a-f-]{36}$/i)) {
        res.status(400).json({ error: 'Invalid notification ID' });
        return;
      }

      const updated = await markNotificationRead(uid, notifId);
      if (!updated) {
        // Either already read or belongs to another user
        res.status(404).json({ error: 'Notification not found or already read' });
        return;
      }

      // Best-effort realtime echo
      emitNotificationRead(io, uid, notifId);

      res.json({ success: true });
    }),
  );

  // -------------------------------------------------------------------------
  // POST /api/notifications/read-all
  // -------------------------------------------------------------------------
  router.post(
    '/read-all',
    requireAuth(async (_req, res, uid) => {
      const count = await markAllNotificationsRead(uid);

      // Best-effort realtime echo
      emitNotificationsReadAll(io, uid);

      res.json({ success: true, updated: count });
    }),
  );

  return router;
}
