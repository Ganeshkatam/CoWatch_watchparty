/**
 * NOTIFY-001 Notification Service
 *
 * The ONLY entry point for creating notifications anywhere in the server codebase.
 *
 * Principles:
 *   - Product events call this service; it owns all delivery decisions.
 *   - PostgreSQL is the durable source of truth; Socket.IO is best-effort realtime.
 *   - Idempotency is enforced via UNIQUE (user_id, event_id, type) at DB level.
 *   - recipient_email is ALWAYS resolved server-side from auth; never from caller payload.
 *   - All notification calls in room.ts/server.ts are fire-and-forget with error logging.
 */

import type { Server } from 'socket.io';
import {
  insertNotification,
  insertNotificationWithOutbox,
  getPreferences,
} from './notificationRepository.ts';
import { evaluateDelivery } from './notificationPolicy.ts';
import {
  EMAIL_ELIGIBLE_TYPES,
  type NotificationType,
  type Notification,
} from './notificationTypes.ts';
import {
  emitNotificationCreated,
} from './notificationSocketNamespace.ts';
import { getUserEmail } from '../utils/supabase.ts';
import { resolveDeliveryProfile } from './deliveryProfiles.ts';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface NotifyUserParams {
  /** Target user's ID */
  userId: string;
  /** Canonical notification type */
  type: NotificationType;
  /** Notification title (short, display-safe) */
  title: string;
  /** Notification body */
  body: string;
  /** Optional metadata (room ID, etc.) */
  metadata?: Record<string, unknown>;
  /**
   * Deterministic event ID for idempotency.
   * Pattern: "{TYPE}:{subjectId}:{discriminator}"
   * Example: "ROOM_ENDING:abc123:1726123456"
   * Use empty string only for one-off system announcements.
   */
  eventId: string;
  /** Optional expiry for ephemeral notifications */
  expiresAt?: Date | null;
  /**
   * Email template to use if email delivery is triggered.
   * Required only for email-eligible types.
   */
  emailTemplateKey?: string;
  /** Template payload variables (server-resolved only) */
  emailPayload?: Record<string, unknown>;
}

export interface NotifyRoomParticipantsParams {
  /** Room ID whose participants should be notified */
  roomId: string;
  /** Owner ID to look up room participants from (server resolves full list) */
  ownerUserId: string;
  /** IDs of participants to notify (empty = notify all) */
  participantUserIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  eventIdPrefix: string; // e.g. "ROOM_ENDED:{roomId}" — suffix ":$userId" appended per user
  emailTemplateKey?: string;
  emailPayload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the provider idempotency key for the email outbox row */
function buildProviderIdempotencyKey(
  userId: string,
  eventId: string,
  type: NotificationType,
): string {
  return `notify:${type}:${userId}:${eventId}`;
}

// ---------------------------------------------------------------------------
// NotificationService class
// ---------------------------------------------------------------------------

export class NotificationService {
  private io: Server | null;

  constructor(io: Server | null = null) {
    this.io = io;
  }

  /**
   * Attach (or replace) the Socket.IO server for realtime delivery.
   * Called after the server is initialized.
   */
  setIo(io: Server): void {
    this.io = io;
  }

  /**
   * Send a notification to a single user.
   *
   * Flow:
   *   1. Resolve user preferences (DB) — fall back to policy defaults if not provisioned
   *   2. Apply delivery policy: { sendInApp, sendEmail }
   *   3. If sendInApp: atomic INSERT with idempotency guard
   *   4. If sendEmail: atomic INSERT notifications + email_outbox in same transaction
   *   5. Emit realtime event (best-effort, never throws)
   */
  async notifyUser(params: NotifyUserParams): Promise<Notification | null> {
    try {
      const prefs = await getPreferences(params.userId).catch(() => null);
      const { sendInApp, sendEmail } = evaluateDelivery(params.type, prefs);

      if (!sendInApp && !sendEmail) {
        return null;
      }

      let notification: Notification | null = null;

      if (sendEmail && EMAIL_ELIGIBLE_TYPES.has(params.type)) {
        // Resolve recipient email server-side ALWAYS — never from caller
        const recipientEmail = await getUserEmail(params.userId);
        if (!recipientEmail) {
          console.warn(
            `[NotificationService] Could not resolve email for user ${params.userId}, sending in-app only`,
          );
          // Fall through to in-app only
          notification = await this._insertInAppOnly(params);
        } else {
          const templateKey = params.emailTemplateKey ?? params.type.toLowerCase().replace(/_/g, '-');
          const deliveryProfile = resolveDeliveryProfile(params.type);
          const providerKey = buildProviderIdempotencyKey(
            params.userId,
            params.eventId,
            params.type,
          );
          const result = await insertNotificationWithOutbox(
            {
              user_id: params.userId,
              type: params.type,
              title: params.title,
              body: params.body,
              metadata: params.metadata,
              event_id: params.eventId,
              expires_at: params.expiresAt,
            },
            {
              user_id: params.userId,
              template_key: templateKey,
              delivery_profile: deliveryProfile,
              recipient_email: recipientEmail,
              payload: params.emailPayload ?? {},
              provider_idempotency_key: providerKey,
            },
          );
          notification = result?.notification ?? null;
        }
      } else if (sendInApp) {
        notification = await this._insertInAppOnly(params);
      }

      // Best-effort realtime delivery — never throws or blocks
      if (notification && this.io) {
        emitNotificationCreated(this.io, params.userId, notification);
      }

      return notification;
    } catch (err) {
      console.error('[NotificationService] notifyUser error:', err);
      return null;
    }
  }

  /**
   * Notify each of a set of participants individually.
   * Each participant gets their own notification row (per-user idempotency key).
   */
  async notifyRoomParticipants(params: NotifyRoomParticipantsParams): Promise<void> {
    const tasks = params.participantUserIds.map((userId) =>
      this.notifyUser({
        userId,
        type: params.type,
        title: params.title,
        body: params.body,
        metadata: { ...(params.metadata ?? {}), roomId: params.roomId },
        eventId: `${params.eventIdPrefix}:${userId}`,
        emailTemplateKey: params.emailTemplateKey,
        emailPayload: params.emailPayload,
      }).catch((err) =>
        console.error(
          `[NotificationService] notifyRoomParticipants failed for user ${userId}:`,
          err,
        ),
      ),
    );

    await Promise.allSettled(tasks);
  }

  private async _insertInAppOnly(params: NotifyUserParams): Promise<Notification | null> {
    return insertNotification({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata,
      event_id: params.eventId,
      expires_at: params.expiresAt,
    });
  }
}

// Singleton — wired up to the Socket.IO server in server.ts initialization
export const notificationService = new NotificationService();
