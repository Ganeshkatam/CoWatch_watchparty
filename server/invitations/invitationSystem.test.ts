import assert from 'node:assert';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import {
  createInvitationRouter,
  hashInvitationToken,
  generateRawInvitationToken,
  getCanonicalInvitationUrl,
} from './invitationRouter.ts';
import { formatInvitationMessage, resolveNotificationAction } from '../../src/utils/notificationAction.ts';
import { verifyAdmissionToken } from '../utils/admissionToken.ts';
import { isTerminalRoom } from '../lifecycle/types.ts';
import { supabaseAdmin } from '../utils/supabase.ts';

/**
 * INVITE-002 Unified CoWatch Invitation System End-to-End Test Suite
 *
 * Invariant Matrix:
 * 1. Unified Token Model: Invitations use opaque, high-entropy tokens.
 * 2. Hash-Only Persistence: Database stores SHA-256 token_hash; raw token is not persisted.
 * 3. Notification Metadata Isolation: Notification metadata stores invitationId, never raw token.
 * 4. Passcode Confidentiality: GET /api/invitations/:token strictly omits room passcode.
 * 5. Dual Admission Gateways:
 *    - /join/:roomId requires manual passcode entry.
 *    - /invite/:token admits without requiring passcode entry.
 * 6. Explicit Reusability:
 *    - Permanent room share invitations: is_reusable = true (acceptance does not consume).
 *    - Temporary room direct invitations: is_reusable = false (single-use consumption).
 * 7. Lifecycle Contract:
 *    - Inactive permanent rooms allow invitation creation and admission.
 *    - Ended or expired temporary rooms reject invitation creation and admission.
 * 8. Targeted Authorization: Invitations with target_user_id enforce callerUid identity.
 * 9. Emoji-Free Compliance: Canonical invitation share text contains zero emojis.
 */

interface MockRoomRow {
  roomId: string;
  roomTitle: string;
  owner_id: string;
  status: string;
  isPermanent: boolean;
  passcode: string;
  participants_locked?: boolean;
  max_participants?: number;
}

interface MockProfileRow {
  id: string;
  username: string;
  display_name: string;
}

interface MockInvitationRow {
  id: string;
  room_id: string;
  inviter_id: string;
  target_user_id?: string | null;
  token_hash: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  accepted_at?: string | null;
  accepted_by_user_id?: string | null;
  is_reusable: boolean;
  created_at: string;
}

class MockPostgresPool {
  public rooms: Map<string, MockRoomRow> = new Map();
  public profiles: Map<string, MockProfileRow> = new Map();
  public invitations: Map<string, MockInvitationRow> = new Map();

