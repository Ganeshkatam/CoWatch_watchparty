/**
 * NOTIFY-001 Notification Repository
 *
 * Low-level database access layer. Contains ONLY raw SQL queries.
 * No business logic, no policy decisions, no socket operations.
 *
 * All queries run through the existing postgres Pool.
 */

import { postgres } from '../utils/postgres.ts';
import { transaction } from '../db.ts';
import type {
  Notification,
  NotificationPreferences,
  EmailOutboxRow,
  NotificationType,
} from './notificationTypes.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsertNotificationParams {
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  event_id: string;
  expires_at?: Date | null;
}

export interface InsertEmailOutboxParams {
  notification_id: string | null;
  user_id: string;
  template_key: string;
  delivery_profile?: string;
  recipient_email: string;
  payload: Record<string, unknown>;
  provider_idempotency_key: string;
}

export interface ListRecentParams {
  user_id: string;
  limit: number;
  before_id?: string; // cursor: UUID of the last notification on previous page
}

export interface UpsertPreferencesParams {
  user_id: string;
  email_enabled?: boolean;
  room_invitations?: boolean;
  room_events?: boolean;
  moderation_events?: boolean;
  system_announcements?: boolean;
}

// ---------------------------------------------------------------------------
// Notification queries
// ---------------------------------------------------------------------------

/**
 * Insert a notification row. On conflict on (user_id, event_id, type) — idempotent
 * skip (DO NOTHING). Returns the notification if newly inserted, or null if it was
 * a duplicate (idempotency hit).
 */
export async function insertNotification(
  params: InsertNotificationParams,
): Promise<Notification | null> {
  if (!postgres) throw new Error('Database pool unavailable');

  const { rows } = await postgres.query<Notification>(
    `INSERT INTO public.notifications
       (user_id, type, title, body, metadata, event_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, event_id, type) DO NOTHING
     RETURNING *`,
    [
      params.user_id,
      params.type,
      params.title,
      params.body,
      JSON.stringify(params.metadata ?? {}),
      params.event_id,
      params.expires_at ?? null,
    ],
  );

  return rows[0] ?? null;
}

/**
 * Atomically insert both a notification and its outbox row inside a single
 * transaction. If the notification is a duplicate (idempotency hit), neither
 * row is inserted. Returns { notification, outboxRow } or null on duplicate.
 */
export async function insertNotificationWithOutbox(
  notifParams: InsertNotificationParams,
  outboxParams: Omit<InsertEmailOutboxParams, 'notification_id'>,
): Promise<{ notification: Notification; outboxRow: EmailOutboxRow } | null> {
  if (!postgres) throw new Error('Database pool unavailable');

  return transaction(postgres, async (tx) => {
    const { rows: notifRows } = await tx.query<Notification>(
      `INSERT INTO public.notifications
         (user_id, type, title, body, metadata, event_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, event_id, type) DO NOTHING
       RETURNING *`,
      [
        notifParams.user_id,
        notifParams.type,
        notifParams.title,
        notifParams.body,
        JSON.stringify(notifParams.metadata ?? {}),
        notifParams.event_id,
        notifParams.expires_at ?? null,
      ],
    );

    if (notifRows.length === 0) {
      // Idempotency hit — no insertion performed
      return null;
    }

    const notification = notifRows[0];

    const { rows: outboxRows } = await tx.query<EmailOutboxRow>(
      `INSERT INTO public.email_outbox
         (notification_id, user_id, template_key, delivery_profile, recipient_email, payload, provider_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (provider_idempotency_key) DO NOTHING
       RETURNING *`,
      [
        notification.id,
        outboxParams.user_id,
        outboxParams.template_key,
        outboxParams.delivery_profile || 'transactional_default',
        outboxParams.recipient_email,
        JSON.stringify(outboxParams.payload),
        outboxParams.provider_idempotency_key,
      ],
    );

    return {
      notification,
      outboxRow: outboxRows[0],
    };
  });
}

/**
 * List recent notifications for a user (newest first), with cursor-based pagination.
 */
