/**
 * NOTIFY-003B Action Resolution Unit Tests
 */

import { resolveNotificationAction } from './notificationAction';
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
  console.log('Case 1: Testing explicit metadata actions...');
  const explicitGoHome = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_INVITATION', // Even if type is invite, explicit go_home wins
      metadata: { action: 'go_home', targetUrl: '/home' },
    }),
  );
  assert(explicitGoHome.action === 'go_home', 'Explicit action must be go_home');
  assert(explicitGoHome.url === '/home', 'Explicit url must be /home');
  assert(explicitGoHome.label === 'Go Home', 'Explicit label must be Go Home');

  const explicitOpenRoom = resolveNotificationAction(
    mockNotification({
      type: 'SYSTEM_ANNOUNCEMENT',
      metadata: { action: 'open_room', roomId: 'alpha-room' },
    }),
  );
  assert(explicitOpenRoom.action === 'open_room', 'Explicit action must be open_room');
  assert(explicitOpenRoom.url === '/room/alpha-room', 'Explicit url must resolve room path');
  assert(explicitOpenRoom.label === 'Open Room', 'Explicit label must be Open Room');

  const explicitDismiss = resolveNotificationAction(
    mockNotification({
      metadata: { action: 'dismiss' },
    }),
  );
  assert(explicitDismiss.action === 'dismiss', 'Explicit action must be dismiss');
  assert(explicitDismiss.label === 'Dismiss', 'Explicit label must be Dismiss');
  console.log('  PASS: Explicit metadata actions take authority');

  // 2. Safety fallbacks for legacy/unversioned items
  console.log('Case 2: Testing safety fallbacks for legacy items...');
  const legacyEnded = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_ENDED',
      metadata: { roomId: 'expired-123' }, // Should NOT route to expired-123
    }),
  );
  assert(legacyEnded.action === 'go_home', 'ROOM_ENDED must fallback to go_home');
  assert(legacyEnded.url === '/home', 'ROOM_ENDED must route to /home');

  const legacyKick = resolveNotificationAction(
    mockNotification({
      type: 'MODERATION_ACTION',
      metadata: { roomId: 'room-kicked-from' },
    }),
  );
  assert(legacyKick.action === 'go_home', 'MODERATION_ACTION must fallback to go_home');
  assert(legacyKick.url === '/home', 'MODERATION_ACTION must route to /home');

  const legacyInvite = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_INVITATION',
      metadata: { roomId: 'party-777' },
    }),
  );
  assert(legacyInvite.action === 'join_room', 'ROOM_INVITATION must fallback to join_room');
  assert(legacyInvite.url === '/room/party-777', 'ROOM_INVITATION must route to room');
  assert(legacyInvite.label === 'Join Room', 'ROOM_INVITATION label must be Join Room');

  const legacyVBrowser = resolveNotificationAction(
    mockNotification({
      type: 'VBROWSER_FAILURE',
      metadata: { roomId: 'room-vb' },
    }),
  );
  assert(legacyVBrowser.action === 'open_room', 'VBROWSER_FAILURE must fallback to open_room');
  assert(legacyVBrowser.url === '/room/room-vb', 'VBROWSER_FAILURE must route to room');
  console.log('  PASS: Safety fallbacks prevent navigating to dead or banned rooms');

  // 3. Fallback when roomId is completely missing
  console.log('Case 3: Testing fallback when roomId is missing...');
  const missingRoomInvite = resolveNotificationAction(
    mockNotification({
      type: 'ROOM_INVITATION',
      metadata: {},
    }),
  );
  assert(missingRoomInvite.url === '/home', 'Missing roomId must safely route to /home');
  console.log('  PASS: Missing roomId safely falls back to /home');

  console.log('\nAll notificationAction tests passed successfully!\n');
}

runActionTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
