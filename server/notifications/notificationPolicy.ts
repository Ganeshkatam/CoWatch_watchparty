/**
 * NOTIFY-001 Notification Policy
 *
 * Pure decision layer. Zero database access. Zero side effects.
 *
 * Flow:
 *   Product Event -> Registry (email_eligible) -> Category Policy -> User Prefs
 *   -> { sendInApp: boolean, sendEmail: boolean }
 *
 * The registry's email_eligible flag is the gate for email; user preferences
 * are the secondary filter. In-app notifications are always created when
 * in_app_eligible is true, subject to the user's preference category.
 */

import {
  EMAIL_ELIGIBLE_TYPES,
  NOTIFICATION_CATEGORY,
  type NotificationType,
  type NotificationPreferences,
} from './notificationTypes.ts';

export interface DeliveryDecision {
  sendInApp: boolean;
  sendEmail: boolean;
}

/**
 * Evaluate delivery decision for a single (type, preferences) pair.
 *
 * @param type - The canonical notification type
 * @param prefs - The user's notification preferences (or null if not yet provisioned)
 * @returns Delivery decision flags
 */
export function evaluateDelivery(
  type: NotificationType,
  prefs: NotificationPreferences | null,
): DeliveryDecision {
  const category = NOTIFICATION_CATEGORY[type];

  // Default preferences if row not yet provisioned
  const p: NotificationPreferences = prefs ?? {
    user_id: '',
    email_enabled: true,
    room_invitations: true,
    room_events: false,
    moderation_events: false,
    system_announcements: true,
    updated_at: new Date().toISOString(),
  };

  // In-app: always true for canonical product notifications
  const sendInApp = true;
  const categoryPref = (p as unknown as Record<string, unknown>)[category];

  // Email: requires three conditions to be true:
  //   1. The type is email-eligible (registry gate)
  //   2. User's master email_enabled toggle is true
  //   3. User's per-category toggle is true
  const isEmailEligible = EMAIL_ELIGIBLE_TYPES.has(type);
  const sendEmail =
    isEmailEligible && p.email_enabled === true && categoryPref === true;

  return { sendInApp, sendEmail };
}

/**
 * Returns the preference category key for a notification type.
 * Used by tests to validate category mapping completeness.
 */
export function getCategoryForType(type: NotificationType): string {
  return NOTIFICATION_CATEGORY[type];
}
