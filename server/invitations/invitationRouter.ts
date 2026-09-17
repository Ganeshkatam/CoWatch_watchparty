import crypto from 'node:crypto';
import express, { type Request, type Response, type RequestHandler } from 'express';
import { supabaseAdmin, validateToken } from '../utils/supabase.ts';
import { postgres } from '../utils/postgres.ts';
import { isTerminalRoom } from '../lifecycle/types.ts';
import { generateAdmissionToken } from '../utils/admissionToken.ts';
import config from '../config.ts';

export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function generateRawInvitationToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export const getCanonicalInvitationUrl = (token: string, baseOrigin?: string): string => {
  const appBaseUrl = (baseOrigin || config.APP_URL || '').replace(/\/+$/, '');
  return appBaseUrl ? `${appBaseUrl}/invite/${encodeURIComponent(token)}` : `/invite/${encodeURIComponent(token)}`;
};

// Rate limiting for invitation creation (per user)
const creationRateLimits = new Map<string, { count: number; windowStart: number }>();

function checkCreationRateLimit(callerUid: string): boolean {
  const now = Date.now();
  const entry = creationRateLimits.get(callerUid);
  if (!entry || now - entry.windowStart > 60000) {
    creationRateLimits.set(callerUid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 15) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function resetInvitationRateLimitsForTesting(): void {
  creationRateLimits.clear();
}

async function extractVerifiedCaller(req: Request): Promise<{ uid: string; email?: string } | 'EMAIL_NOT_VERIFIED' | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (req.query?.token as string | undefined);

  if (!token) return null;

  const validated = await validateToken(token, true);
  if (validated === 'EMAIL_NOT_VERIFIED') return 'EMAIL_NOT_VERIFIED';
  if (!validated) return null;
  return { uid: validated.uid, email: validated.email };
}

function requireAuth(
  handler: (req: Request, res: Response, callerUid: string) => Promise<void>,
): RequestHandler {
  return async (req, res) => {
    const caller = await extractVerifiedCaller(req);
    if (caller === 'EMAIL_NOT_VERIFIED') {
      res.status(403).json({ error: 'Email verification is required.' });
      return;
    }
    if (!caller || !caller.uid) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    await handler(req, res, caller.uid);
  };
}

export interface InvitationRouterOptions {
  postgresPool?: typeof postgres;
  roomLookup?: (roomId: string) => any;
  rooms?: Map<string, any>;
}

export function createInvitationRouter(options: InvitationRouterOptions = {}) {
  const router = express.Router();
  const pool = options.postgresPool || postgres;
  const roomLookup = options.roomLookup;
  const memoryRooms = options.rooms;

  // -------------------------------------------------------------------------
  // POST /api/invitations
  // Host or Owner creates an invitation (share link or targeted)
  // -------------------------------------------------------------------------
  router.post(
    '/',
    requireAuth(async (req, res, callerUid) => {
      const { roomId, targetUserId, isReusable, ttlHours } = req.body || {};

      if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
        res.status(400).json({ error: 'Valid roomId is required' });
        return;
      }

      if (!pool) {
        res.status(503).json({ error: 'Database service unavailable' });
        return;
      }

      if (!checkCreationRateLimit(callerUid)) {
        res.status(429).json({ error: 'Too many invitations created. Please wait a minute.' });
        return;
      }

      const cleanRoomId = roomId.trim().replace(/^\//, '');

      // Verify room existence and lifecycle
      const roomRes = await pool.query(
        `SELECT "roomId", "roomTitle", owner_id, status, "isPermanent", participants_locked
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
        res.status(400).json({ error: 'Cannot create invitation for an ended or expired room' });
        return;
      }

      // Check caller authorization: must be room owner or active host
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
        res.status(403).json({ error: 'Only the room host or owner can create invitations' });
        return;
      }

      const isPermanentRoom = Boolean(room.isPermanent);
      // Permanent room invitations are reusable by default unless specified; temporary room invitations default to single-use
      const reusable = typeof isReusable === 'boolean' ? isReusable : isPermanentRoom;

      // TTL calculation
      const hours = typeof ttlHours === 'number' && ttlHours > 0 ? Math.min(ttlHours, 720) : (reusable ? 168 : 72);
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      const rawToken = generateRawInvitationToken();
      const tokenHash = hashInvitationToken(rawToken);

      let cleanTargetUserId: string | null = null;
      if (typeof targetUserId === 'string' && targetUserId.trim()) {
        cleanTargetUserId = targetUserId.trim();
        if (cleanTargetUserId === callerUid) {
          res.status(400).json({ error: 'Cannot invite yourself' });
          return;
        }
      }

      const insertRes = await pool.query(
        `INSERT INTO public.room_invitations
         (room_id, inviter_id, target_user_id, token_hash, expires_at, is_reusable)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [cleanRoomId, callerUid, cleanTargetUserId, tokenHash, expiresAt, reusable],
      );

      const invitation = insertRes.rows[0];
      const origin = req.get('origin') || (req.get('host') ? `${req.protocol}://${req.get('host')}` : '');
      const invitationUrl = getCanonicalInvitationUrl(rawToken, origin);

      res.status(201).json({
        invitationId: invitation.id,
        token: rawToken,
        invitationUrl,
        roomId: cleanRoomId,
        expiresAt,
        isReusable: reusable,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // GET /api/invitations/:token
  // Read-only preview & metadata resolution (NO PASSCODE EXPOSURE)
  // -------------------------------------------------------------------------
  router.get('/:token', async (req, res) => {
    const rawToken = req.params.token;
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      res.status(404).json({ valid: false, error: 'Invitation not found' });
      return;
    }

    if (!pool) {
      res.status(503).json({ valid: false, error: 'Database service unavailable' });
      return;
    }

    const tokenHash = hashInvitationToken(rawToken);

    try {
      const result = await pool.query(
        `SELECT i.id, i.room_id, i.inviter_id, i.target_user_id, i.expires_at, i.revoked_at,
                i.accepted_at, i.is_reusable,
                r."roomTitle", r.status, r."isPermanent", r.participants_locked,
                p.display_name AS inviter_name, p.username AS inviter_username
         FROM public.room_invitations i
         JOIN public.rooms r ON r."roomId" = i.room_id
         LEFT JOIN public.profiles p ON p.id = i.inviter_id
         WHERE i.token_hash = $1`,
        [tokenHash],
      );

      if (!result.rows || result.rows.length === 0) {
        res.status(404).json({ valid: false, error: 'This invitation is invalid or does not exist.' });
        return;
      }

      const inv = result.rows[0];

      // Expiry check
      if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
        res.status(404).json({ valid: false, error: 'This invitation has expired.' });
        return;
      }

      // Revocation check
      if (inv.revoked_at) {
        res.status(404).json({ valid: false, error: 'This invitation has been revoked.' });
        return;
      }

      // Single-use check
      if (!inv.is_reusable && inv.accepted_at) {
        res.status(404).json({ valid: false, error: 'This invitation has already been accepted.' });
        return;
      }

      // Room lifecycle check
      if (isTerminalRoom({ status: inv.status, isPermanent: inv.isPermanent })) {
        res.status(404).json({ valid: false, error: 'This room has ended or expired.' });
        return;
      }

      const inviterDisplayName = inv.inviter_name || inv.inviter_username || 'The Host';

      // Strictly omit the room passcode!
      res.json({
        valid: true,
        invitationId: inv.id,
        roomId: inv.room_id,
        roomTitle: inv.roomTitle || inv.room_id,
        inviterName: inviterDisplayName,
        status: inv.status,
        isPermanent: Boolean(inv.isPermanent),
        isReusable: Boolean(inv.is_reusable),
      });
    } catch (err) {
      console.error('Error resolving invitation token:', err);
      res.status(500).json({ valid: false, error: 'Failed to resolve invitation.' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/invitations/by-id/:id
  // Read-only preview for authenticated target user via notification
  // -------------------------------------------------------------------------
  router.get('/by-id/:id', requireAuth(async (req, res, callerUid) => {
    const invId = req.params.id;
    if (!invId || typeof invId !== 'string') {
      res.status(404).json({ valid: false, error: 'Invitation not found' });
      return;
    }

    if (!pool) {
      res.status(503).json({ valid: false, error: 'Database service unavailable' });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT i.id, i.room_id, i.inviter_id, i.target_user_id, i.expires_at, i.revoked_at,
                i.accepted_at, i.is_reusable,
                r."roomTitle", r.status, r."isPermanent",
                p.display_name AS inviter_name, p.username AS inviter_username
         FROM public.room_invitations i
         JOIN public.rooms r ON r."roomId" = i.room_id
         LEFT JOIN public.profiles p ON p.id = i.inviter_id
         WHERE i.id = $1`,
        [invId],
      );

      if (!result.rows || result.rows.length === 0) {
        res.status(404).json({ valid: false, error: 'Invitation not found' });
        return;
      }

      const inv = result.rows[0];
      if (inv.target_user_id && inv.target_user_id !== callerUid && inv.inviter_id !== callerUid) {
        res.status(403).json({ valid: false, error: 'Unauthorized to view this invitation' });
        return;
      }

      if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
        res.status(404).json({ valid: false, error: 'This invitation has expired.' });
        return;
      }
      if (inv.revoked_at) {
        res.status(404).json({ valid: false, error: 'This invitation has been revoked.' });
        return;
      }
      if (isTerminalRoom({ status: inv.status, isPermanent: inv.isPermanent })) {
        res.status(404).json({ valid: false, error: 'This room has ended or expired.' });
        return;
      }

      res.json({
        valid: true,
        invitationId: inv.id,
        roomId: inv.room_id,
        roomTitle: inv.roomTitle || inv.room_id,
        inviterName: inv.inviter_name || inv.inviter_username || 'The Host',
        status: inv.status,
        isPermanent: Boolean(inv.isPermanent),
        isReusable: Boolean(inv.is_reusable),
      });
    } catch (err) {
      console.error('Error fetching invitation by ID:', err);
      res.status(500).json({ valid: false, error: 'Server error' });
    }
  }));

  // -------------------------------------------------------------------------
  // POST /api/invitations/:token/accept
  // Sole state-changing admission endpoint via token
  // -------------------------------------------------------------------------
  router.post(
    '/:token/accept',
    requireAuth(async (req, res, callerUid) => {
      const rawToken = req.params.token;
      const { sessionId } = req.body || {};

      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        res.status(400).json({ valid: false, error: 'Missing invitation token' });
        return;
      }

      if (!pool) {
        res.status(503).json({ valid: false, error: 'Database service unavailable' });
        return;
      }

      const cleanSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : crypto.randomUUID();
      const tokenHash = hashInvitationToken(rawToken);

      try {
        const result = await pool.query(
          `SELECT i.id, i.room_id, i.inviter_id, i.target_user_id, i.expires_at, i.revoked_at,
                  i.accepted_at, i.is_reusable,
                  r."roomTitle", r.status, r."isPermanent", r.owner_id, r.participants_locked, r.max_participants
           FROM public.room_invitations i
           JOIN public.rooms r ON r."roomId" = i.room_id
           WHERE i.token_hash = $1`,
          [tokenHash],
        );

        if (!result.rows || result.rows.length === 0) {
          res.status(404).json({ valid: false, error: 'This invitation is invalid or does not exist.' });
          return;
        }

        const inv = result.rows[0];

        // 1. Expiry check
        if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
          res.status(400).json({ valid: false, error: 'This invitation has expired.' });
          return;
        }

        // 2. Revocation check
        if (inv.revoked_at) {
          res.status(400).json({ valid: false, error: 'This invitation has been revoked.' });
          return;
        }

        // 3. Reusability / Single-use consumption check
        if (!inv.is_reusable && inv.accepted_at) {
          res.status(409).json({ valid: false, error: 'This invitation has already been used.' });
          return;
        }

        // 4. Room lifecycle check
        if (isTerminalRoom({ status: inv.status, isPermanent: inv.isPermanent })) {
          res.status(400).json({ valid: false, error: 'This room has ended or expired.' });
          return;
        }

        // 5. Targeted recipient authorization check
        if (inv.target_user_id && inv.target_user_id !== callerUid) {
          res.status(403).json({ valid: false, error: 'This invitation is intended for another user.' });
          return;
        }

        // 6. Host status for capacity and lock bypass
        const isOwner = Boolean(inv.owner_id && callerUid === inv.owner_id);
        let isHost = isOwner;
        const memoryRoom = memoryRooms ? memoryRooms.get(inv.room_id) : (roomLookup ? roomLookup(inv.room_id) : undefined);
        if (memoryRoom && callerUid) {
          if (typeof memoryRoom.isHostUid === 'function') {
            isHost = isHost || memoryRoom.isHostUid(callerUid);
          } else if (memoryRoom.currentHostUid) {
            isHost = isHost || memoryRoom.currentHostUid === callerUid;
          }
        }

        // 7. Participant lock check
        if (inv.participants_locked && !isHost) {
          res.status(403).json({
            valid: false,
            error: 'This room is currently locked to new participants.',
            code: 'PARTICIPANTS_LOCKED',
          });
          return;
        }

        // 8. Capacity check
        if (memoryRoom && !isHost) {
          if (typeof inv.max_participants === 'number') {
            memoryRoom.maxParticipants = inv.max_participants;
          }
          if (typeof memoryRoom.isRoomFull === 'function' && memoryRoom.isRoomFull(isHost)) {
            res.status(403).json({
              valid: false,
              error: 'This room has reached its participant limit.',
              code: 'ROOM_FULL',
            });
            return;
          }
        }

        // 9. Consume single-use invitation or record acceptance
        await pool.query(
          `UPDATE public.room_invitations
           SET accepted_at = now(), accepted_by_user_id = $1
           WHERE id = $2`,
          [callerUid, inv.id],
        );

        // 10. Issue cryptographic admission token
        const admissionToken = generateAdmissionToken({
          roomId: inv.room_id,
          userId: callerUid,
          sessionId: cleanSessionId,
          ttlSeconds: 900,
        });

        res.json({
          valid: true,
          roomId: inv.room_id,
          admissionToken,
          sessionId: cleanSessionId,
        });
      } catch (err) {
        console.error('Error accepting invitation:', err);
        res.status(500).json({ valid: false, error: 'Server error accepting invitation.' });
      }
    }),
  );

  // -------------------------------------------------------------------------
  // POST /api/invitations/accept-target
  // Admission for targeted user via notification ID without bearer token in notification
  // -------------------------------------------------------------------------
  router.post(
    '/accept-target',
    requireAuth(async (req, res, callerUid) => {
      const { invitationId, sessionId } = req.body || {};

      if (!invitationId || typeof invitationId !== 'string') {
        res.status(400).json({ valid: false, error: 'Missing invitationId' });
        return;
      }

      if (!pool) {
        res.status(503).json({ valid: false, error: 'Database service unavailable' });
        return;
      }

      const cleanSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : crypto.randomUUID();

      try {
        const result = await pool.query(
          `SELECT i.id, i.room_id, i.inviter_id, i.target_user_id, i.expires_at, i.revoked_at,
                  i.accepted_at, i.is_reusable,
                  r."roomTitle", r.status, r."isPermanent", r.owner_id, r.participants_locked, r.max_participants
           FROM public.room_invitations i
           JOIN public.rooms r ON r."roomId" = i.room_id
           WHERE i.id = $1`,
          [invitationId],
        );

        if (!result.rows || result.rows.length === 0) {
          res.status(404).json({ valid: false, error: 'Invitation not found' });
          return;
        }

        const inv = result.rows[0];

        // Target user authorization
        if (inv.target_user_id && inv.target_user_id !== callerUid) {
          res.status(403).json({ valid: false, error: 'This invitation was addressed to another user.' });
          return;
        }

        if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
          res.status(400).json({ valid: false, error: 'This invitation has expired.' });
          return;
        }
        if (inv.revoked_at) {
          res.status(400).json({ valid: false, error: 'This invitation has been revoked.' });
          return;
        }
        if (isTerminalRoom({ status: inv.status, isPermanent: inv.isPermanent })) {
          res.status(400).json({ valid: false, error: 'This room has ended or expired.' });
          return;
        }

        // Host check for locks/capacity
        const isOwner = Boolean(inv.owner_id && callerUid === inv.owner_id);
        let isHost = isOwner;
        const memoryRoom = memoryRooms ? memoryRooms.get(inv.room_id) : (roomLookup ? roomLookup(inv.room_id) : undefined);
        if (memoryRoom && callerUid) {
          if (typeof memoryRoom.isHostUid === 'function') {
            isHost = isHost || memoryRoom.isHostUid(callerUid);
          } else if (memoryRoom.currentHostUid) {
            isHost = isHost || memoryRoom.currentHostUid === callerUid;
          }
        }

        if (inv.participants_locked && !isHost) {
          res.status(403).json({
            valid: false,
            error: 'This room is currently locked to new participants.',
            code: 'PARTICIPANTS_LOCKED',
          });
          return;
        }

        if (memoryRoom && !isHost) {
          if (typeof inv.max_participants === 'number') {
            memoryRoom.maxParticipants = inv.max_participants;
          }
          if (typeof memoryRoom.isRoomFull === 'function' && memoryRoom.isRoomFull(isHost)) {
            res.status(403).json({
              valid: false,
              error: 'This room has reached its participant limit.',
              code: 'ROOM_FULL',
            });
            return;
          }
        }

        // Mark accepted
        await pool.query(
          `UPDATE public.room_invitations
           SET accepted_at = now(), accepted_by_user_id = $1
           WHERE id = $2`,
          [callerUid, inv.id],
        );

        const admissionToken = generateAdmissionToken({
          roomId: inv.room_id,
          userId: callerUid,
          sessionId: cleanSessionId,
          ttlSeconds: 900,
        });

        res.json({
          valid: true,
          roomId: inv.room_id,
          admissionToken,
          sessionId: cleanSessionId,
        });
      } catch (err) {
        console.error('Error accepting target invitation:', err);
        res.status(500).json({ valid: false, error: 'Server error accepting invitation.' });
      }
    }),
  );

  // -------------------------------------------------------------------------
  // POST /api/invitations/:id/revoke
  // Host or Owner revokes an invitation
  // -------------------------------------------------------------------------
  router.post(
    '/:id/revoke',
    requireAuth(async (req, res, callerUid) => {
      const invId = req.params.id;
      if (!invId || typeof invId !== 'string') {
        res.status(400).json({ error: 'Valid invitation ID is required' });
        return;
      }

      if (!pool) {
        res.status(503).json({ error: 'Database service unavailable' });
        return;
      }

      const invRes = await pool.query(
        `SELECT i.id, i.room_id, r.owner_id
         FROM public.room_invitations i
         JOIN public.rooms r ON r."roomId" = i.room_id
         WHERE i.id = $1`,
        [invId],
      );

      if (!invRes.rows || invRes.rows.length === 0) {
        res.status(404).json({ error: 'Invitation not found' });
        return;
      }

      const inv = invRes.rows[0];

      let isAuthorized = Boolean(inv.owner_id && inv.owner_id === callerUid);
      if (!isAuthorized && roomLookup) {
        const liveRoom = roomLookup(inv.room_id);
        if (liveRoom) {
          if (typeof liveRoom.isHostUid === 'function') {
            isAuthorized = liveRoom.isHostUid(callerUid);
          } else if (liveRoom.currentHostUid) {
            isAuthorized = liveRoom.currentHostUid === callerUid;
          }
        }
      }

      if (!isAuthorized) {
        res.status(403).json({ error: 'Only the room host or owner can revoke invitations' });
        return;
      }

      await pool.query(
        `UPDATE public.room_invitations
         SET revoked_at = now()
         WHERE id = $1`,
        [invId],
      );

      res.json({ success: true, message: 'Invitation revoked successfully' });
    }),
  );

  return router;
}
