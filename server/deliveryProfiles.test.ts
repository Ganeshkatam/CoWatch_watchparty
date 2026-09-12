/**
 * NOTIFY-004 Delivery Profiles & Provider Bindings Test Suite
 *
 * Verifies:
 * 1. NotificationType -> DeliveryProfile mapping
 * 2. Canonical profile contracts
 * 3. ProviderRegistry profile resolution
 * 4. Idempotency capability separation
 */

import {
  resolveDeliveryProfile,
  getDeliveryProfile,
  type DeliveryProfileId,
} from './notifications/deliveryProfiles.ts';
import { NotificationType, NOTIFICATION_TYPES } from './notifications/notificationTypes.ts';
import { EmailProviderRegistry } from './notifications/emailProviderRegistry.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[DeliveryProfilesTest] Assertion Failed: ${message}`);
  }
}

async function runDeliveryProfileTests() {
  console.log('=== NOTIFY-004 Delivery Profiles & Bindings Test Suite ===\n');

  console.log('Case 1: Mapping all canonical NotificationTypes to DeliveryProfileIds...');
  const validProfiles = new Set<DeliveryProfileId>([
    'transactional_default',
    'transactional_security',
    'transactional_invitation',
    'transactional_system',
  ]);

  for (const type of NOTIFICATION_TYPES) {
    const profile = resolveDeliveryProfile(type);
    assert(validProfiles.has(profile), `NotificationType ${type} must map to a valid DeliveryProfileId`);
  }
  console.log('  PASS: All canonical NotificationTypes map deterministically to valid DeliveryProfileIds');

  console.log('Case 2: Purpose-specific profile categorization...');
  assert(
    resolveDeliveryProfile(NotificationType.ROOM_INVITATION) === 'transactional_invitation',
    'ROOM_INVITATION must map to transactional_invitation',
  );
  assert(
    resolveDeliveryProfile(NotificationType.ROOM_STARTED) === 'transactional_invitation',
    'ROOM_STARTED must map to transactional_invitation',
  );
  assert(
    resolveDeliveryProfile(NotificationType.MODERATION_ACTION) === 'transactional_security',
    'MODERATION_ACTION must map to transactional_security',
  );
  assert(
    resolveDeliveryProfile(NotificationType.VBROWSER_FAILURE) === 'transactional_security',
    'VBROWSER_FAILURE must map to transactional_security',
  );
  assert(
    resolveDeliveryProfile(NotificationType.SYSTEM_ANNOUNCEMENT) === 'transactional_system',
    'SYSTEM_ANNOUNCEMENT must map to transactional_system',
  );
  console.log('  PASS: Domain notifications categorized into pure purpose profiles');

  console.log('Case 3: Profile contracts and capability requirements...');
  const profiles: DeliveryProfileId[] = [
    'transactional_default',
    'transactional_security',
    'transactional_invitation',
    'transactional_system',
  ];

  for (const p of profiles) {
    const contract = getDeliveryProfile(p);
    assert(contract.id === p, `Contract ID must match requested profile ${p}`);
    assert(Boolean(contract.fromAddress), `Profile ${p} must have a non-empty fromAddress`);
    assert(['HIGH', 'NORMAL', 'LOW'].includes(contract.priority), `Profile ${p} must have a valid priority`);
    assert(contract.requiredCapabilities.transactionalSending === true, `Profile ${p} must require transactionalSending`);
  }
  console.log('  PASS: All profile contracts satisfy non-empty sender and priority invariants');

  console.log('Case 4: Registry profile resolution & idempotency separation...');
  const provider = EmailProviderRegistry.getProviderForProfile('transactional_invitation');
  assert(Boolean(provider && provider.name), 'Provider must be resolved for profile');

  const smtpProvider = EmailProviderRegistry.getProvider('smtp');
  assert(smtpProvider.capabilities.nativeIdempotency === false, 'SMTP must declare nativeIdempotency: false');

  const brevoProvider = EmailProviderRegistry.getProvider('brevo');
  assert(brevoProvider.capabilities.nativeIdempotency === false, 'Brevo must declare nativeIdempotency: false');

  const resendProvider = EmailProviderRegistry.getProvider('resend');
  assert(resendProvider.capabilities.nativeIdempotency === true, 'Resend must declare nativeIdempotency: true');
  console.log('  PASS: Provider idempotency declared and decoupled from application idempotency');

  console.log('\nAll NOTIFY-004 Delivery Profile tests PASSED successfully!\n');
}

runDeliveryProfileTests().catch((err) => {
  console.error('\nDelivery profile tests failed:', err);
  process.exit(1);
});
