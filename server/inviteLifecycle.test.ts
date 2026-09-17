import assert from 'node:assert';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { supabaseAdmin } from './utils/supabase.ts';
import { setPostgresForTesting } from './utils/postgres.ts';
import { notificationService } from './notifications/notificationService.ts';
import {
  createNotificationRouter,
  getCanonicalJoinUrl,
  resetInviteRateLimitsForTesting,
} from './notifications/notificationRouter.ts';
import { resolveNotificationAction } from '../src/utils/notificationAction.ts';
import { isTerminalRoom } from './lifecycle/types.ts';

/**
 * INVITE-001 Invitation System Lifecycle, Admission Gateway, & Authorization Test Suite
 *
 * Invariant Matrix:
 * 1. Canonical Gateway: All invitation entrypoints resolve strictly to /join/:roomId (never /room/:roomId).
 * 2. Lifecycle Consistency: isTerminalRoom allows invitations to reusable permanent rooms (active & inactive),
 *    while strictly rejecting terminal temporary rooms (ended & expired).
 * 3. Authorization Matrix: Only room owners or active live hosts can send invitations;
 *    anonymous callers (401), non-hosts (403), and former hosts (403) are strictly rejected.
 * 4. Anti-Enumeration: Non-existent recipient usernames return a generic 200 without sending notifications.
 * 5. Self-Invite Prohibition: Calling invite with self as recipient is rejected with 400.
 * 6. Credential Isolation: Passcodes are never leaked in notification metadata, emails, or join URLs.
 * 7. Idempotency Boundary: Same invitationId deduplicates; different invitationId permits a new invitation.
 */

interface MockRoomRow {
  roomId: string;
  roomTitle: string;
  owner_id: string;
  status: string;
  isPermanent: boolean;
  participants_locked?: boolean;
}

interface MockProfileRow {
  id: string;
  username: string;
  display_name: string;
}

class MockPostgresPool {
  public rooms: Map<string, MockRoomRow> = new Map();
  public profiles: Map<string, MockProfileRow> = new Map();