export async function listRecentNotifications(
  params: ListRecentParams,
): Promise<Notification[]> {
  if (!postgres) throw new Error('Database pool unavailable');

  if (params.before_id) {
    const { rows } = await postgres.query<Notification>(
      `SELECT * FROM public.notifications
       WHERE user_id = $1
         AND (expires_at IS NULL OR expires_at > now())
         AND created_at < (
           SELECT created_at FROM public.notifications WHERE id = $2
         )
       ORDER BY created_at DESC
       LIMIT $3`,
      [params.user_id, params.before_id, params.limit],
    );
    return rows;
  }

  const { rows } = await postgres.query<Notification>(
    `SELECT * FROM public.notifications
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT $2`,
    [params.user_id, params.limit],
  );
  return rows;
}

/**
 * Get unread count for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  if (!postgres) throw new Error('Database pool unavailable');

  const { rows } = await postgres.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM public.notifications
     WHERE user_id = $1
       AND read_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Mark a single notification read. Returns true if row was updated.
 * Validates ownership server-side (not via RLS since we run as service_role).
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  if (!postgres) throw new Error('Database pool unavailable');

  const { rowCount } = await postgres.query(
    `UPDATE public.notifications
     SET read_at = clock_timestamp()
     WHERE id = $1
       AND user_id = $2
       AND read_at IS NULL`,
    [notificationId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Mark all unread notifications read for a user. Returns count updated.
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  if (!postgres) throw new Error('Database pool unavailable');

  const { rowCount } = await postgres.query(
    `UPDATE public.notifications
     SET read_at = clock_timestamp()
     WHERE user_id = $1
       AND read_at IS NULL`,
    [userId],
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Notification Preferences queries
// ---------------------------------------------------------------------------

/**
 * Get preferences for a user. Returns null if not yet provisioned.
 */
export async function getPreferences(
  userId: string,
): Promise<NotificationPreferences | null> {
  if (!postgres) throw new Error('Database pool unavailable');

  const { rows } = await postgres.query<NotificationPreferences>(
    `SELECT * FROM public.notification_preferences WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Upsert notification preferences for a user. Only updates provided fields.
 */
export async function upsertPreferences(
  params: UpsertPreferencesParams,
): Promise<NotificationPreferences> {
  if (!postgres) throw new Error('Database pool unavailable');

  // Build dynamic SET clause from provided keys only
  const updates: string[] = [];
  const values: unknown[] = [params.user_id];
  let idx = 2;

  if (params.email_enabled !== undefined) {
    updates.push(`email_enabled = $${idx++}`);
    values.push(params.email_enabled);
  }
  if (params.room_invitations !== undefined) {
    updates.push(`room_invitations = $${idx++}`);
    values.push(params.room_invitations);
  }
  if (params.room_events !== undefined) {
    updates.push(`room_events = $${idx++}`);
    values.push(params.room_events);
  }
  if (params.moderation_events !== undefined) {
    updates.push(`moderation_events = $${idx++}`);
    values.push(params.moderation_events);
  }
  if (params.system_announcements !== undefined) {
    updates.push(`system_announcements = $${idx++}`);
    values.push(params.system_announcements);
  }

  if (updates.length === 0) {
    // Nothing to update; return existing row
    const existing = await getPreferences(params.user_id);
    if (existing) return existing;
    // Provision defaults if missing
    await postgres.query(
      `INSERT INTO public.notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [params.user_id],
    );
    return (await getPreferences(params.user_id))!;
  }

  updates.push(`updated_at = clock_timestamp()`);

  const { rows } = await postgres.query<NotificationPreferences>(
    `UPDATE public.notification_preferences
     SET ${updates.join(', ')}
     WHERE user_id = $1
     RETURNING *`,
    values,
  );

  if (rows.length === 0) {
    // Row not yet provisioned — insert with requested values then re-read
    await postgres.query(
      `INSERT INTO public.notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [params.user_id],
    );
    return upsertPreferences(params);
  }

  return rows[0];
}
