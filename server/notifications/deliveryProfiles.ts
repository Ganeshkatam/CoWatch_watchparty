/**
 * Domain policy mapping: NotificationType -> delivery profile.
 * Provider configuration and sender identity live only in the remote email service.
 */
import { NotificationType } from './notificationTypes.ts';

export type DeliveryProfileId =
  | 'transactional_default'
  | 'transactional_security'
  | 'transactional_invitation'
  | 'transactional_system';

export function resolveDeliveryProfile(type: NotificationType): DeliveryProfileId {
  switch (type) {
    case NotificationType.ROOM_INVITATION:
    case NotificationType.ROOM_STARTED:
      return 'transactional_invitation';
    case NotificationType.MODERATION_ACTION:
      return 'transactional_security';
    case NotificationType.SYSTEM_ANNOUNCEMENT:
      return 'transactional_system';
    default:
      return 'transactional_default';
  }
}
