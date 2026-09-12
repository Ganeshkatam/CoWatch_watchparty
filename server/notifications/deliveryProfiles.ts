/**
 * NOTIFY-004 Delivery Profiles
 *
 * Provider-neutral delivery profile contracts.
 * Isolates domain notification events from email vendors and account bindings.
 */

import config from '../config.ts';
import { NotificationType } from './notificationTypes.ts';

export type DeliveryProfileId =
  | 'transactional_default'
  | 'transactional_security'
  | 'transactional_invitation'
  | 'transactional_system';

export interface EmailDeliveryProfile {
  readonly id: DeliveryProfileId;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly priority: 'HIGH' | 'NORMAL' | 'LOW';
  readonly requiredCapabilities: {
    readonly transactionalSending: boolean;
    readonly nativeIdempotency: boolean;
    readonly deliveryWebhooks?: boolean;
    readonly bounceEvents?: boolean;
  };
}

/**
 * Domain policy mapping: NotificationType -> DeliveryProfileId.
 * Pure domain logic: never references providers, accounts, or vendors.
 */
export function resolveDeliveryProfile(type: NotificationType): DeliveryProfileId {
  switch (type) {
    case NotificationType.ROOM_INVITATION:
    case NotificationType.ROOM_STARTED:
      return 'transactional_invitation';

    case NotificationType.MODERATION_ACTION:
    case NotificationType.VBROWSER_FAILURE:
      return 'transactional_security';

    case NotificationType.SYSTEM_ANNOUNCEMENT:
      return 'transactional_system';

    default:
      return 'transactional_default';
  }
}

/**
 * Resolve concrete profile configuration (sender identity, priority) from environment.
 */
export function getDeliveryProfile(profileId: string | DeliveryProfileId): EmailDeliveryProfile {
  const defaultFrom = config.EMAIL_FROM_ADDRESS || 'noreply@cowatch.tv';
  const defaultName = config.EMAIL_FROM_NAME || 'CoWatch';

  switch (profileId) {
    case 'transactional_invitation':
      return {
        id: 'transactional_invitation',
        fromAddress: config.EMAIL_PROFILE_INVITATION_SENDER || defaultFrom,
        fromName: defaultName ? `${defaultName} Invites` : undefined,
        priority: 'HIGH',
        requiredCapabilities: {
          transactionalSending: true,
          nativeIdempotency: false,
        },
      };

    case 'transactional_security':
      return {
        id: 'transactional_security',
        fromAddress: config.EMAIL_PROFILE_SECURITY_SENDER || defaultFrom,
        fromName: defaultName ? `${defaultName} Security` : undefined,
        priority: 'HIGH',
        requiredCapabilities: {
          transactionalSending: true,
          nativeIdempotency: false,
        },
      };

    case 'transactional_system':
      return {
        id: 'transactional_system',
        fromAddress: config.EMAIL_PROFILE_SYSTEM_SENDER || defaultFrom,
        fromName: defaultName ? `${defaultName} Updates` : undefined,
        priority: 'NORMAL',
        requiredCapabilities: {
          transactionalSending: true,
          nativeIdempotency: false,
        },
      };

    case 'transactional_default':
    default:
      return {
        id: 'transactional_default',
        fromAddress: defaultFrom,
        fromName: defaultName,
        priority: 'NORMAL',
        requiredCapabilities: {
          transactionalSending: true,
          nativeIdempotency: false,
        },
      };
  }
}
