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

import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type RequestHandler } from 'express';
import { supabaseAdmin } from '../utils/supabase.ts';
import { postgres } from '../utils/postgres.ts';
import config from '../config.ts';
import { isTerminalRoom } from '../lifecycle/types.ts';
import { notificationService } from './notificationService.ts';
import { hashInvitationToken, generateRawInvitationToken } from '../invitations/invitationRouter.ts';

export const getCanonicalJoinUrl = (roomId: string, baseOrigin?: string): string => {
  const appBaseUrl = (baseOrigin || config.APP_URL || '').replace(/\/+$/, '');
  return appBaseUrl ? `${appBaseUrl}/join/${encodeURIComponent(roomId)}` : `/join/${encodeURIComponent(roomId)}`;
};
import {
  listRecentNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getPreferences,
  upsertPreferences,
  deleteNotification,
  deleteAllNotifications,
} from './notificationRepository.ts';
import {
  emitNotificationRead,
  emitNotificationsReadAll,
  emitNotificationDeleted,
  emitNotificationsCleared,
} from './notificationSocketNamespace.ts';
import type { Server } from 'socket.io';

// ---------------------------------------------------------------------------
// Invitation rate limiter (per caller UID)
// ---------------------------------------------------------------------------

const inviteRateLimits = new Map<string, { count: number; windowStart: number }>();

