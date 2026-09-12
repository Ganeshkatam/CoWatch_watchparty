/**
 * NOTIFY-001 Canonical Notification Types
 *
 * This file is the TypeScript authority for notification types.
 * It MUST stay in sync with `public.notification_type_registry` in the database.
 *
 * The consistency CI test (`notificationConsistency.test.ts`) enforces that:
 *   1. Every DB type exists here as a key.
 *   2. Every key here exists in the DB.
 *   3. email_eligible flags match.
 *   4. Every email-eligible type has a corresponding template in emailTemplates.ts.
 */

export const NotificationType = {
  ROOM_INVITATION:     'ROOM_INVITATION',
  ROOM_HOST_TRANSFER:  'ROOM_HOST_TRANSFER',
  ROOM_STARTED:        'ROOM_STARTED',
  ROOM_ENDING:         'ROOM_ENDING',
  ROOM_ENDED:          'ROOM_ENDED',
  MODERATION_ACTION:   'MODERATION_ACTION',
  VBROWSER_FAILURE:    'VBROWSER_FAILURE',
  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
} as const;

export type NotificationType = typeof NotificationType[keyof typeof NotificationType];

export const NOTIFICATION_TYPES = Object.values(NotificationType) as readonly NotificationType[];

/**
 * Types that are eligible for email delivery.
 * Must match `email_eligible = true` rows in notification_type_registry.
 * Enforced by CI test.
 */
export const EMAIL_ELIGIBLE_TYPES = new Set<NotificationType>([
  NotificationType.ROOM_INVITATION,
  NotificationType.ROOM_STARTED,
  NotificationType.SYSTEM_ANNOUNCEMENT,
]);

export type EmailEligibleType = 'ROOM_INVITATION' | 'ROOM_STARTED' | 'SYSTEM_ANNOUNCEMENT';

/**
 * Category mapping: notification type -> preference category key.
 * Used by notificationPolicy.ts to evaluate user preference toggles.
 */
export const NOTIFICATION_CATEGORY: Record<NotificationType, string> = {
  ROOM_INVITATION:     'room_invitations',
  ROOM_HOST_TRANSFER:  'room_events',
  ROOM_STARTED:        'room_events',
  ROOM_ENDING:         'room_events',
  ROOM_ENDED:          'room_events',
  MODERATION_ACTION:   'moderation_events',
  VBROWSER_FAILURE:    'system_announcements',
  SYSTEM_ANNOUNCEMENT: 'system_announcements',
};

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  expires_at: string | null;
  event_id: string;
}

export interface NotificationPreferences {
  user_id: string;
  email_enabled: boolean;
  room_invitations: boolean;
  room_events: boolean;
  moderation_events: boolean;
  system_announcements: boolean;
  updated_at: string;
}

export type ProviderDeliveryStatus =
  | 'SENT'
  | 'DELIVERED'
  | 'DELIVERY_DELAYED'
  | 'BOUNCED'
  | 'COMPLAINED';

export interface EmailOutboxRow {
  id: string;
  notification_id: string | null;
  user_id: string;
  template_key: string;
  recipient_email: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'FAILED' | 'CANCELLED';
  provider_delivery_status?: ProviderDeliveryStatus | null;
  attempt_count: number;
  available_at: string;
  last_attempt_at: string | null;
  sent_at: string | null;
  delivered_at?: string | null;
  bounced_at?: string | null;
  complained_at?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  provider_message_id: string | null;
  provider_idempotency_key: string | null;
  last_error_code: string | null;
  provider?: string | null;
  provider_metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
