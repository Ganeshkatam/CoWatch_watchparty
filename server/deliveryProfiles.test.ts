import { resolveDeliveryProfile, type DeliveryProfileId } from './notifications/deliveryProfiles.ts';
import { NotificationType, NOTIFICATION_TYPES } from './notifications/notificationTypes.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[DeliveryProfilesTest] ' + message);
}

const validProfiles = new Set<DeliveryProfileId>([
  'transactional_default',
  'transactional_security',
  'transactional_invitation',
  'transactional_system',
]);

for (const type of NOTIFICATION_TYPES) {
  assert(validProfiles.has(resolveDeliveryProfile(type)), 'Invalid profile for notification type ' + type);
}
assert(resolveDeliveryProfile(NotificationType.ROOM_INVITATION) === 'transactional_invitation', 'Invitation mapping');
assert(resolveDeliveryProfile(NotificationType.ROOM_STARTED) === 'transactional_invitation', 'Room started mapping');
assert(resolveDeliveryProfile(NotificationType.MODERATION_ACTION) === 'transactional_security', 'Moderation mapping');
assert(resolveDeliveryProfile(NotificationType.SYSTEM_ANNOUNCEMENT) === 'transactional_system', 'Announcement mapping');

console.log('CoWatch notification-to-delivery-profile policy tests passed.');