function checkInviteRateLimit(callerUid: string): boolean {
  const now = Date.now();
  const entry = inviteRateLimits.get(callerUid);
  if (!entry || now - entry.windowStart > 60000) {
    inviteRateLimits.set(callerUid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 10) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function resetInviteRateLimitsForTesting(): void {
  inviteRateLimits.clear();
}

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

export function createNotificationRouter(io: Server, roomLookup?: (roomId: string) => any) {
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

  // -------------------------------------------------------------------------
  // DELETE /api/notifications/clear-all
  // -------------------------------------------------------------------------
  router.delete(
    '/clear-all',
    requireAuth(async (_req, res, uid) => {
      const count = await deleteAllNotifications(uid);
      emitNotificationsCleared(io, uid);
      res.json({ success: true, deleted: count });
    }),
  );

  // -------------------------------------------------------------------------
  // DELETE /api/notifications/:id
  // -------------------------------------------------------------------------
  router.delete(
    '/:id',
    requireAuth(async (req, res, uid) => {
      const notifId = req.params.id;
      if (!notifId?.match(/^[0-9a-f-]{36}$/i)) {
        res.status(400).json({ error: 'Invalid notification ID' });
        return;
      }

      const deleted = await deleteNotification(uid, notifId);
      if (!deleted) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }

      emitNotificationDeleted(io, uid, notifId);
      res.json({ success: true });
    }),
  );

  // -------------------------------------------------------------------------
  // POST /api/notifications/invite
  // Body: { roomId: string, targetUsername: string, invitationId?: string }
  // -------------------------------------------------------------------------
  router.post(
    '/invite',
    requireAuth(async (req, res, callerUid) => {
      const { roomId, targetUsername, invitationId } = req.body || {};

      if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
        res.status(400).json({ error: 'Valid roomId is required' });
        return;
      }
      if (!targetUsername || typeof targetUsername !== 'string' || !targetUsername.trim()) {
        res.status(400).json({ error: 'Valid targetUsername is required' });
        return;
      }

      const invId = typeof invitationId === 'string' && invitationId.trim() ? invitationId.trim() : randomUUID();
      const cleanRoomId = roomId.trim();
      const cleanUsername = targetUsername.trim();

      // Check caller rate limit
      if (!checkInviteRateLimit(callerUid)) {
        res.status(429).json({ error: 'Invitation rate limit exceeded. Please wait a moment.' });
        return;
      }

      if (!postgres) {
        res.status(503).json({ error: 'Database service unavailable' });
        return;
      }

      // Check room existence and status
      const roomRes = await postgres.query(
        `SELECT "roomId", "roomTitle", owner_id, status, "isPermanent", participants_locked, passcode
         FROM public.rooms
         WHERE "roomId" = $1`,
        [cleanRoomId],
      );

      if (!roomRes.rows || roomRes.rows.length === 0) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      const room = roomRes.rows[0];
      if (isTerminalRoom(room)) {
        res.status(400).json({ error: 'Cannot invite to an ended or expired room' });
        return;
      }

      // Authorize caller: must be room owner or active host (non-hosts cannot invite users)
      let isAuthorized = Boolean(room.owner_id && room.owner_id === callerUid);
      if (!isAuthorized && roomLookup) {
        const liveRoom = roomLookup(cleanRoomId);
        if (liveRoom) {
          if (typeof liveRoom.isHostUid === 'function') {
            isAuthorized = liveRoom.isHostUid(callerUid);
          } else if (liveRoom.currentHostUid) {
            isAuthorized = liveRoom.currentHostUid === callerUid;
          }
        }
      }

      if (!isAuthorized) {
        res.status(403).json({ error: 'Only the room host or owner can send invitations' });
        return;
      }

      if (room.participants_locked && room.owner_id !== callerUid) {
        res.status(403).json({ error: 'Room admissions are locked by the host' });
        return;
      }

      // Resolve target account (existing CoWatch account scope)
      const targetRes = await postgres.query(
        `SELECT id, username, display_name
         FROM public.profiles
         WHERE lower(username) = lower($1) OR id::text = $1`,
        [cleanUsername],
      );

      // Anti-enumeration protection: return 200 generic success if user does not exist
      if (!targetRes.rows || targetRes.rows.length === 0) {
        res.json({ success: true, message: 'If this user exists, an invitation was sent.' });
        return;
      }

      const targetUser = targetRes.rows[0];

      // Prevent self-invitations
      if (targetUser.id === callerUid) {
        res.status(400).json({ error: 'Cannot invite yourself' });
        return;
      }

      // Create persistent room_invitation record (bearer token hashed)
      const rawToken = generateRawInvitationToken();
      const tokenHash = hashInvitationToken(rawToken);
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

      await postgres.query(
        `INSERT INTO public.room_invitations
         (id, room_id, inviter_id, target_user_id, token_hash, expires_at, is_reusable)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [invId, cleanRoomId, callerUid, targetUser.id, tokenHash, expiresAt, false],
      );

      // Fetch caller name for personalized copy
      const callerRes = await postgres.query(
        `SELECT display_name, username FROM public.profiles WHERE id = $1`,
        [callerUid],
      );
      const callerProfile = callerRes.rows?.[0];
      const callerName = callerProfile?.display_name || callerProfile?.username || 'A friend';
      const roomTitle = room.roomTitle || cleanRoomId;
      const roomPasscode = room.passcode || '';

      const origin = req.get('origin') || (req.get('host') ? `${req.protocol}://${req.get('host')}` : '');
      const invitationUrl = origin ? `${origin}/invite/${encodeURIComponent(rawToken)}` : `/invite/${encodeURIComponent(rawToken)}`;

      // Dispatch via NotificationService:
      // Invariant: Do NOT persist raw bearer token in notification metadata.
      await notificationService.notifyUser({
        userId: targetUser.id,
        type: 'ROOM_INVITATION',
        title: `Invite to "${roomTitle}"`,
        body: `${callerName} invited you to join "${roomTitle}". Room ID: ${cleanRoomId}${roomPasscode ? ` | Passcode: ${roomPasscode}` : ''}`,
        metadata: {
          action: 'join_invitation',
          invitationId: invId,
          roomId: cleanRoomId,
          inviterId: callerUid,
          inviterName: callerName,
        },
        eventId: `ROOM_INVITATION:${cleanRoomId}:${targetUser.id}:${invId}`,
        emailTemplateKey: 'room-invitation',
        emailPayload: {
          roomTitle,
          roomUrl: invitationUrl,
          roomId: cleanRoomId,
          passcode: roomPasscode,
          inviterName: callerName,
          userName: targetUser.display_name || targetUser.username || 'there',
        },
      });

      res.json({ success: true, message: 'Invitation sent successfully' });
    }),
  );

  return router;
}
