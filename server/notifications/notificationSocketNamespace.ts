/**
 * NOTIFY-001 Notification Socket Namespace
 *
 * Manages the /notifications Socket.IO namespace.
 *
 * Security invariants:
 *   - Credentials MUST be provided in Socket.IO handshake auth object: { token: string }
 *   - Query-string credentials are explicitly rejected.
 *   - The JWT is validated server-side via supabaseAdmin.auth.getUser(token).
 *   - socket.data.uid is set ONLY from the verified JWT subject (never from client data).
 *   - Sockets are joined to room "user:{uid}" for targeted emission.
 *
 * Socket.IO is best-effort realtime acceleration only.
 * PostgreSQL + REST is the durable source of truth.
 */

import type { Server, Socket } from 'socket.io';
import { supabaseAdmin } from '../utils/supabase.ts';

// Augment socket data type
interface NotificationSocketData {
  uid: string;
}

let notificationIo: Server | null = null;

/**
 * Register the /notifications namespace on the given Socket.IO server.
 * Must be called once during server initialization.
 */
export function registerNotificationNamespace(io: Server): void {
  const nsp = io.of('/notifications');

  // -------------------------------------------------------------------------
  // Authentication middleware — runs before any connection event
  // -------------------------------------------------------------------------
  nsp.use(async (socket, next) => {
    try {
      // ENFORCE: credentials must be in auth object, NOT query string
      const queryToken = (socket.handshake.query as Record<string, string>)?.token;
      if (queryToken) {
        return next(new Error('CREDENTIALS_IN_QUERY_REJECTED: Use handshake auth.token'));
      }

      const token = (socket.handshake.auth as Record<string, string>)?.token;
      if (!token || typeof token !== 'string' || token.trim() === '') {
        return next(new Error('AUTH_MISSING: Provide token in socket handshake auth object'));
      }

      if (!supabaseAdmin) {
        return next(new Error('AUTH_UNAVAILABLE'));
      }

      // Validate JWT via Supabase Auth (server-side cryptographic verification)
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user) {
        return next(new Error('AUTH_INVALID: JWT verification failed'));
      }

      if (!user.email_confirmed_at) {
        return next(new Error('AUTH_EMAIL_NOT_VERIFIED'));
      }

      // INVARIANT: socket.data.uid === verified JWT subject
      (socket.data as NotificationSocketData).uid = user.id;

      next();
    } catch (err) {
      console.error('[notifications] Socket auth error:', err);
      next(new Error('AUTH_ERROR'));
    }
  });

  // -------------------------------------------------------------------------
  // Connection handler
  // -------------------------------------------------------------------------
  nsp.on('connection', (socket: Socket) => {
    const uid = (socket.data as NotificationSocketData).uid;

    // Join the per-user room so the service can target this socket
    socket.join(`user:${uid}`);

    socket.on('disconnect', () => {
      // No cleanup needed — socket.io removes the socket from rooms automatically
    });
  });

  // Retain reference so notificationService can emit into the namespace
  notificationIo = io;

  console.log('[notifications] /notifications Socket.IO namespace registered');
}

/**
 * Emit a notification:created event to a specific user's sockets.
 * Fire-and-forget; failures are logged but not thrown.
 */
export function emitNotificationCreated(
  io: Server,
  userId: string,
  notification: object,
): void {
  try {
    io.of('/notifications').to(`user:${userId}`).emit('notification:created', notification);
  } catch (err) {
    console.error(`[notifications] Failed to emit notification:created for user ${userId}:`, err);
  }
}

/**
 * Emit a notification:read event to a specific user's sockets.
 * Fire-and-forget.
 */
export function emitNotificationRead(
  io: Server,
  userId: string,
  notificationId: string,
): void {
  try {
    io.of('/notifications').to(`user:${userId}`).emit('notification:read', { id: notificationId });
  } catch (err) {
    console.error(`[notifications] Failed to emit notification:read for user ${userId}:`, err);
  }
}

/**
 * Emit a notification:read_all event to a specific user's sockets.
 * Fire-and-forget.
 */
export function emitNotificationsReadAll(io: Server, userId: string): void {
  try {
    io.of('/notifications').to(`user:${userId}`).emit('notification:read_all');
  } catch (err) {
    console.error(`[notifications] Failed to emit notification:read_all for user ${userId}:`, err);
  }
}