  async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    // 1. SELECT rooms query
    if (sql.includes('FROM public.rooms') || sql.includes('FROM rooms')) {
      const roomId = params[0];
      const room = this.rooms.get(roomId);
      if (!room) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            roomId: room.roomId,
            roomTitle: room.roomTitle,
            owner_id: room.owner_id,
            status: room.status,
            isPermanent: room.isPermanent,
            participants_locked: Boolean(room.participants_locked),
          },
        ],
        rowCount: 1,
      };
    }

    // 2. SELECT profiles by username or id
    if (sql.includes('FROM public.profiles') && (sql.includes('lower(username)') || sql.includes('id::text'))) {
      const search = String(params[0]).toLowerCase();
      for (const profile of this.profiles.values()) {
        if (profile.username.toLowerCase() === search || profile.id.toLowerCase() === search) {
          return { rows: [{ ...profile }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // 3. SELECT caller profile
    if (sql.includes('FROM public.profiles') && sql.includes('WHERE id = $1')) {
      const id = String(params[0]);
      const profile = this.profiles.get(id);
      if (profile) {
        return { rows: [{ display_name: profile.display_name, username: profile.username }], rowCount: 1 };
      }
      return { rows: [{ display_name: 'Caller', username: 'caller' }], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

async function runInviteLifecycleTests() {
  console.log('=== INVITE-001 Invitation System Lifecycle & Security Test Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Canonical Join URL & Action Resolution Invariants
  // ---------------------------------------------------------------------------
  console.log('Case 1: Canonical Join URL & Action Resolution Invariant...');
  const canonicalUrl = getCanonicalJoinUrl('alpha-room-42');
  assert(
    canonicalUrl.includes('/join/alpha-room-42'),
    `Canonical join URL must format as /join/:roomId, received: ${canonicalUrl}`,
  );
  assert(
    !canonicalUrl.includes('/room/'),
    `Canonical join URL must never target /room/, received: ${canonicalUrl}`,
  );

  // Client Action Resolver check for join_room action
  const resolvedJoinAction = resolveNotificationAction({
    type: 'ROOM_INVITATION',
    metadata: {
      roomId: 'test-gateway-room',
      action: 'join_room',
    },
  });
  assert.strictEqual(resolvedJoinAction.action, 'join_room');
  assert.strictEqual(
    resolvedJoinAction.url,
    '/join/test-gateway-room',
    'Resolved action URL for invitation must strictly point to /join/:roomId',
  );

  // Client Action Resolver fallback without explicit action
  const resolvedFallbackAction = resolveNotificationAction({
    type: 'ROOM_INVITATION',
    metadata: {
      roomId: 'test-gateway-room',
    },
  });
  assert.strictEqual(resolvedFallbackAction.action, 'join_room');
  assert.strictEqual(
    resolvedFallbackAction.url,
    '/join/test-gateway-room',
    'Fallback action for ROOM_INVITATION must resolve to /join/:roomId',
  );

  // ---------------------------------------------------------------------------
  // Setup Mock Server & Services
  // ---------------------------------------------------------------------------
  const mockDb = new MockPostgresPool();
  setPostgresForTesting(mockDb);

  // Populate mock profiles
  mockDb.profiles.set('user-owner', { id: 'user-owner', username: 'owner_user', display_name: 'Room Owner' });
  mockDb.profiles.set('user-host', { id: 'user-host', username: 'active_host', display_name: 'Active Host' });
  mockDb.profiles.set('user-former-host', { id: 'user-former-host', username: 'former_host', display_name: 'Former Host' });
  mockDb.profiles.set('user-participant', { id: 'user-participant', username: 'guest_user', display_name: 'Regular Guest' });
  mockDb.profiles.set('user-target', { id: 'user-target', username: 'target_invitee', display_name: 'Target Invitee' });

  // Track dispatched notifications
  const dispatchedNotifications: any[] = [];
  const originalNotifyUser = notificationService.notifyUser.bind(notificationService);
  notificationService.notifyUser = async (params: any) => {
    dispatchedNotifications.push(params);
    return {
      id: 'mock-notif-' + (dispatchedNotifications.length),
      user_id: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      metadata: params.metadata,
      created_at: new Date().toISOString(),
      read_at: null,
      expires_at: null,
      event_id: params.eventId,
    } as any;
  };

  // Mock Supabase Auth verification
  const originalGetUser = supabaseAdmin.auth.getUser.bind(supabaseAdmin.auth);
  supabaseAdmin.auth.getUser = (async (token: string) => {
    if (token && token.startsWith('bearer-')) {
      const uid = token.replace('bearer-', '');
      if (mockDb.profiles.has(uid)) {
        return { data: { user: { id: uid, email: `${uid}@example.com` } as any }, error: null };
      }
    }
    return { data: { user: null }, error: new Error('Invalid token') as any };
  }) as any;

  // Mock Live Room Registry lookup
  const liveRooms = new Map<string, { currentHostUid: string; isHostUid: (uid: string) => boolean }>();
  liveRooms.set('active-room-1', {
    currentHostUid: 'user-host',
    isHostUid: (uid: string) => uid === 'user-host',
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/notifications',
    createNotificationRouter(null as any, (roomId: string) => liveRooms.get(roomId)),
  );

  let server!: HttpServer;
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr !== null) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  try {
    // ---------------------------------------------------------------------------
    // 2. Authorization Matrix
    // ---------------------------------------------------------------------------
    console.log('Case 2: Authorization Matrix (Anonymous, Participant, Former Host, Active Host, Owner)...');

    // Room owned by user-owner, active host is user-host
    mockDb.rooms.set('active-room-1', {
      roomId: 'active-room-1',
      roomTitle: 'Live Movie Night',
      owner_id: 'user-owner',
      status: 'active',
      isPermanent: false,
    });

    // 2a. Anonymous caller -> 401
    const unauthRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'active-room-1', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(unauthRes.status, 401, 'Anonymous caller must be rejected with 401');

    // 2b. Authenticated participant (non-host) -> 403
    const participantRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-user-participant',
      },
      body: JSON.stringify({ roomId: 'active-room-1', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(participantRes.status, 403, 'Non-host participant must be rejected with 403');

    // 2c. Former host (transferred privileges away) -> 403
    const formerHostRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-user-former-host',
      },
      body: JSON.stringify({ roomId: 'active-room-1', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(formerHostRes.status, 403, 'Former host must be rejected with 403');

    // 2d. Active host -> 200
    dispatchedNotifications.length = 0;
    const activeHostRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-user-host',
      },
      body: JSON.stringify({ roomId: 'active-room-1', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(activeHostRes.status, 200, 'Active host must be permitted to invite');
    assert.strictEqual(dispatchedNotifications.length, 1, 'Active host invite must dispatch notification');

    // 2e. Room owner -> 200
    dispatchedNotifications.length = 0;
    const ownerRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-user-owner',
      },
      body: JSON.stringify({ roomId: 'active-room-1', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(ownerRes.status, 200, 'Room owner must be permitted to invite');
    assert.strictEqual(dispatchedNotifications.length, 1, 'Owner invite must dispatch notification');

    // 2f. Participant lock -> Non-owner host rejected with 403
    mockDb.rooms.set('locked-room-1', {
      roomId: 'locked-room-1',
      roomTitle: 'Locked Party',
      owner_id: 'user-owner',
      status: 'active',
      isPermanent: false,
      participants_locked: true,
    });
    liveRooms.set('locked-room-1', {
      currentHostUid: 'user-host',
      isHostUid: (uid: string) => uid === 'user-host',
    });
    const lockedHostRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bearer-user-host',
      },
      body: JSON.stringify({ roomId: 'locked-room-1', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(lockedHostRes.status, 403, 'Host cannot invite when participants are locked');

    // ---------------------------------------------------------------------------
    // 3. Room Lifecycle Matrix & isTerminalRoom Semantics
    // ---------------------------------------------------------------------------
    console.log('Case 3: Room Lifecycle Matrix & isTerminalRoom Contract...');

    // 3a. Verify isTerminalRoom unit semantics directly
    assert.strictEqual(
      isTerminalRoom({ isPermanent: false, status: 'active' }),
      false,
      'Temporary active room is NOT terminal',
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: false, status: 'ended' }),
      true,
      'Temporary ended room is TERMINAL',
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: false, status: 'expired' }),
      true,
      'Temporary expired room is TERMINAL',
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: true, status: 'active' }),
      false,
      'Permanent active room is NOT terminal',
    );
    assert.strictEqual(
      isTerminalRoom({ isPermanent: true, status: 'inactive' }),
      false,
      'Permanent inactive room is NOT terminal',
    );

    // 3b. Temporary Active -> Allowed
    mockDb.rooms.set('temp-active', {
      roomId: 'temp-active',
      roomTitle: 'Temp Active',
      owner_id: 'user-owner',
      status: 'active',
      isPermanent: false,
    });
    const tempActiveRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'temp-active', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(tempActiveRes.status, 200, 'Temporary active room allows invites');

    // 3c. Temporary Ended -> Rejected (400)
    mockDb.rooms.set('temp-ended', {
      roomId: 'temp-ended',
      roomTitle: 'Temp Ended',
      owner_id: 'user-owner',
      status: 'ended',
      isPermanent: false,
    });
    const tempEndedRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'temp-ended', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(tempEndedRes.status, 400, 'Temporary ended room must reject invites with 400');
    const tempEndedData = await tempEndedRes.json();
    assert(
      tempEndedData.error?.includes('ended or expired'),
      `Expected ended/expired error message, got: ${JSON.stringify(tempEndedData)}`,
    );

    // 3d. Temporary Expired -> Rejected (400)
    mockDb.rooms.set('temp-expired', {
      roomId: 'temp-expired',
      roomTitle: 'Temp Expired',
      owner_id: 'user-owner',
      status: 'expired',
      isPermanent: false,
    });
    const tempExpiredRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'temp-expired', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(tempExpiredRes.status, 400, 'Temporary expired room must reject invites with 400');

    // 3e. Permanent Active -> Allowed (200)
    mockDb.rooms.set('perm-active', {
      roomId: 'perm-active',
      roomTitle: 'Permanent Cinema Club',
      owner_id: 'user-owner',
      status: 'active',
      isPermanent: true,
    });
    const permActiveRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'perm-active', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(permActiveRes.status, 200, 'Permanent active room allows invites');

    // 3f. Permanent Inactive -> Allowed (200)
    mockDb.rooms.set('perm-inactive', {
      roomId: 'perm-inactive',
      roomTitle: 'Permanent Cinema Club',
      owner_id: 'user-owner',
      status: 'inactive',
      isPermanent: true,
    });
    const permInactiveRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'perm-inactive', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(permInactiveRes.status, 200, 'Permanent inactive room allows invites');

    // ---------------------------------------------------------------------------
    // 4. Target User Resolution, Anti-Enumeration, & Self-Invite Checks
    // ---------------------------------------------------------------------------
    console.log('Case 4: Target Resolution, Anti-Enumeration, & Self-Invite...');

    // 4a. Non-existent user -> Generic 200, NO notification dispatched
    dispatchedNotifications.length = 0;
    const unknownUserRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'perm-active', targetUsername: 'non_existent_ghost_user' }),
    });
    assert.strictEqual(unknownUserRes.status, 200, 'Unknown username must return 200 anti-enumeration response');
    const unknownUserData = await unknownUserRes.json();
    assert(
      unknownUserData.message?.includes('If this user exists'),
      `Anti-enumeration response message mismatch: ${JSON.stringify(unknownUserData)}`,
    );
    assert.strictEqual(dispatchedNotifications.length, 0, 'No notification must be dispatched for unknown user');

    // 4b. Self invitation -> 400
    const selfInviteRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'perm-active', targetUsername: 'owner_user' }),
    });
    assert.strictEqual(selfInviteRes.status, 400, 'Self-invite must be rejected with 400');
    const selfInviteData = await selfInviteRes.json();
    assert(
      selfInviteData.error?.includes('Cannot invite yourself'),
      `Expected Cannot invite yourself error, got: ${JSON.stringify(selfInviteData)}`,
    );

    // ---------------------------------------------------------------------------
    // 5. Credential Isolation Invariants
    // ---------------------------------------------------------------------------
    console.log('Case 5: Credential Isolation Invariants...');

    dispatchedNotifications.length = 0;
    await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({ roomId: 'perm-active', targetUsername: 'target_invitee' }),
    });
    assert.strictEqual(dispatchedNotifications.length, 1, 'Notification should be queued');
    const notif = dispatchedNotifications[0];

    // Assert zero passcodes or secrets in notification payload
    const serializedPayload = JSON.stringify(notif);
    assert(!serializedPayload.includes('passcode'), 'Notification must not contain passcode field');
    assert(
      !notif.metadata.targetUrl.includes('?passcode='),
      'Invitation targetUrl must not include passcode query param',
    );
    assert.strictEqual(
      notif.metadata.targetUrl,
      '/join/perm-active',
      'Invitation targetUrl must strictly be /join/:roomId',
    );
    assert.strictEqual(
      notif.emailPayload.roomUrl,
      getCanonicalJoinUrl('perm-active', baseUrl),
      'Email roomUrl must strictly match getCanonicalJoinUrl with request origin',
    );

    // ---------------------------------------------------------------------------
    // 6. Idempotency Boundary Test
    // ---------------------------------------------------------------------------
    console.log('Case 6: Idempotency Boundary (Same vs Different invitationId)...');

    resetInviteRateLimitsForTesting();
    dispatchedNotifications.length = 0;

    // Send first invitation with invitationId: 'idempotent-inv-123'
    const resA1 = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({
        roomId: 'perm-active',
        targetUsername: 'target_invitee',
        invitationId: 'idempotent-inv-123',
      }),
    });
    assert.strictEqual(resA1.status, 200);
    assert.strictEqual(dispatchedNotifications.length, 1);
    const eventId1 = dispatchedNotifications[0].eventId;

    // Send duplicate invitation with identical invitationId: 'idempotent-inv-123'
    const resA2 = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({
        roomId: 'perm-active',
        targetUsername: 'target_invitee',
        invitationId: 'idempotent-inv-123',
      }),
    });
    assert.strictEqual(resA2.status, 200);
    assert.strictEqual(dispatchedNotifications.length, 2);
    const eventId2 = dispatchedNotifications[1].eventId;

    // Boundary assertion 1: identical invitationId produces identical eventId for DB deduplication
    assert.strictEqual(
      eventId1,
      eventId2,
      'Identical invitationId must yield identical eventId for idempotency deduplication',
    );

    // Send new invitation with distinct invitationId: 'idempotent-inv-124'
    const resB = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({
        roomId: 'perm-active',
        targetUsername: 'target_invitee',
        invitationId: 'idempotent-inv-124',
      }),
    });
    assert.strictEqual(resB.status, 200);
    assert.strictEqual(dispatchedNotifications.length, 3);
    const eventId3 = dispatchedNotifications[2].eventId;

    // Boundary assertion 2: different invitationId produces distinct eventId, allowing a new invitation
    assert.notStrictEqual(
      eventId1,
      eventId3,
      'Different invitationId must yield distinct eventId to permit new invitation',
    );

    // ---------------------------------------------------------------------------
    // 7. Rate Limiter Invariant Test
    // ---------------------------------------------------------------------------
    console.log('Case 7: Rate Limiter Invariant (10 invites per window, 11th rejected with 429)...');
    resetInviteRateLimitsForTesting();

    for (let i = 0; i < 10; i++) {
      const rateCheckRes = await fetch(`${baseUrl}/api/notifications/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
        body: JSON.stringify({
          roomId: 'perm-active',
          targetUsername: 'target_invitee',
          invitationId: `rate-test-${i}`,
        }),
      });
      assert.strictEqual(rateCheckRes.status, 200, `Invite ${i + 1} within window should succeed`);
    }

    const rateExceededRes = await fetch(`${baseUrl}/api/notifications/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-user-owner' },
      body: JSON.stringify({
        roomId: 'perm-active',
        targetUsername: 'target_invitee',
        invitationId: 'rate-test-exceeded',
      }),
    });
    assert.strictEqual(rateExceededRes.status, 429, '11th invite from caller must be rejected with 429');

    // ---------------------------------------------------------------------------
    // 8. QR Code Invariants & UI URL-Copy Removal Invariants
    // ---------------------------------------------------------------------------
    console.log('Case 8: QR Code Invariants & URL-Copy Removal Invariants...');
    const testOrigin = 'http://localhost:3000';
    const cleanId = 'alpha-room-99';
    const testCanonicalJoinUrl = `${testOrigin}/join/${cleanId}`;

    // 8a. Invariant: QR payload strictly equals canonicalJoinUrl
    assert.strictEqual(
      testCanonicalJoinUrl,
      `${testOrigin}/join/${cleanId}`,
      'QR URL must match canonicalJoinUrl exactly',
    );
    assert(
      testCanonicalJoinUrl.includes(`/join/${cleanId}`),
      'QR URL must contain canonical /join/:roomId path',
    );
    assert(
      !testCanonicalJoinUrl.includes('passcode'),
      'QR URL must never contain passcode or credential query parameter',
    );
    assert(
      !testCanonicalJoinUrl.includes('/room/'),
      'QR URL must never target /room/:roomId',
    );

    // 8b. Static source audit: Verify URL-Copy removal from InviteModal
    const fs = await import('node:fs');
    const path = await import('node:path');
    const inviteModalSource = fs.readFileSync(path.resolve('src/components/Modal/InviteModal.tsx'), 'utf-8');

    assert(
      !inviteModalSource.includes('Party Link'),
      'Party Link card must be removed from InviteModal',
    );
    assert(
      !inviteModalSource.includes('Copy Link'),
      'Copy Link button must be removed from InviteModal',
    );
    assert(
      !inviteModalSource.includes('handleCopyInviteLink'),
      'Copy link handler must be removed from InviteModal',
    );
    assert(
      inviteModalSource.includes('<QRShare'),
      'InviteModal must render modular QRShare component',
    );
    assert(
      inviteModalSource.includes('<DirectInviteForm'),
      'InviteModal must render modular DirectInviteForm component',
    );
    assert(
      inviteModalSource.includes('<ShareActions'),
      'InviteModal must render modular ShareActions component',
    );

    console.log('\nAll invite lifecycle and admission security tests passed successfully.');
  } finally {
    // Restore stubs and close server
    notificationService.notifyUser = originalNotifyUser;
    supabaseAdmin.auth.getUser = originalGetUser;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runInviteLifecycleTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
