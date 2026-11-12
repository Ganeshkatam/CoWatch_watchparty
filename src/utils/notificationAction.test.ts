/**
 * NOTIFY-003B Action Resolution & Security Sanitization Unit Tests
 */

import {
  resolveNotificationAction,
  sanitizeInternalNotificationUrl,
  sanitizeExternalNotificationUrl,
} from './notificationAction';
import type { NotificationItem } from '../components/Notifications/notificationTypes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ActionTest] Assertion Failed: ${message}`);
  }
}

function mockNotification(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'test-id',
    user_id: 'test-user',
    type: 'ROOM_INVITATION',
    title: 'Test Notification',
    body: 'Test Body',
    metadata: {},
    created_at: new Date().toISOString(),
    read_at: null,
    expires_at: null,
    event_id: 'test-event',
    ...overrides,
  };
}

async function runActionTests() {
  console.log('=== NOTIFY-003B Action Resolution Tests ===\n');

  // 1. Explicit metadata action takes absolute authority
  console.log('Case 1: Testing explicit metadata actions and /home normalization...');
  const explicitGoHome = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_INVITATION', // Even if type is invite, explicit go_home wins
      metadata: { action: 'go_home', targetUrl: '/home' },
    }),
  );
  assert(explicitGoHome.action === 'go_home', 'Explicit action must be go_home');
  assert(explicitGoHome.url === '/', 'Explicit /home must normalize to canonical /');
  assert(explicitGoHome.label === 'Go Home', 'Explicit label must be Go Home');

  const explicitOpenRoom = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { action: 'open_room', roomId: 'alpha-room' },
    }),
  );
  assert(explicitOpenRoom.action === 'open_room', 'Explicit action must be open_room');
  assert(explicitOpenRoom.url === '/watch/alpha-room', 'Explicit url must resolve room path');
  assert(explicitOpenRoom.label === 'Open Room', 'Explicit label must be Open Room');

  const explicitDismiss = resolveNotificationAction(
    mockNotification({
      metadata: { action: 'dismiss' },
    }),
  );
  assert(explicitDismiss.action === 'dismiss', 'Explicit action must be dismiss');
  assert(explicitDismiss.label === 'Dismiss', 'Explicit label must be Dismiss');
  console.log('  PASS: Explicit metadata actions take authority with canonical / resolution');

  // 2. Safety fallbacks for legacy/unversioned items
  console.log('Case 2: Testing safety fallbacks for legacy items...');
  const legacyEnded = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_ENDED',
      metadata: { roomId: 'expired-123' }, // Should NOT route to expired-123
    }),
  );
  assert(legacyEnded.action === 'go_home', 'ROOM_ENDED must fallback to go_home');
  assert(legacyEnded.url === '/', 'ROOM_ENDED must route to canonical /');

  const legacyKick = resolveNotificationAction(
    mockNotification({
      type: 'MODERATION_ACTION',
      metadata: { roomId: 'room-kicked-from' },
    }),
  );
  assert(legacyKick.action === 'go_home', 'MODERATION_ACTION must fallback to go_home');
  assert(legacyKick.url === '/', 'MODERATION_ACTION must route to canonical /');

  const legacyInvite = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_INVITATION',
      metadata: { roomId: 'party-777' },
    }),
  );
  assert(legacyInvite.action === 'join_room', 'ROOM_INVITATION must fallback to join_room');
  assert(legacyInvite.url === '/join/party-777', 'ROOM_INVITATION must route to room');
  assert(legacyInvite.label === 'Join Room', 'ROOM_INVITATION label must be Join Room');
  console.log('  PASS: Safety fallbacks route to canonical / and prevent navigating to dead or banned rooms');

  // 3. Fallback when roomId is completely missing
  console.log('Case 3: Testing fallback when roomId is missing...');
  const missingRoomInvite = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_INVITATION',
      metadata: {},
    }),
  );
  assert(missingRoomInvite.url === '/', 'Missing roomId must safely route to canonical /');
  console.log('  PASS: Missing roomId safely falls back to canonical /');

  // 4. Internal URL structural sanitization & legacy normalization
  console.log('Case 4: Testing structural URL sanitization and legacy route normalization...');
  assert(sanitizeInternalNotificationUrl('/home') === '/', '/home must resolve to /');
  assert(sanitizeInternalNotificationUrl('  /home  ') === '/', 'Whitespace around /home must be trimmed');
  assert(sanitizeInternalNotificationUrl('/home/') === '/', '/home/ trailing slash must normalize to /');
  assert(sanitizeInternalNotificationUrl('/home?ref=notify') === '/?ref=notify', '/home query must be preserved');
  assert(sanitizeInternalNotificationUrl('/home#rules') === '/#rules', '/home hash must be preserved');
  assert(sanitizeInternalNotificationUrl('/home/?tab=1') === '/?tab=1', '/home/ query must be preserved');
  assert(sanitizeInternalNotificationUrl('/room/party-123') === '/watch/party-123', 'Legacy /room/:id must normalize to /watch/:id');
  assert(sanitizeInternalNotificationUrl('/room/party-123?tab=chat#input') === '/watch/party-123?tab=chat#input', 'Legacy /room/:id query and hash must be preserved');
  assert(sanitizeInternalNotificationUrl('/watch/alpha') === '/watch/alpha', 'Valid /watch/:id route must be preserved');
  assert(sanitizeInternalNotificationUrl('/join/alpha') === '/join/alpha', 'Valid /join/:id route must be preserved');
  assert(sanitizeInternalNotificationUrl('/invite?invitationId=inv-99') === '/invite?invitationId=inv-99', 'Valid /invite route must be preserved');
  assert(sanitizeInternalNotificationUrl('/') === '/', 'Root / must remain /');
  assert(sanitizeInternalNotificationUrl('/?utm_source=app') === '/?utm_source=app', 'Root / query params must remain intact');
  assert(sanitizeInternalNotificationUrl(undefined) === '/', 'Undefined URL must return fallback /');
  assert(sanitizeInternalNotificationUrl('') === '/', 'Empty URL must return fallback /');
  console.log('  PASS: Structural URL sanitization and legacy route normalization verified');

  // 5. Security boundary & untrusted destination rejection
  console.log('Case 5: Testing security boundaries and open redirect prevention...');
  assert(sanitizeInternalNotificationUrl('//evil.com') === '/', 'Protocol-relative URL must be rejected');
  assert(sanitizeInternalNotificationUrl('https://evil.com') === '/', 'External HTTPS URL in internal action must be rejected');
  assert(sanitizeInternalNotificationUrl('http://evil.com/watch/abc') === '/', 'External HTTP URL in internal action must be rejected');
  assert(sanitizeInternalNotificationUrl('javascript:alert(1)') === '/', 'javascript: pseudo-protocol must be rejected');
  assert(sanitizeInternalNotificationUrl('data:text/html,<script>') === '/', 'data: URI must be rejected');
  assert(sanitizeInternalNotificationUrl('/\\evil.com') === '/', 'Backslash escape /\\ must be rejected');
  assert(sanitizeInternalNotificationUrl('\\\\evil.com') === '/', 'Backslash escape \\\\ must be rejected');
  assert(sanitizeInternalNotificationUrl('evil.com/watch/123') === '/', 'Missing leading slash must be rejected');
  assert(sanitizeInternalNotificationUrl('/unregistered-route-xyz') === '/', 'Unregistered path must be rejected');
  console.log('  PASS: All malicious schemes, backslash escapes, and external redirect vectors rejected');

  // 6. External announcement CTA link handling
  console.log('Case 6: Testing external announcement CTA URL sanitization...');
  assert(sanitizeExternalNotificationUrl('https://blog.cowatch.tomesphere.in') === 'https://blog.cowatch.tomesphere.in/', 'Valid external HTTPS CTA permitted');
  assert(sanitizeExternalNotificationUrl('/about') === '/about', 'Valid internal route CTA permitted');
  assert(sanitizeExternalNotificationUrl('javascript:alert(1)') === undefined, 'Malicious javascript: CTA rejected');
  assert(sanitizeExternalNotificationUrl('//evil.com') === undefined, 'Protocol-relative CTA rejected');
  assert(sanitizeExternalNotificationUrl('data:text/html,...') === undefined, 'data: CTA rejected');
  assert(sanitizeExternalNotificationUrl('/unknown-page') === undefined, 'Unknown internal route CTA rejected');

  const announcementWithValidCta = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { ctaUrl: 'https://cowatch.tomesphere.in/about', ctaLabel: 'Learn More' },
    }),
  );
  assert(announcementWithValidCta.action === 'open_room', 'Announcement with valid CTA resolves action');
  assert(announcementWithValidCta.url === 'https://cowatch.tomesphere.in/about', 'Announcement with valid CTA has URL');

  const announcementWithMaliciousCta = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { ctaUrl: 'javascript:alert(1)', ctaLabel: 'Click Me' },
    }),
  );
  assert(announcementWithMaliciousCta.action === 'dismiss', 'Announcement with malicious CTA safely drops to dismiss');
  assert(announcementWithMaliciousCta.url === undefined, 'Malicious CTA URL must not be present');
  console.log('  PASS: Announcement CTA separation and isolation verified');

  console.log('\nAll notificationAction tests passed successfully!\n');
}

runActionTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
