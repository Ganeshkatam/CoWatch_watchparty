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
  assert(sanitizeInternalNotificationUrl('/home/anything') === '/', 'Nested /home/anything must be rejected and fall back to /');
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

  // 5. Account route hierarchy constraints
  console.log('Case 5: Testing account route hierarchy constraints...');
  assert(sanitizeInternalNotificationUrl('/accounting') === '/', '/accounting must be rejected');
  assert(sanitizeInternalNotificationUrl('/account') === '/account', '/account must be accepted');
  assert(sanitizeInternalNotificationUrl('/account/') === '/account/', '/account/ must be accepted');
  assert(sanitizeInternalNotificationUrl('/account/profile') === '/account/profile', '/account/profile must be accepted');
  assert(sanitizeInternalNotificationUrl('/account/preferences') === '/account/preferences', '/account/preferences must be accepted');
  assert(sanitizeInternalNotificationUrl('/account/security') === '/account/security', '/account/security must be accepted');
  assert(sanitizeInternalNotificationUrl('/account/unknown') === '/', '/account/unknown must be rejected');
  assert(sanitizeInternalNotificationUrl('/account/profile/anything') === '/', 'Nested /account/profile/anything must be rejected');
  console.log('  PASS: Account route hierarchy constrained to known canonical tabs');

  // 6. Parameterized route validation and percent-encoding boundary
  console.log('Case 6: Testing parameterized route validation and percent-encoding boundaries...');
  assert(sanitizeInternalNotificationUrl('/watch/') === '/', 'Empty /watch/ parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/join/') === '/', 'Empty /join/ parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/invite/') === '/', 'Empty /invite/ parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/watch/%2Fadmin') === '/', 'Encoded slash %2F in parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/watch/%5Cadmin') === '/', 'Encoded backslash %5C in parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/watch/%') === '/', 'Truncated % in parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/watch/%2') === '/', 'Single hex digit %2 in parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/watch/%zz') === '/', 'Invalid hex %zz in parameter must be rejected');
  assert(sanitizeInternalNotificationUrl('/watch/a/b') === '/', 'Multi-segment /watch/a/b must be rejected');
  console.log('  PASS: Parameterized routes require exact shape, single segment, and valid identifier characters');

  // 7. Security boundary & untrusted destination rejection
  console.log('Case 7: Testing security boundaries and open redirect prevention...');
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

  // 8. External announcement CTA link handling & host allowlist
  console.log('Case 8: Testing external announcement CTA URL sanitization and host policies...');
  const githubCta = sanitizeExternalNotificationUrl('https://github.com');
  assert(githubCta !== undefined && githubCta.isExternal === true && githubCta.url === 'https://github.com/', 'Approved external HTTPS host accepted');

  const cowatchCta = sanitizeExternalNotificationUrl('https://cowatch.tomesphere.in');
  assert(cowatchCta !== undefined && cowatchCta.isExternal === true && cowatchCta.url === 'https://cowatch.tomesphere.in/', 'Approved cowatch domain accepted');

  const internalCta = sanitizeExternalNotificationUrl('/about');
  assert(internalCta !== undefined && internalCta.isExternal === false && internalCta.url === '/about', 'Valid internal route CTA marked non-external');

  assert(sanitizeExternalNotificationUrl('https://evil.example') === undefined, 'Unapproved external host rejected');
  assert(sanitizeExternalNotificationUrl('https://cowatch.tomesphere.in@evil.example/') === undefined, 'Userinfo origin spoof rejected');
  assert(sanitizeExternalNotificationUrl('https://github.com:8443/') === undefined, 'Non-standard HTTPS port rejected');
  assert(sanitizeExternalNotificationUrl('https://cowatch.tomesphere.in:444/') === undefined, 'Non-standard port on approved host rejected');
  assert(sanitizeExternalNotificationUrl('http://github.com') === undefined, 'Insecure HTTP on external host rejected');
  assert(sanitizeExternalNotificationUrl('javascript:alert(1)') === undefined, 'Malicious javascript: CTA rejected');
  assert(sanitizeExternalNotificationUrl('//evil.com') === undefined, 'Protocol-relative CTA rejected');
  assert(sanitizeExternalNotificationUrl('data:text/html,...') === undefined, 'data: CTA rejected');
  assert(sanitizeExternalNotificationUrl('/unknown-page') === undefined, 'Unknown internal route CTA rejected');

  // Announcement action resolution & external classification
  const announcementWithApprovedCta = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { ctaUrl: 'https://github.com', ctaLabel: 'View Repository' },
    }),
  );
  assert(announcementWithApprovedCta.action === 'open_room', 'Announcement with valid CTA resolves action');
  assert(announcementWithApprovedCta.url === 'https://github.com/', 'Announcement with valid CTA sets URL');
  assert(announcementWithApprovedCta.isExternal === true, 'Approved external CTA classified as isExternal: true');

  const announcementWithInternalCta = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { ctaUrl: '/about', ctaLabel: 'About Us' },
    }),
  );
  assert(announcementWithInternalCta.action === 'open_room', 'Announcement with internal CTA resolves action');
  assert(announcementWithInternalCta.url === '/about', 'Announcement with internal CTA sets relative URL');
  assert(announcementWithInternalCta.isExternal === false, 'Internal CTA classified as isExternal: false');

  const announcementWithMaliciousCta = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { ctaUrl: 'javascript:alert(1)', ctaLabel: 'Click Me' },
    }),
  );
  assert(announcementWithMaliciousCta.action === 'dismiss', 'Announcement with malicious CTA safely drops to dismiss');
  assert(announcementWithMaliciousCta.url === undefined, 'Malicious CTA URL must not be present');

  // Unknown notification type isolation: must strictly dismiss and never process ctaUrl
  const unknownTypeWithCta = resolveNotificationAction(
    mockNotification({
      type: 'UNKNOWN_TYPE_SPAM' as any,
      metadata: { ctaUrl: 'https://github.com', ctaLabel: 'Click' },
    }),
  );
  assert(unknownTypeWithCta.action === 'dismiss', 'Unknown notification type must strictly dismiss');
  assert(unknownTypeWithCta.url === undefined, 'Unknown notification type must never inherit ctaUrl');
  console.log('  PASS: Announcement CTA separation, host allowlist, port checks, and unknown type isolation verified');

  console.log('\nAll notificationAction tests passed successfully!\n');
}

runActionTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