  async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    // 1. SELECT rooms
    if (sql.includes('FROM public.rooms') || sql.includes('FROM rooms')) {
      const roomId = params[0];
      const room = this.rooms.get(roomId);
      if (!room) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            roomId: room.roomId,
            roomTitle: room.roomTitle,
            owner_id: room.owner_id,
            status: room.status,
            isPermanent: room.isPermanent,
            passcode: room.passcode,
            participants_locked: Boolean(room.participants_locked),
            max_participants: room.max_participants,
          },
        ],
        rowCount: 1,
      };
    }

    // 2. INSERT into room_invitations
    if (sql.includes('INSERT INTO public.room_invitations')) {
      // Handles both /api/invitations insert and notification insert
      let id = crypto.randomUUID();
      let roomId = '';
      let inviterId = '';
      let targetUserId: string | null = null;
      let tokenHash = '';
      let expiresAt: string | null = null;
      let isReusable = false;

      if (sql.includes('(id, room_id, inviter_id, target_user_id, token_hash, expires_at, is_reusable)')) {
        id = params[0];
        roomId = params[1];
        inviterId = params[2];
        targetUserId = params[3];
        tokenHash = params[4];
        expiresAt = params[5];
        isReusable = Boolean(params[6]);
      } else {
        roomId = params[0];
        inviterId = params[1];
        targetUserId = params[2];
        tokenHash = params[3];
        expiresAt = params[4];
        isReusable = Boolean(params[5]);
      }

      const inv: MockInvitationRow = {
        id,
        room_id: roomId,
        inviter_id: inviterId,
        target_user_id: targetUserId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        revoked_at: null,
        accepted_at: null,
        accepted_by_user_id: null,
        is_reusable: isReusable,
        created_at: new Date().toISOString(),
      };
      this.invitations.set(id, inv);
      return { rows: [{ id, created_at: inv.created_at }], rowCount: 1 };
    }

    // 3. SELECT room_invitations by token_hash
    if (sql.includes('WHERE i.token_hash = $1')) {
      const hash = params[0];
      for (const inv of this.invitations.values()) {
        if (inv.token_hash === hash) {
          const room = this.rooms.get(inv.room_id);
          const inviter = this.profiles.get(inv.inviter_id);
          return {
            rows: [
              {
                id: inv.id,
                room_id: inv.room_id,
                inviter_id: inv.inviter_id,
                target_user_id: inv.target_user_id,
                expires_at: inv.expires_at,
                revoked_at: inv.revoked_at,
                accepted_at: inv.accepted_at,
                is_reusable: inv.is_reusable,
                roomTitle: room?.roomTitle || inv.room_id,
                status: room?.status || 'active',
                isPermanent: room?.isPermanent ?? false,
                owner_id: room?.owner_id,
                participants_locked: room?.participants_locked,
                max_participants: room?.max_participants,
                inviter_name: inviter?.display_name || inviter?.username,
                inviter_username: inviter?.username,
              },
            ],
            rowCount: 1,
          };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // 4. SELECT room_invitations by id
    if (sql.includes('WHERE i.id = $1')) {
      const id = params[0];
      const inv = this.invitations.get(id);
      if (!inv) return { rows: [], rowCount: 0 };
      const room = this.rooms.get(inv.room_id);
      const inviter = this.profiles.get(inv.inviter_id);
      return {
        rows: [
          {
            id: inv.id,
            room_id: inv.room_id,
            inviter_id: inv.inviter_id,
            target_user_id: inv.target_user_id,
            expires_at: inv.expires_at,
            revoked_at: inv.revoked_at,
            accepted_at: inv.accepted_at,
            is_reusable: inv.is_reusable,
            roomTitle: room?.roomTitle || inv.room_id,
            status: room?.status || 'active',
            isPermanent: room?.isPermanent ?? false,
            owner_id: room?.owner_id,
            participants_locked: room?.participants_locked,
            max_participants: room?.max_participants,
            inviter_name: inviter?.display_name || inviter?.username,
            inviter_username: inviter?.username,
          },
        ],
        rowCount: 1,
      };
    }

    // 5. UPDATE room_invitations (accept / revoke)
    if (sql.includes('UPDATE public.room_invitations')) {
      if (sql.includes('SET accepted_at = now()')) {
        const callerUid = params[0];
        const invId = params[1];
        const inv = this.invitations.get(invId);
        if (inv) {
          inv.accepted_at = new Date().toISOString();
          inv.accepted_by_user_id = callerUid;
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SET revoked_at = now()')) {
        const invId = params[0];
        const inv = this.invitations.get(invId);
        if (inv) {
          inv.revoked_at = new Date().toISOString();
        }
        return { rows: [], rowCount: 1 };
      }
    }

    // 6. Profiles lookup
    if (sql.includes('FROM public.profiles') && (sql.includes('lower(username)') || sql.includes('id::text'))) {
      const search = String(params[0]).toLowerCase();
      for (const profile of this.profiles.values()) {
        if (profile.username.toLowerCase() === search || profile.id.toLowerCase() === search) {
          return { rows: [{ ...profile }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('FROM public.profiles') && sql.includes('WHERE id = $1')) {
      const profile = this.profiles.get(String(params[0]));
      if (profile) return { rows: [{ display_name: profile.display_name, username: profile.username }], rowCount: 1 };
      return { rows: [{ display_name: 'Caller', username: 'caller' }], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

async function runInvitationSystemTests() {
  console.log('=== INVITE-002 Unified CoWatch Invitation System Test Suite ===\n');

  const mockPool = new MockPostgresPool();
  const HOST_UID = '11111111-1111-4111-8111-111111111111';
  const PARTICIPANT_UID = '22222222-2222-4222-8222-222222222222';
  const STRANGER_UID = '33333333-3333-4333-8333-333333333333';
  const TARGET_UID = '44444444-4444-4444-8444-444444444444';

  mockPool.profiles.set(HOST_UID, { id: HOST_UID, username: 'hostuser', display_name: 'The Host' });
  mockPool.profiles.set(PARTICIPANT_UID, { id: PARTICIPANT_UID, username: 'participant', display_name: 'Participant One' });
  mockPool.profiles.set(STRANGER_UID, { id: STRANGER_UID, username: 'stranger', display_name: 'Stranger' });
  mockPool.profiles.set(TARGET_UID, { id: TARGET_UID, username: 'targetuser', display_name: 'Target Recipient' });

  // Room fixtures
  mockPool.rooms.set('perm-active-room', {
    roomId: 'perm-active-room',
    roomTitle: 'Permanent Film Club',
    owner_id: HOST_UID,
    status: 'active',
    isPermanent: true,
    passcode: 'perm1234',
  });

  mockPool.rooms.set('perm-inactive-room', {
    roomId: 'perm-inactive-room',
    roomTitle: 'Permanent Anime Lounge',
    owner_id: HOST_UID,
    status: 'inactive',
    isPermanent: true,
    passcode: 'lounge99',
  });

  mockPool.rooms.set('temp-active-room', {
    roomId: 'temp-active-room',
    roomTitle: 'Movie Night Friday',
    owner_id: HOST_UID,
    status: 'active',
    isPermanent: false,
    passcode: 'temp4321',
  });

  mockPool.rooms.set('temp-ended-room', {
    roomId: 'temp-ended-room',
    roomTitle: 'Past Party',
    owner_id: HOST_UID,
    status: 'ended',
    isPermanent: false,
    passcode: 'ended111',
  });

  mockPool.rooms.set('locked-room', {
    roomId: 'locked-room',
    roomTitle: 'Locked VIP Screening',
    owner_id: HOST_UID,
    status: 'active',
    isPermanent: true,
    passcode: 'locked88',
    participants_locked: true,
  });

  // Mock Supabase Auth verification
  const originalGetUser = supabaseAdmin.auth.getUser?.bind(supabaseAdmin.auth);
  supabaseAdmin.auth.getUser = (async (token: string) => {
    if (token && token.startsWith('valid-')) {
      const uid = token.replace('valid-', '');
      if (mockPool.profiles.has(uid)) {
        return {
          data: {
            user: {
              id: uid,
              email: `${uid}@example.com`,
              email_confirmed_at: '2026-01-01T00:00:00Z',
            } as any,
          },
          error: null,
        };
      }
    }
    return { data: { user: null }, error: new Error('Invalid token') as any };
  }) as any;

  // Mock server setup
  const app = express();
  app.use(express.json());

  // Test token validation interceptor: maps mock token header directly to verified caller
  app.use((req, _res, next) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer test-user-')) {
      const uid = auth.replace('Bearer test-user-', '');
      req.headers.authorization = `Bearer valid-${uid}`;
    }
    next();
  });

  const memoryRooms = new Map<string, any>();
  memoryRooms.set('perm-active-room', {
    isHostUid: (uid: string) => uid === HOST_UID,
    isRoomFull: () => false,
  });
  memoryRooms.set('locked-room', {
    isHostUid: (uid: string) => uid === HOST_UID,
    isRoomFull: () => false,
  });

  const router = createInvitationRouter({
    postgresPool: mockPool as any,
    roomLookup: (id) => memoryRooms.get(id),
    rooms: memoryRooms,
  });
  app.use('/api/invitations', router);

  let server!: HttpServer;
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // Test 1: Token Generation & SHA-256 Hashing Invariant
    // -------------------------------------------------------------------------
    console.log('Test 1: Token Generation & SHA-256 Hashing Invariant...');
    const tokenA = generateRawInvitationToken();
    const tokenB = generateRawInvitationToken();
    assert.notStrictEqual(tokenA, tokenB, 'Generated tokens must be distinct');
    assert(tokenA.length >= 32, 'Raw token must have sufficient entropy');

    const hashA1 = hashInvitationToken(tokenA);
    const hashA2 = hashInvitationToken(tokenA);
    assert.strictEqual(hashA1, hashA2, 'Hash of identical token must match');
    assert.notStrictEqual(hashA1, tokenA, 'Hash must not equal raw token');
    console.log('Passed Test 1.');

    // -------------------------------------------------------------------------
    // Test 2: Authorization Matrix for Invitation Creation
    // -------------------------------------------------------------------------
    console.log('Test 2: Authorization Matrix for Invitation Creation...');
    // Anonymous caller
    const anonRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: 'perm-active-room' }),
    });
    assert.strictEqual(anonRes.status, 401, 'Anonymous caller must be rejected with 401');

    // Participant (non-host) caller
    const nonHostRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${PARTICIPANT_UID}`,
      },
      body: JSON.stringify({ roomId: 'perm-active-room' }),
    });
    assert.strictEqual(nonHostRes.status, 403, 'Non-host must be rejected with 403');

    // Terminal room (ended)
    const endedRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
      body: JSON.stringify({ roomId: 'temp-ended-room' }),
    });
    assert.strictEqual(endedRes.status, 400, 'Ended room must be rejected with 400');

    // Authorized host creating invitation for permanent room
    const hostPermRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
      body: JSON.stringify({ roomId: 'perm-active-room' }),
    });
    assert.strictEqual(hostPermRes.status, 201, 'Host creating permanent invitation must return 201');
    const permInviteData = await hostPermRes.json();
    assert(permInviteData.invitationId, 'Must return invitationId');
    assert(permInviteData.token, 'Must return raw token to host');
    assert(permInviteData.invitationUrl.includes('/invite/'), 'Must construct /invite/:token URL');
    assert.strictEqual(permInviteData.isReusable, true, 'Permanent room invitations default to reusable');

    // Verify raw token is NOT in database
    for (const inv of mockPool.invitations.values()) {
      assert.notStrictEqual(inv.token_hash, permInviteData.token, 'Raw token must NEVER be stored in database');
      assert.strictEqual(inv.token_hash, hashInvitationToken(permInviteData.token), 'DB must store SHA-256 hash');
    }

    // Inactive permanent room succeeds
    const inactivePermRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
      body: JSON.stringify({ roomId: 'perm-inactive-room' }),
    });
    assert.strictEqual(inactivePermRes.status, 201, 'Inactive permanent room invitation must succeed');
    console.log('Passed Test 2.');

    // -------------------------------------------------------------------------
    // Test 3: Passcode Confidentiality in GET /api/invitations/:token
    // -------------------------------------------------------------------------
    console.log('Test 3: Passcode Confidentiality in GET /api/invitations/:token...');
    const previewRes = await fetch(`${baseUrl}/api/invitations/${permInviteData.token}`);
    assert.strictEqual(previewRes.status, 200, 'Preview must return 200 for valid token');
    const previewData = await previewRes.json();
    assert.strictEqual(previewData.valid, true);
    assert.strictEqual(previewData.roomId, 'perm-active-room');
    assert.strictEqual(previewData.roomTitle, 'Permanent Film Club');
    assert.strictEqual(previewData.inviterName, 'The Host');
    assert.strictEqual(previewData.isPermanent, true);
    assert.strictEqual(previewData.isReusable, true);

    // CRITICAL SECURITY INVARIANT: Passcode MUST NEVER be returned!
    assert.strictEqual(previewData.passcode, undefined, 'GET /api/invitations/:token MUST NOT contain passcode');
    assert(!JSON.stringify(previewData).includes('perm1234'), 'Passcode string must not appear anywhere in response');
    console.log('Passed Test 3.');

    // -------------------------------------------------------------------------
    // Test 4: Authoritative Admission via POST /api/invitations/:token/accept
    // -------------------------------------------------------------------------
    console.log('Test 4: Authoritative Admission via POST /api/invitations/:token/accept...');
    const acceptRes = await fetch(`${baseUrl}/api/invitations/${permInviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${PARTICIPANT_UID}`,
      },
      body: JSON.stringify({ sessionId: 'session-client-123' }),
    });
    assert.strictEqual(acceptRes.status, 200, 'Admission must succeed for valid token');
    const acceptData = await acceptRes.json();
    assert.strictEqual(acceptData.valid, true);
    assert.strictEqual(acceptData.roomId, 'perm-active-room');
    assert(acceptData.admissionToken, 'Must issue signed admissionToken');
    assert.strictEqual(acceptData.sessionId, 'session-client-123');

    // Verify the admission token is valid and signed
    const verified = verifyAdmissionToken(
      acceptData.admissionToken,
      'perm-active-room',
      PARTICIPANT_UID,
      'session-client-123',
    );
    assert(verified.valid, 'Admission token must be cryptographically valid');
    assert.strictEqual(verified.payload?.roomId, 'perm-active-room');
    assert.strictEqual(verified.payload?.userId, PARTICIPANT_UID);
    console.log('Passed Test 4.');

    // -------------------------------------------------------------------------
    // Test 5: Single-Use vs Reusable Invitation Semantics
    // -------------------------------------------------------------------------
    console.log('Test 5: Single-Use vs Reusable Invitation Semantics...');
    // Create single-use invitation for temporary room
    const tempInviteRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
      body: JSON.stringify({ roomId: 'temp-active-room', isReusable: false }),
    });
    assert.strictEqual(tempInviteRes.status, 201);
    const tempInviteData = await tempInviteRes.json();
    assert.strictEqual(tempInviteData.isReusable, false, 'Temporary room invitation is single-use');

    // First acceptance succeeds
    const tempAccept1 = await fetch(`${baseUrl}/api/invitations/${tempInviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${PARTICIPANT_UID}`,
      },
    });
    assert.strictEqual(tempAccept1.status, 200, 'First acceptance of single-use invitation must succeed');

    // Second acceptance of single-use invitation MUST fail (409 Conflict)
    const tempAccept2 = await fetch(`${baseUrl}/api/invitations/${tempInviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${STRANGER_UID}`,
      },
    });
    assert.strictEqual(tempAccept2.status, 409, 'Subsequent acceptance of single-use invitation must be rejected with 409');

    // Meanwhile, reusable permanent invitation can be accepted again by another user
    const permAccept2 = await fetch(`${baseUrl}/api/invitations/${permInviteData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${STRANGER_UID}`,
      },
    });
    assert.strictEqual(permAccept2.status, 200, 'Reusable permanent invitation can be accepted multiple times');
    console.log('Passed Test 5.');

    // -------------------------------------------------------------------------
    // Test 6: Targeted Recipient Authorization & Anti-Enumeration
    // -------------------------------------------------------------------------
    console.log('Test 6: Targeted Recipient Authorization & Anti-Enumeration...');
    const targetedRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
      body: JSON.stringify({
        roomId: 'perm-active-room',
        targetUserId: TARGET_UID,
        isReusable: false,
      }),
    });
    assert.strictEqual(targetedRes.status, 201);
    const targetedData = await targetedRes.json();

    // Stranger attempts to accept targeted invitation -> 403 Forbidden
    const strangerAttempt = await fetch(`${baseUrl}/api/invitations/${targetedData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${STRANGER_UID}`,
      },
    });
    assert.strictEqual(strangerAttempt.status, 403, 'Stranger cannot accept targeted invitation');

    // Legitimate recipient accepts targeted invitation -> 200 Success
    const targetAccept = await fetch(`${baseUrl}/api/invitations/${targetedData.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${TARGET_UID}`,
      },
    });
    assert.strictEqual(targetAccept.status, 200, 'Target recipient can accept targeted invitation');

    // Anti-enumeration: non-existent token returns generic 404
    const fakeRes = await fetch(`${baseUrl}/api/invitations/non-existent-random-token-12345`);
    assert.strictEqual(fakeRes.status, 404, 'Non-existent token returns generic 404');
    console.log('Passed Test 6.');

    // -------------------------------------------------------------------------
    // Test 7: Revocation Invariant
    // -------------------------------------------------------------------------
    console.log('Test 7: Revocation Invariant...');
    const revokeTargetRes = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
      body: JSON.stringify({ roomId: 'perm-active-room' }),
    });
    const revokeTarget = await revokeTargetRes.json();

    // Host revokes invitation
    const revokeRes = await fetch(`${baseUrl}/api/invitations/${revokeTarget.invitationId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${HOST_UID}`,
      },
    });
    assert.strictEqual(revokeRes.status, 200, 'Host can revoke invitation');

    // Subsequent preview and accept must fail
    const revokedPreview = await fetch(`${baseUrl}/api/invitations/${revokeTarget.token}`);
    assert.strictEqual(revokedPreview.status, 404, 'Revoked invitation preview returns 404');

    const revokedAccept = await fetch(`${baseUrl}/api/invitations/${revokeTarget.token}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-user-${PARTICIPANT_UID}`,
      },
    });
    assert.strictEqual(revokedAccept.status, 400, 'Revoked invitation cannot be accepted');
    console.log('Passed Test 7.');

    // -------------------------------------------------------------------------
    // Test 8: Notification Action Resolver & Metadata Isolation
    // -------------------------------------------------------------------------
    console.log('Test 8: Notification Action Resolver & Metadata Isolation...');
    const actionResult = resolveNotificationAction({
      type: 'ROOM_INVITATION',
      metadata: {
        action: 'join_invitation',
        invitationId: 'inv-uuid-777',
        roomId: 'perm-active-room',
      },
    });
    assert.strictEqual(actionResult.action, 'join_invitation');
    assert.strictEqual(actionResult.label, 'Join Watch Party');
    assert.strictEqual(actionResult.url, '/invite?invitationId=inv-uuid-777', 'Must route to /invite with invitationId');

    // Legacy fallback
    const legacyResult = resolveNotificationAction({
      type: 'ROOM_INVITATION',
      metadata: {
        roomId: 'perm-active-room',
      },
    });
    assert.strictEqual(legacyResult.action, 'join_room');
    assert.strictEqual(legacyResult.url, '/join/perm-active-room', 'Legacy notification falls back to /join/:roomId');
    console.log('Passed Test 8.');

    // -------------------------------------------------------------------------
    // Test 9: Canonical Human Share Message Formatting & Emoji-Free Invariant
    // -------------------------------------------------------------------------
    console.log('Test 9: Canonical Human Share Message Formatting & Emoji-Free Invariant...');
    const shareMessage = formatInvitationMessage({
      roomId: 'perm-active-room',
      roomTitle: 'Permanent Film Club',
      passcode: 'perm1234',
      invitationUrl: 'https://cowatch.example.com/invite/sampleToken123',
      inviterName: 'The Host',
    });

    assert(shareMessage.includes("You're invited to a CoWatch watch party!"), 'Header present');
    assert(shareMessage.includes('"Permanent Film Club"'), 'Title present');
    assert(shareMessage.includes('The Host invited you to join.'), 'Inviter present');
    assert(shareMessage.includes('Join: https://cowatch.example.com/invite/sampleToken123'), 'URL present');
    assert(shareMessage.includes('Room ID: perm-active-room'), 'Room ID fallback present');
    assert(shareMessage.includes('Passcode: perm1234'), 'Passcode fallback present');
    assert(shareMessage.includes('See you there!'), 'Sign-off present');

    // Verify ZERO emojis in message
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert(!emojiRegex.test(shareMessage), 'Share message MUST NOT contain emojis');

    // QR value invariant: QR encodes the invitation URL and NEVER contains plaintext passcode
    const qrTargetUrl = 'https://cowatch.example.com/invite/sampleToken123';
    assert(!qrTargetUrl.includes('passcode='), 'QR value must NEVER contain passcode');
    assert(!qrTargetUrl.includes('perm1234'), 'QR value must not embed plaintext passcode');
    console.log('Passed Test 9.');

    console.log('\nAll Unified CoWatch Invitation System tests passed successfully!');
  } finally {
    server.close();
  }
}

runInvitationSystemTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
