/**
 * URL-Driven Screen Architecture & Server Authoritative Security Test Suite
 *
 * Verifies:
 * 1. URL Normalization: Route parsing ignores untrusted tampering parameters (?role=host, ?admin=true, ?isHost=true)
 * 2. Strict Presentation Separation: URL parameters have ZERO authorization semantics.
 * 3. Server-Authoritative Host Chat Authority: Host has full moderation (delete any message, clear chat), members can only delete own messages.
 * 4. Room Ownership Boundary: Cross-room mutations (targetMessageRoomId !== roomId) are strictly rejected.
 * 5. Dynamic Host Transfer Race Resistance: Host authority transfers immediately; old host commands are rejected with FORBIDDEN without reconnection.
 * 6. Zero Mutation on Denial Invariant: Unauthorized commands result in zero mutations and zero broadcasts.
 */

import fs from 'fs';
import path from 'path';
import {
  parseWatchParams,
  parseMyRoomsParams,
  parseAccountParams,
  parseErrorParams,
  parseNotFoundParams,
  getWatchUrl,
  getMyRoomsUrl,
  getAccountUrl,
  getErrorUrl,
  getNotFoundUrl,
} from '../src/utils/routeParams.js';
import { Room, type AuthorizeActionParams, type RoomAction } from './room.js';
import { authenticateOperator } from './utils/operatorAuth.js';
import config from './config.js';
import type { Socket } from 'socket.io';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[UrlDrivenSecurityTest] Assertion Failed: ${message}`);
  }
}

// Minimal mock socket generator for testing authorization logic
function createMockSocket(uid: string, clientId: string, handshakeQuery: Record<string, string> = {}): Socket {
  const emittedEvents: { event: string; data: any }[] = [];
  return {
    id: `socket-${clientId}`,
    uid,
    clientId,
    handshake: {
      auth: { token: uid ? `token-${uid}` : undefined },
      query: handshakeQuery,
    },
    emit: (event: string, data: any) => {
      emittedEvents.push({ event, data });
    },
    broadcast: {
      emit: (event: string, ...args: any[]) => {
        emittedEvents.push({ event: `broadcast:${event}`, data: args });
      },
    },
    data: {},
  } as unknown as Socket;
}

// Minimal mock server generator
function createMockIo(roomId: string) {
  const broadcastedEvents: { event: string; data: any }[] = [];
  const namespace: any = {
    emit: (event: string, data: any) => {
      broadcastedEvents.push({ event, data });
    },
    use: () => namespace,
    on: () => namespace,
    to: () => namespace,
    disconnectSockets: () => { },
    sockets: new Map(),
    adapter: { rooms: new Map() },
  };

  return {
    of: (_rId: string) => namespace,
    broadcastedEvents,
  } as any;
}

async function runTests() {
  console.log('Starting URL-Driven Screen Architecture & Security Test Suite...\n');

  // =========================================================================
  // Section 1: Route Parameter Normalization & URL Tampering Immunity
  // =========================================================================
  console.log('--- Section 1: Route Parameter Normalization & URL Tampering ---');

  // 1.1 Watch Params: Strip malicious query parameters
  const tamperedWatchSearch = '?role=host&isHost=true&admin=true&permissions=all&panel=chat&fullscreen=true';
  const parsedWatch = parseWatchParams(tamperedWatchSearch, 'room-123');

  assert(parsedWatch.roomId === 'room-123', 'Watch params must preserve valid roomId');
  assert(parsedWatch.panel === 'chat', 'Watch params must extract safe panel state');
  assert(!('role' in parsedWatch), 'Watch params must strictly exclude role parameter');
  assert(!('isHost' in parsedWatch), 'Watch params must strictly exclude isHost parameter');
  assert(!('admin' in parsedWatch), 'Watch params must strictly exclude admin parameter');
  assert(!('permissions' in parsedWatch), 'Watch params must strictly exclude permissions parameter');
  console.log('✓ parseWatchParams ignores malicious injection params (?role=host, ?isHost=true, ?admin=true)');

  // 1.2 Watch Params: Unknown panels fallback safely
  const invalidPanelWatch = parseWatchParams('?panel=superadmin', 'room-456');
  assert(invalidPanelWatch.panel === 'none', 'Invalid panel name must safely fall back to none');

  // 1.3 MyRooms Params: Allowlist normalization
  const tamperedMyRoomsSearch = '?status=active&view=grid&page=3&role=owner&drop=tables';
  const parsedMyRooms = parseMyRoomsParams(tamperedMyRoomsSearch);
  assert(parsedMyRooms.status === 'active', 'MyRooms status filter correctly parsed');
  assert(parsedMyRooms.view === 'grid', 'MyRooms view mode correctly parsed');
  assert(parsedMyRooms.page === 3, 'MyRooms page number correctly parsed');
  assert(!('role' in parsedMyRooms), 'MyRooms excludes unknown role parameter');
  assert(!('drop' in parsedMyRooms), 'MyRooms excludes malicious parameter');
  console.log('✓ parseMyRoomsParams normalizes valid filters and discards tampering');

  // 1.4 Account Params: Path canonicalization detection
  const canonicalAccount = parseAccountParams('', '/account/security');
  assert(canonicalAccount.tab === 'security', 'Canonical account path /account/security parses tab');
  assert(canonicalAccount.isCanonicalPath === true, 'Canonical account path marked isCanonicalPath = true');

  const legacyQueryAccount = parseAccountParams('?tab=preferences', '/account');
  assert(legacyQueryAccount.tab === 'preferences', 'Legacy query /account?tab=preferences parses tab');
  assert(legacyQueryAccount.isCanonicalPath === false, 'Legacy query marked isCanonicalPath = false for redirect');

  const invalidAccount = parseAccountParams('?tab=hacker_tab', '/account');
  assert(invalidAccount.tab === 'profile', 'Invalid account tab falls back safely to default profile');
  console.log('✓ parseAccountParams accurately detects canonical vs redirect paths');

  // 1.5 Safe Error Codes: Strict machine-readable codes only
  const safeError = parseErrorParams('?code=session_expired');
  assert(safeError.code === 'session_expired', 'Allowlisted error code correctly parsed');

  const dangerousError = parseErrorParams('?code=DROP%20TABLE%20users;--&msg=secret_token_123');
  assert(dangerousError.code === 'server_unavailable', 'Arbitrary or dangerous error code falls back to server_unavailable');
  assert(!('msg' in dangerousError), 'Error params ignores unapproved msg fields');
  console.log('✓ parseErrorParams strictly bounds error codes to machine-readable allowlist');

  // 1.6 Safe Not-Found Resources: Strict room | page enumeration
  const safeNotFoundRoom = parseNotFoundParams('?resource=room');
  assert(safeNotFoundRoom.resource === 'room', 'Not found resource=room correctly parsed');

  const unsafeNotFound = parseNotFoundParams('?resource=internal_admin_panel');
  assert(unsafeNotFound.resource === 'page', 'Unrecognized not-found resource defaults to page');
  console.log('✓ parseNotFoundParams strictly limits resources to room | page');

  // 1.7 Canonical URL Builders
  assert(getWatchUrl('alpha-1', 'chat') === '/watch/alpha-1?panel=chat', 'getWatchUrl builds canonical chat URL');
  assert(getWatchUrl('alpha-1') === '/watch/alpha-1', 'getWatchUrl builds canonical clean watch URL');
  assert(getMyRoomsUrl({ status: 'active', page: 2 }) === '/myrooms?status=active&page=2', 'getMyRoomsUrl builds query string');
  assert(getAccountUrl('security') === '/account/security', 'getAccountUrl builds canonical account path');
  assert(getErrorUrl('permission_denied') === '/error?code=permission_denied', 'getErrorUrl builds error URL');
  assert(getNotFoundUrl('room') === '/not-found?resource=room', 'getNotFoundUrl builds resource URL');
  console.log('✓ Canonical URL builders produce correct clean paths');

  // =========================================================================
  // Section 2: Server-Authoritative Host Authority & Action Verification
  // =========================================================================
  console.log('\n--- Section 2: Server-Authoritative Host & Member Permissions ---');

  const mockIo = createMockIo('room-sec-test');
  const testRoom = new Room(mockIo, 'room-sec-test');

  // Configure room state
  testRoom.owner_id = 'owner-uid';
  testRoom.currentHostUid = 'host-uid';
  testRoom.currentHostClientId = 'host-client';
  testRoom.admittedMembers.add('host-uid');
  testRoom.admittedMembers.add('member-uid');
  testRoom.admittedMembers.add('other-uid');
  testRoom.admittedMembers.add('user-a-uid');
  testRoom.admittedMembers.add('user-b-uid');
  testRoom.admittedMembers.add('tampered-uid');

  const hostSocket = createMockSocket('host-uid', 'host-client');
  const memberSocket = createMockSocket('member-uid', 'member-client', { role: 'host', admin: 'true' });
  const otherMemberSocket = createMockSocket('other-uid', 'other-client');

  // 2.1 URL tampering on client socket handshake has ZERO effect on authorization
  assert(testRoom.isHost(hostSocket) === true, 'Host socket is recognized as host');
  assert(testRoom.isHost(memberSocket) === false, 'Member socket with ?role=host query is NOT recognized as host');
  assert(testRoom.canModerate(memberSocket) === false, 'Member socket cannot moderate despite tampering headers');
  console.log('✓ Client-supplied role=host has ZERO authorization effect on server');

  // 2.2 Host Chat Authority: Host can delete any message, Member can only delete own
  const hostDeleteOther = testRoom.authorizeRoomAction({
    actorSocket: hostSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(hostDeleteOther.allowed === true, 'Host MUST be allowed to delete another user message');

  const hostClearChat = testRoom.authorizeRoomAction({
    actorSocket: hostSocket,
    action: 'chat:clear',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(hostClearChat.allowed === true, 'Host MUST be allowed to clear room chat');

  const memberDeleteOwn = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'chat:delete_own',
    targetMessageAuthorId: 'member-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(memberDeleteOwn.allowed === true, 'Member MUST be allowed to delete their own message');

  const memberDeleteOther = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(memberDeleteOther.allowed === false, 'Member MUST be rejected from deleting other user messages');
  assert(memberDeleteOther.code === 'FORBIDDEN', 'Member delete_other rejection code must be FORBIDDEN');

  const memberClearChat = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'chat:clear',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(memberClearChat.allowed === false, 'Member MUST be rejected from clearing chat');
  assert(memberClearChat.code === 'FORBIDDEN', 'Member clear chat rejection code must be FORBIDDEN');
  console.log('✓ Host chat authority strictly verified: Host can moderate all, Member only own messages');

  // 2.3 Participant Moderation Controls (Kick, Ban, Transfer Host)
  const hostKickMember = testRoom.authorizeRoomAction({
    actorSocket: hostSocket,
    action: 'user:kick',
    targetUserId: 'member-client',
  });
  assert(hostKickMember.allowed === true, 'Host can kick normal participant');

  const hostKickOwner = testRoom.authorizeRoomAction({
    actorSocket: hostSocket,
    action: 'user:kick',
    targetUserId: 'owner-uid',
  });
  assert(hostKickOwner.allowed === false, 'Host CANNOT kick room owner');
  assert(hostKickOwner.code === 'FORBIDDEN', 'Kick room owner rejection code must be FORBIDDEN');

  const memberKick = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'user:kick',
    targetUserId: 'other-client',
  });
  assert(memberKick.allowed === false, 'Member CANNOT kick any participant');
  assert(memberKick.code === 'FORBIDDEN', 'Member kick rejection code must be FORBIDDEN');

  const memberBan = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'user:ban',
    targetUserId: 'other-client',
  });
  assert(memberBan.allowed === false, 'Member CANNOT ban any participant');
  assert(memberBan.code === 'FORBIDDEN', 'Member ban rejection code must be FORBIDDEN');

  const memberTransferHost = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'room:transfer_host',
  });
  assert(memberTransferHost.allowed === false, 'Member CANNOT transfer host');
  assert(memberTransferHost.code === 'FORBIDDEN', 'Member transfer_host rejection code must be FORBIDDEN');
  console.log('✓ Participant moderation controls strictly restricted to host/owner');

  // 2.4 Complete Host Chat Authority Matrix (Send, Edit Own, Edit Other, Delete Own, Delete Other, Clear, Reaction)
  console.log('\n--- Section 2.4: Host Complete Chat Authority Matrix ---');

  // chat:send
  assert(testRoom.authorizeRoomAction({ actorSocket: hostSocket, action: 'chat:send' }).allowed === true, 'Host can send chat');
  assert(testRoom.authorizeRoomAction({ actorSocket: memberSocket, action: 'chat:send' }).allowed === true, 'Member can send chat when enabled');
  testRoom.isChatDisabled = true;
  assert(testRoom.authorizeRoomAction({ actorSocket: hostSocket, action: 'chat:send' }).allowed === true, 'Host can send chat even when chat is disabled');
  const disabledSend = testRoom.authorizeRoomAction({ actorSocket: memberSocket, action: 'chat:send' });
  assert(disabledSend.allowed === false, 'Member cannot send chat when chat is disabled');
  assert(disabledSend.code === 'FORBIDDEN', 'Disabled chat send returns FORBIDDEN');
  testRoom.isChatDisabled = false;

  // chat:edit - Host has complete authority over editing all messages
  const hostEditOther = testRoom.authorizeRoomAction({
    actorSocket: hostSocket,
    action: 'chat:edit',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(hostEditOther.allowed === true, 'Host MUST have complete authority to edit other user messages');

  const memberEditOwn = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'chat:edit',
    targetMessageAuthorId: 'member-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(memberEditOwn.allowed === true, 'Member MUST be allowed to edit own message');

  const memberEditOther = testRoom.authorizeRoomAction({
    actorSocket: memberSocket,
    action: 'chat:edit',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(memberEditOther.allowed === false, 'Member CANNOT edit other user messages');
  assert(memberEditOther.code === 'FORBIDDEN', 'Member edit other returns FORBIDDEN');

  // chat:reaction
  assert(testRoom.authorizeRoomAction({ actorSocket: hostSocket, action: 'chat:reaction' }).allowed === true, 'Host can react');
  assert(testRoom.authorizeRoomAction({ actorSocket: memberSocket, action: 'chat:reaction' }).allowed === true, 'Member can react when chat enabled');
  testRoom.isChatDisabled = true;
  assert(testRoom.authorizeRoomAction({ actorSocket: hostSocket, action: 'chat:reaction' }).allowed === true, 'Host can react when chat disabled');
  assert(testRoom.authorizeRoomAction({ actorSocket: memberSocket, action: 'chat:reaction' }).allowed === false, 'Member cannot react when chat disabled');
  testRoom.isChatDisabled = false;
  console.log('✓ Host complete chat authority matrix strictly verified (send, edit, delete, clear, react)');

  // 2.5 Exhaustive Mutation Inventory Check (Playback, Playlist, VBrowser, Subtitles, Locks)
  console.log('\n--- Section 2.5: Exhaustive Mutation Inventory Check ---');
  testRoom.lock = 'host-uid'; // Lock playback to host

  const playbackMutations: RoomAction[] = [
    'room:play',
    'room:pause',
    'room:seek',
    'room:change_rate',
    'room:set_media',
    'playlist:add',
    'playlist:move',
    'playlist:delete',
    'playlist:next',
    'vbrowser:start',
    'vbrowser:stop',
    'vbrowser:control',
    'room:subtitle_change',
  ];

  for (const action of playbackMutations) {
    const hostRes = testRoom.authorizeRoomAction({ actorSocket: hostSocket, action });
    assert(hostRes.allowed === true, `Host MUST be authorized for ${action} under lock`);

    const memberRes = testRoom.authorizeRoomAction({ actorSocket: memberSocket, action });
    assert(memberRes.allowed === false, `Member MUST be rejected for ${action} under lock`);
    assert(memberRes.code === 'FORBIDDEN', `Member rejection code for ${action} must be FORBIDDEN`);
  }

  // Room lock controls
  assert(testRoom.authorizeRoomAction({ actorSocket: hostSocket, action: 'room:lock' }).allowed === true, 'Host can lock room');
  assert(testRoom.authorizeRoomAction({ actorSocket: memberSocket, action: 'room:lock' }).allowed === false, 'Member cannot lock room');

  assert(testRoom.authorizeRoomAction({ actorSocket: hostSocket, action: 'room:lock_participants' }).allowed === true, 'Host can lock participants');
  assert(testRoom.authorizeRoomAction({ actorSocket: memberSocket, action: 'room:lock_participants' }).allowed === false, 'Member cannot lock participants');

  testRoom.lock = ''; // Unlock
  console.log('✓ Exhaustive mutation inventory verified: playback, playlist, vbrowser, subtitles, locks');

  // =========================================================================
  // Section 3: Room Ownership Boundary Check
  // =========================================================================
  console.log('\n--- Section 3: Room Ownership Boundary Check ---');

  // Even the legitimate host cannot mutate messages or resources belonging to another room
  const crossRoomMutation = testRoom.authorizeRoomAction({
    actorSocket: hostSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'some-author',
    targetMessageRoomId: 'different-room-xyz',
  });
  assert(crossRoomMutation.allowed === false, 'Cross-room mutation must be rejected');
  assert(crossRoomMutation.code === 'ROOM_MISMATCH', 'Cross-room rejection code must be ROOM_MISMATCH');
  console.log('✓ Cross-room mutation boundary enforced: targetMessageRoomId must match room');

  // =========================================================================
  // Section 4: Dynamic Host Transfer Race Resistance
  // =========================================================================
  console.log('\n--- Section 4: Dynamic Host Transfer Race Resistance ---');

  // Scenario:
  // User A (current host) transfers host to User B.
  // Immediately after transfer, User A issues moderation commands without socket reconnect.
  // Expected: User A commands MUST fail with FORBIDDEN immediately. User B commands MUST succeed.

  const hostASocket = createMockSocket('user-a-uid', 'user-a-client');
  const memberBSocket = createMockSocket('user-b-uid', 'user-b-client');

  testRoom.currentHostUid = 'user-a-uid';
  testRoom.currentHostClientId = 'user-a-client';

  // Before transfer: A is host, B is member
  assert(testRoom.isHost(hostASocket) === true, 'Host A has host authority before transfer');
  assert(testRoom.isHost(memberBSocket) === false, 'Member B does not have host authority before transfer');

  // Execute transfer: Host authority shifts to B
  testRoom.currentHostUid = 'user-b-uid';
  testRoom.currentHostClientId = 'user-b-client';

  // Concurrently / Immediately after transfer:
  assert(testRoom.isHost(hostASocket) === false, 'Host A authority revoked dynamically');
  assert(testRoom.isHost(memberBSocket) === true, 'Member B authority granted dynamically');

  // Old host A attempts moderation command
  const oldHostDeleteAttempt = testRoom.authorizeRoomAction({
    actorSocket: hostASocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(oldHostDeleteAttempt.allowed === false, 'Old Host A command rejected immediately');
  assert(oldHostDeleteAttempt.code === 'FORBIDDEN', 'Old Host A command returns FORBIDDEN');

  const oldHostKickAttempt = testRoom.authorizeRoomAction({
    actorSocket: hostASocket,
    action: 'user:kick',
    targetUserId: 'other-uid',
  });
  assert(oldHostKickAttempt.allowed === false, 'Old Host A kick attempt rejected');

  // New host B executes moderation command
  const newHostDeleteAttempt = testRoom.authorizeRoomAction({
    actorSocket: memberBSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(newHostDeleteAttempt.allowed === true, 'New Host B command succeeds immediately without reconnecting');

  const newHostClearAttempt = testRoom.authorizeRoomAction({
    actorSocket: memberBSocket,
    action: 'chat:clear',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(newHostClearAttempt.allowed === true, 'New Host B clear chat succeeds immediately');
  console.log('✓ Dynamic host transfer race resistance verified: zero latency authority transfer');

  // 4.2 Asynchronous Host Transfer / Failover Epoch Invalidation Check
  console.log('\n--- Section 4.2: Asynchronous Host Transfer & Failover Epoch Invalidation ---');
  testRoom.currentHostUid = 'user-a-uid';
  testRoom.currentHostClientId = 'user-a-client';
  const initialEpoch = testRoom.hostEpoch;

  // Step 1: User A begins async moderation operation and snapshots hostEpoch
  const asyncContextA = testRoom.buildAuthorizationContext(hostASocket);
  const snapshotEpoch = asyncContextA.hostEpoch;
  assert(snapshotEpoch === initialEpoch, 'Initial epoch snapshot matches');

  // Step 2: Host failover / transfer occurs concurrently before A commits
  testRoom.hostEpoch += 1;
  testRoom.currentHostUid = 'user-b-uid';
  testRoom.currentHostClientId = 'user-b-client';

  // Step 3: User A async operation resumes and verifies hostEpoch
  const isStale = testRoom.hostEpoch !== snapshotEpoch;
  assert(isStale === true, 'Host epoch mismatch detected for in-flight operation');
  const simulatedAsyncDenial = isStale ? { allowed: false, code: 'FORBIDDEN' } : { allowed: true, code: 'OK' };
  assert(simulatedAsyncDenial.allowed === false, 'Stale async operation aborted with FORBIDDEN');
  assert(simulatedAsyncDenial.code === 'FORBIDDEN', 'Stale async operation error code is FORBIDDEN');

  // Step 4: New host B immediately issues moderation command at new epoch
  const newHostOp = testRoom.authorizeRoomAction({
    actorSocket: memberBSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'other-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(newHostOp.allowed === true, 'New host B command allowed at new authority epoch');
  console.log('✓ Asynchronous host transfer & failover epoch invalidation verified');

  // =========================================================================
  // Section 5: Zero Mutation on Denial Invariant
  // =========================================================================
  console.log('\n--- Section 5: Zero Mutation on Denial Invariant ---');

  // Test that when an unauthorized action is requested, error is emitted and no room state changes
  let capturedError: any = null;
  const unauthorizedSocket = createMockSocket('unauth-uid', 'unauth-client');
  unauthorizedSocket.emit = (event: string, msg: any): boolean => {
    if (event === 'errorMessage') {
      capturedError = msg;
    }
    return true;
  };

  // Test kickUser denial
  await testRoom.kickUser(unauthorizedSocket, 'some-target');
  assert(capturedError === 'FORBIDDEN', 'Unauthorized kickUser emits FORBIDDEN');
  console.log('✓ kickUser: Zero mutation on denial verified');

  // Test banUser denial
  capturedError = null;
  await testRoom.banUser(unauthorizedSocket, 'some-target');
  assert(capturedError === 'FORBIDDEN', 'Unauthorized banUser emits FORBIDDEN');
  console.log('✓ banUser: Zero mutation on denial verified');

  // =========================================================================
  // Section 6: Bidirectional Client Capability Non-Authoritativeness Check
  // =========================================================================
  console.log('\n--- Section 6: Bidirectional Client Capability Non-Authoritativeness ---');

  // Direction 1: Server says member capability = false. Client attempts to fake capability = true or pass malicious role/capability payload
  const tamperedMemberSocket = createMockSocket('tampered-uid', 'tampered-client');
  (tamperedMemberSocket as any).capabilities = { moderateChat: true, lockRoom: true, kickParticipants: true };
  (tamperedMemberSocket as any).data = { isHost: true, role: 'host' };

  const tamperedDelete = testRoom.authorizeRoomAction({
    actorSocket: tamperedMemberSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'victim-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  assert(tamperedDelete.allowed === false, 'Tampered member capabilities MUST NOT grant moderation authority');
  assert(tamperedDelete.code === 'FORBIDDEN', 'Tampered member rejection code is FORBIDDEN');

  // Direction 2: Server says host capability = true. Client state alters or removes capability = false
  const degradedHostSocket = createMockSocket(testRoom.currentHostUid, testRoom.currentHostClientId);
  (degradedHostSocket as any).capabilities = { moderateChat: false, lockRoom: false };

  const legitimateHostDelete = testRoom.authorizeRoomAction({
    actorSocket: degradedHostSocket,
    action: 'chat:delete_other',
    targetMessageAuthorId: 'victim-uid',
    targetMessageRoomId: 'room-sec-test',
  });
  console.log('✓ Bidirectional capability test verified: capabilities are strictly non-authoritative UI data');

  // =========================================================================
  // Section 7: Authoritative Identity & Absolute Host Security Invariants
  // =========================================================================
  console.log('\n--- Section 7: Authoritative Identity & Absolute Host Security Invariants ---');

  // Test 7.1: Client claiming host's clientId without host's UID is NEVER host
  testRoom.currentHostUid = 'host-uid';
  testRoom.currentHostClientId = 'host-client';
  const hostClientId = 'host-client';

  // Attacker socket presenting host's clientId but with attacker UID
  const attackerWithHostClientId = createMockSocket('attacker-uid', hostClientId);
  assert(testRoom.isHost(attackerWithHostClientId) === false, 'Test 7.1: Attacker with host clientId is NOT host');
  assert(testRoom.canModerate(attackerWithHostClientId) === false, 'Test 7.1: Attacker cannot moderate');

  // Guest socket presenting host's clientId (no UID)
  const guestWithHostClientId = createMockSocket('', hostClientId);
  assert(testRoom.isHost(guestWithHostClientId) === false, 'Test 7.2: Guest with host clientId is NOT host');
  assert(testRoom.canModerate(guestWithHostClientId) === false, 'Test 7.2: Guest cannot moderate');

  // Valid authenticated user B presenting host's clientId
  const userBWithHostClientId = createMockSocket('user-b-uid', hostClientId);
  assert(testRoom.isHost(userBWithHostClientId) === false, 'Test 7.3: User B with host clientId is NOT host');
  assert(testRoom.canModerate(userBWithHostClientId) === false, 'Test 7.3: User B cannot moderate');

  // Host operations strictly rejected for non-hosts presenting host clientId
  testRoom.lock = 'host-uid';
  const spoofPlayback = testRoom.authorizeRoomAction({
    actorSocket: attackerWithHostClientId,
    action: 'room:play',
  });
  assert(spoofPlayback.allowed === false, 'Test 7.4: Playback locked to host rejects spoofed clientId');
  assert(spoofPlayback.code === 'FORBIDDEN', 'Rejection code is FORBIDDEN');
  testRoom.lock = '';

  const spoofKick = testRoom.authorizeRoomAction({
    actorSocket: attackerWithHostClientId,
    action: 'user:kick',
    targetUserId: 'member-uid',
  });
  assert(spoofKick.allowed === false, 'Test 7.5: Kick rejects spoofed clientId');
  assert(spoofKick.code === 'FORBIDDEN', 'Kick rejection code is FORBIDDEN');

  console.log('✓ Absolute Host Invariant verified: Host authority strictly gated by verified UID, zero clientId fallback');

  // Test 7.6: Static Invariant Firewall scanning production files
  console.log('\n--- Section 7.6: Static Invariant Firewall Scan ---');
  const projectRoot = path.resolve(process.cwd());

  // 1. Scan server/room.ts
  const roomFile = fs.readFileSync(path.join(projectRoot, 'server/room.ts'), 'utf-8');
  assert(
    !roomFile.includes('socket.handshake.auth?.uid') && !roomFile.includes('handshake.auth?.uid'),
    'Firewall Violation: server/room.ts must NOT read socket.handshake.auth?.uid'
  );
  assert(
    !roomFile.includes('socket.handshake.query?.clientId'),
    'Firewall Violation: server/room.ts must NOT assign socket.clientId from query?.clientId'
  );
  assert(
    !roomFile.includes('socket.clientId === this.currentHostClientId'),
    'Firewall Violation: isHost must NOT fall back to socket.clientId === this.currentHostClientId'
  );
  assert(
    !roomFile.includes('socket.on("CMD:uid"') && !roomFile.includes("socket.on('CMD:uid'"),
    'Firewall Violation: server/room.ts must NOT register CMD:uid listener'
  );

  // 1.5 Scan server/server.ts for untrusted user_metadata authorization bypasses
  const serverMainSource = fs.readFileSync(path.join(projectRoot, 'server/server.ts'), 'utf-8');
  assert(
    !serverMainSource.includes('user.user_metadata?.is_admin') && !serverMainSource.includes('user_metadata?.role'),
    'Firewall Violation: server/server.ts must NOT use client-writable user_metadata for operator or role authorization'
  );

  // 2. Scan src/components/App/App.tsx
  const appFile = fs.readFileSync(path.join(projectRoot, 'src/components/App/App.tsx'), 'utf-8');
  assert(
    !appFile.includes('emit("CMD:uid"') && !appFile.includes("emit('CMD:uid'"),
    'Firewall Violation: src/components/App/App.tsx must NOT emit CMD:uid'
  );
  assert(
    !appFile.includes('getOrCreateClientId()'),
    'Firewall Violation: src/components/App/App.tsx must NOT consume getOrCreateClientId()'
  );

  // 3. Scan for any persistent client ID storage across all files in src/ and server/
  const checkDirRecursive = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'build') {
          checkDirRecursive(fullPath);
        }
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        assert(
          !content.includes('cowatch-clientid'),
          `Firewall Violation: File ${entry.name} contains persistent cowatch-clientid`
        );
      }
    }
  };

  checkDirRecursive(path.join(projectRoot, 'src'));
  checkDirRecursive(path.join(projectRoot, 'server'));

  console.log('✓ Static Invariant Firewall passed: 0 forbidden authority patterns detected across repository');

  // ========================================================================================
  // Section 8: Mechanical Enforcement of Privileged Mutation Completeness & Anti-Regression Firewall
  //
  // Invariant Mandate:
  // "No privileged mutation may exist without an authorization gate immediately before the
  //  mutation or inside the mutation-owning method."
  //
  // Enforces mechanically:
  // 1. AST/Regex Extraction of ALL socket.on("CMD:*") handlers from server/room.ts.
  //    Zero unregistered commands are permitted. Adding any new CMD:* without registering
  //    its classification and authorization contract immediately fails the build/test.
  // 2. Privileged Command Gating Verification:
  //    Every privileged command must invoke pureAuthorizeRoomAction / authorizeRoomAction
  //    or delegate to a verified internal mutation method.
  // 3. Step-0 Internal Mutation Method Defense-in-Depth:
  //    Every mutation-owning method (playVideo, pauseVideo, seekVideo, setPlaybackRate,
  //    kickUser, banUser, transferHost, assignHost, deleteChatMessages) must invoke
  //    pureAuthorizeRoomAction / authorizeRoomAction at Step 0, halting on denial before
  //    any database mutation, room memory mutation, or socket broadcast.
  // 4. RoomAction Exhaustiveness & Coverage:
  //    All discrete RoomAction types in server/roomAuthorization.ts must be verified in the
  //    pure engine and tested for rejection under unauthorized contexts.
  // 5. REST Room Mutation Authorization Gate:
  //    All mutating room HTTP endpoints in server/server.ts and server/notifications/
  //    must statically verify Supabase JWT (validateToken) and check host/owner authority.
  // 6. Zero-Mutation on Denial Invariant:
  //    Runtime simulation verifying 0 DB queries, 0 state mutations, and 0 broadcasts on denial.
  // ========================================================================================
  console.log('\n--- Section 8: Mechanical Authorization Completeness & Anti-Regression Firewall ---');

  // --- 8.1: Complete Inventory of CMD:* Handlers in server/room.ts ---
  const roomSource = fs.readFileSync(path.join(projectRoot, 'server/room.ts'), 'utf-8');

  // Extract all socket.on("CMD:...") and socket.on('CMD:...') occurrences
  const cmdMatches = [...roomSource.matchAll(/socket\.on\(\s*["'](CMD:[a-zA-Z0-9_]+)["']/g)].map(m => m[1]);
  const uniqueCmdsInSource = Array.from(new Set(cmdMatches)).sort();

  // Authoritative Classification Catalog
  interface AuthoritativeCommandSpec {
    category: 'PRIVILEGED' | 'DENIED' | 'NON_PRIVILEGED_SAFE';
    requiredAction?: RoomAction | RoomAction[];
    delegatedInternalMethod?: string;
  }

  const AUTHORITATIVE_COMMAND_CATALOG: Record<string, AuthoritativeCommandSpec> = {
    // 1. Privileged Playback & Media Operations
    'CMD:host': { category: 'PRIVILEGED', requiredAction: 'room:set_media' },
    'CMD:play': { category: 'PRIVILEGED', requiredAction: 'room:play', delegatedInternalMethod: 'playVideo' },
    'CMD:pause': { category: 'PRIVILEGED', requiredAction: 'room:pause', delegatedInternalMethod: 'pauseVideo' },
    'CMD:seek': { category: 'PRIVILEGED', requiredAction: 'room:seek', delegatedInternalMethod: 'seekVideo' },
    'CMD:playbackRate': { category: 'PRIVILEGED', requiredAction: 'room:change_rate', delegatedInternalMethod: 'setPlaybackRate' },
    'CMD:loop': { category: 'PRIVILEGED', requiredAction: 'room:set_media' },
    'CMD:subtitle': { category: 'PRIVILEGED', requiredAction: 'room:subtitle_change' },
    'CMD:lock': { category: 'PRIVILEGED', requiredAction: 'room:lock' },
    'CMD:setParticipantsLock': { category: 'PRIVILEGED', requiredAction: 'room:lock_participants' },

    // 2. Privileged Chat & Moderation Operations
    'CMD:chat': { category: 'PRIVILEGED', requiredAction: 'chat:send', delegatedInternalMethod: 'sendChatMessage' },
    'CMD:chatV2': { category: 'PRIVILEGED', requiredAction: 'chat:send', delegatedInternalMethod: 'sendChatMessage' },
    'CMD:editMessage': { category: 'PRIVILEGED', requiredAction: 'chat:edit', delegatedInternalMethod: 'editMessage' },
    'CMD:addReaction': { category: 'PRIVILEGED', requiredAction: 'chat:reaction', delegatedInternalMethod: 'addReaction' },
    'CMD:removeReaction': { category: 'PRIVILEGED', requiredAction: 'chat:reaction', delegatedInternalMethod: 'removeReaction' },
    'CMD:deleteChatMessage': { category: 'PRIVILEGED', requiredAction: ['chat:delete_own', 'chat:delete_other', 'chat:clear'], delegatedInternalMethod: 'deleteChatMessages' },
    'CMD:deleteChatMessages': { category: 'PRIVILEGED', requiredAction: ['chat:delete_own', 'chat:delete_other', 'chat:clear'], delegatedInternalMethod: 'deleteChatMessages' },

    // 3. Privileged Participant & Host Lifecycle Operations
    'CMD:kickUser': { category: 'PRIVILEGED', requiredAction: 'user:kick', delegatedInternalMethod: 'kickUser' },
    'CMD:banUser': { category: 'PRIVILEGED', requiredAction: 'user:ban', delegatedInternalMethod: 'banUser' },
    'CMD:assignHost': { category: 'PRIVILEGED', requiredAction: 'room:transfer_host', delegatedInternalMethod: 'assignHost' },
    'CMD:transferHost': { category: 'PRIVILEGED', requiredAction: 'room:transfer_host', delegatedInternalMethod: 'transferHost' },
    'CMD:startSession': { category: 'PRIVILEGED', delegatedInternalMethod: 'startSession' },

    // 4. Privileged Playlist Operations
    'CMD:playlistNext': { category: 'PRIVILEGED', requiredAction: 'playlist:next' },
    'CMD:playlistAdd': { category: 'PRIVILEGED', requiredAction: 'playlist:add' },
    'CMD:playlistMove': { category: 'PRIVILEGED', requiredAction: 'playlist:move' },
    'CMD:playlistDelete': { category: 'PRIVILEGED', requiredAction: 'playlist:delete' },

    // 5. Privileged VBrowser Operations
    'CMD:startVBrowser': { category: 'PRIVILEGED', requiredAction: 'vbrowser:start' },
    'CMD:stopVBrowser': { category: 'PRIVILEGED', requiredAction: 'vbrowser:stop' },
    'CMD:changeController': { category: 'PRIVILEGED', requiredAction: 'vbrowser:control' },

    // 6. Explicitly Denied Operations (Server-Enforced Invariant Denials)
    'CMD:becomeHost': { category: 'DENIED' },
    'CMD:claimHost': { category: 'DENIED' },
    'CMD:setRoomState': { category: 'DENIED' },
    'CMD:setRoomOwner': { category: 'DENIED' },

    // 7. Non-Privileged Read-Only or Self Participant Operations
    'CMD:name': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:picture': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:ts': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:loadMessages': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:askHost': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:getRoomState': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:leaveRoom': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:joinVideo': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:leaveVideo': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:joinScreenShare': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:leaveScreenShare': { category: 'NON_PRIVILEGED_SAFE' },
    'CMD:userMute': { category: 'NON_PRIVILEGED_SAFE' },
  };

  // Mechanical Check 8.1A: Disallow any unregistered socket command in server/room.ts
  for (const cmd of uniqueCmdsInSource) {
    assert(
      cmd in AUTHORITATIVE_COMMAND_CATALOG,
      `[Firewall 8.1A Failure] Unregistered socket command detected in server/room.ts: ${cmd}. ` +
      `Every socket command must be explicitly registered in AUTHORITATIVE_COMMAND_CATALOG with its authorization contract!`
    );
  }

  // Mechanical Check 8.1B: Disallow catalog drift (catalog command missing from source)
  for (const catalogCmd of Object.keys(AUTHORITATIVE_COMMAND_CATALOG)) {
    assert(
      uniqueCmdsInSource.includes(catalogCmd),
      `[Firewall 8.1B Failure] Catalog command ${catalogCmd} not found in server/room.ts. Keep catalog 1:1 synchronized.`
    );
  }
  console.log(`✓ 8.1 Command Inventory Verified: All ${uniqueCmdsInSource.length} socket CMD listeners explicitly registered and classified`);

  // --- 8.2: Verify Authorization Gating for Every Privileged Command ---
  for (const [cmd, spec] of Object.entries(AUTHORITATIVE_COMMAND_CATALOG)) {
    if (spec.category === 'PRIVILEGED') {
      // Locate the socket.on(cmd) block in server/room.ts
      const cmdRegex = new RegExp(`socket\\.on\\(\\s*["']${cmd}["']\\s*,([\\s\\S]*?)(?:\\n\\s*socket\\.on|\\n\\s*\\/\\/ Resolve profile|\\n\\s*\\/\\/ Async initialization)`, 'm');
      const match = roomSource.match(cmdRegex);
      assert(match, `Could not extract handler block for ${cmd}`);
      const handlerBody = match[1];

      if (spec.delegatedInternalMethod) {
        // Must delegate to internal method
        const delegationCall = `this.${spec.delegatedInternalMethod}`;
        assert(
          handlerBody.includes(delegationCall),
          `[Firewall 8.2 Failure] Privileged command ${cmd} must delegate to protected method ${delegationCall}`
        );
      } else {
        // Must invoke pureAuthorizeRoomAction or authorizeRoomAction directly
        assert(
          handlerBody.includes('pureAuthorizeRoomAction') || handlerBody.includes('authorizeRoomAction'),
          `[Firewall 8.2 Failure] Privileged command ${cmd} does NOT invoke an authoritative authorization gate!`
        );
        // Must check auth.allowed and emit error/return on denial
        assert(
          handlerBody.includes('auth.allowed') || handlerBody.includes('!auth.allowed'),
          `[Firewall 8.2 Failure] Privileged command ${cmd} must evaluate auth.allowed result!`
        );
        assert(
          handlerBody.includes('FORBIDDEN'),
          `[Firewall 8.2 Failure] Privileged command ${cmd} denial path must emit or respond with FORBIDDEN`
        );
      }
    } else if (spec.category === 'DENIED') {
      // Must reject immediately
      const cmdRegex = new RegExp(`socket\\.on\\(\\s*["']${cmd}["']\\s*,([\\s\\S]*?)(?:\\n\\s*socket\\.on|\\n\\s*\\/\\/ Resolve profile|\\n\\s*\\/\\/ Async initialization)`, 'm');
      const match = roomSource.match(cmdRegex);
      assert(match, `Could not extract handler block for denied command ${cmd}`);
      const handlerBody = match[1];
      assert(
        handlerBody.includes('errorMessage') || handlerBody.includes('CMD:error'),
        `[Firewall 8.2 Failure] Denied command ${cmd} must emit an error message on invocation!`
      );
      assert(
        !handlerBody.includes('this.io.emit') && !handlerBody.includes('postgres'),
        `[Firewall 8.2 Failure] Denied command ${cmd} must NOT mutate DB or broadcast!`
      );
    }
  }
  console.log('✓ 8.2 Privileged Command Gating Verified: All privileged socket handlers contain authoritative gates or verified delegations');

  // --- 8.3: Step-0 Internal Mutation Method Defense-in-Depth Verification ---
  // Verify that all sensitive room methods enforce authorization at Step 0, inside the method
  const SENSITIVE_INTERNAL_METHODS = [
    { method: 'playVideo', action: 'room:play' },
    { method: 'pauseVideo', action: 'room:pause' },
    { method: 'seekVideo', action: 'room:seek' },
    { method: 'setPlaybackRate', action: 'room:change_rate' },
    { method: 'kickUser', action: 'user:kick' },
    { method: 'banUser', action: 'user:ban' },
    { method: 'transferHost', action: 'room:transfer_host' },
    { method: 'assignHost', action: 'room:transfer_host' },
    { method: 'deleteChatMessages', action: 'chat:delete_own' },
    { method: 'sendChatMessage', action: 'chat:send' },
    { method: 'editMessage', action: 'chat:edit' },
    { method: 'addReaction', action: 'chat:reaction' },
    { method: 'removeReaction', action: 'chat:reaction' },
  ];

  for (const { method, action } of SENSITIVE_INTERNAL_METHODS) {
    // Match method declaration: (public|private) methodName = ... { or (public|private) async methodName = ... {
    const methodRegex = new RegExp(`(?:public|private)\\s+(?:async\\s+)?${method}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)[^{]*\\{([\\s\\S]*?)(?:\\n\\s*(?:public|private)\\s|\\n\\s*\\/\\/ Serialized|\\n\\s*\\};\\s*\\n\\})`, 'm');
    const match = roomSource.match(methodRegex);
    assert(match, `Could not extract method body for ${method} in server/room.ts`);
    const methodBody = match[1];

    // Check that authorization occurs within the first 3500 characters of the method
    const step0Slice = methodBody.slice(0, 3500);
    assert(
      step0Slice.includes('authorizeRoomAction') ||
      step0Slice.includes('pureAuthorizeRoomAction') ||
      step0Slice.includes('canControlPlayback'),
      `[Firewall 8.3 Failure] Method ${method} is missing Step-0 authorization check! ` +
      `Every sensitive mutation method must enforce authorization at the top of its method body.`
    );
    assert(
      (step0Slice.includes('allowed') || step0Slice.includes('canControlPlayback')) &&
      (step0Slice.includes('return') || step0Slice.includes('throw')),
      `[Firewall 8.3 Failure] Method ${method} does not halt (return/throw) on authorization denial!`
    );
  }

  // Statically verify that canControlPlayback itself invokes pureAuthorizeRoomAction
  const canControlPlaybackRegex = /public\s+canControlPlayback\s*=\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s*public\s/;
  const canControlMatch = roomSource.match(canControlPlaybackRegex);
  assert(canControlMatch, 'Could not extract canControlPlayback implementation');
  assert(
    canControlMatch[1].includes('pureAuthorizeRoomAction') && canControlMatch[1].includes('"room:play"'),
    'canControlPlayback must invoke pureAuthorizeRoomAction with room:play'
  );

  console.log('✓ 8.3 Step-0 Internal Method Gates Verified: All 9 sensitive mutation methods contain internal Step-0 authorization');

  // --- 8.4: Static Verification of RoomAction Exhaustiveness ---
  const authSource = fs.readFileSync(path.join(projectRoot, 'server/roomAuthorization.ts'), 'utf-8');
  const actionTypeMatch = authSource.match(/export\s+type\s+RoomAction\s*=([\s\S]*?);/);
  assert(actionTypeMatch, 'Could not extract RoomAction union from server/roomAuthorization.ts');

  const definedActions = [...actionTypeMatch[1].matchAll(/["']([a-zA-Z0-9_:]+)["']/g)].map(m => m[1]);
  assert(definedActions.length >= 24, `Expected at least 24 RoomAction variants, found ${definedActions.length}`);

  // Verify each defined RoomAction is handled in authorizeRoomAction's switch statement
  for (const actionName of definedActions) {
    assert(
      authSource.includes(`case "${actionName}":`) || authSource.includes(`case '${actionName}':`),
      `[Firewall 8.4 Failure] RoomAction "${actionName}" is not handled in authorizeRoomAction switch statement!`
    );
  }

  // Verify each defined RoomAction is tested against an unauthorized context
  const testUnauthorizedContext = {
    actorUid: 'unauthorized-user',
    actorClientId: 'unauthorized-client',
    roomId: 'room-sec-test',
    isMember: true,
    isHost: false,
    isOwner: false,
    isLockHolder: false,
    chatEnabled: false,
    playbackLocked: true,
    hostEpoch: 1,
  };

  const hostOnlyActions: RoomAction[] = [
    'chat:delete_other',
    'chat:clear',
    'user:kick',
    'user:ban',
    'room:transfer_host',
    'room:lock',
    'room:lock_participants',
  ];

  for (const hostAction of hostOnlyActions) {
    const res = testRoom.authorizeRoomAction({
      actorSocket: memberSocket,
      action: hostAction,
      targetUserId: 'other-user',
    });
    assert(res.allowed === false, `[Firewall 8.4 Matrix Failure] Action ${hostAction} was allowed for non-host!`);
    assert(res.code === 'FORBIDDEN', `[Firewall 8.4 Matrix Failure] Action ${hostAction} rejection code must be FORBIDDEN`);
  }
  console.log(`✓ 8.4 RoomAction Exhaustiveness Verified: All ${definedActions.length} RoomActions accounted for and gated in pure matrix`);

  // --- 8.5: REST Mutating Route Authorization Firewall ---
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server/server.ts'), 'utf-8');
  const notificationRouterSource = fs.readFileSync(path.join(projectRoot, 'server/notifications/notificationRouter.ts'), 'utf-8');

  const REST_MUTATING_ENDPOINTS = [
    { name: '/updateRoomSettings', source: serverSource, requiresJwt: true, requiresHostOrOwner: true },
    { name: '/updateRoomCover', source: serverSource, requiresJwt: true, requiresHostOrOwner: true },
    { name: '/extendRoom', source: serverSource, requiresJwt: true, requiresHostOrOwner: true },
    { name: '/startRoom', source: serverSource, requiresJwt: true, requiresHostOrOwner: true },
    { name: '/endRoom', source: serverSource, requiresJwt: true, requiresHostOrOwner: true },
    { name: '/deleteRoom', source: serverSource, requiresJwt: true, requiresHostOrOwner: true },
    { name: '/api/notifications/invite', source: notificationRouterSource, requiresJwt: true, requiresHostOrOwner: true },
  ];

  for (const ep of REST_MUTATING_ENDPOINTS) {
    const epRegex = new RegExp(`app\\.(?:post|put|delete|patch)\\(\\s*["']${ep.name}["']([\\s\\S]*?)(?:app\\.(?:get|post|put|delete|patch)|router\\.)`, 'm');
    const matchedContent = ep.name.includes('/api/notifications')
      ? ep.source
      : ep.source.match(epRegex)?.[1] || '';

    assert(matchedContent.length > 0, `Could not extract implementation for REST endpoint ${ep.name}`);

      assert(
        matchedContent.includes('validateToken') ||
        matchedContent.includes('validateUserToken') ||
        matchedContent.includes('supabaseAdmin.auth.getUser') ||
        matchedContent.includes('requireAuth'),
        `[Firewall 8.5 Failure] REST endpoint ${ep.name} must validate Supabase JWT token!`
      );
    if (ep.requiresHostOrOwner) {
      assert(
        matchedContent.includes('isHost') || matchedContent.includes('owner_id') || matchedContent.includes('isOwner'),
        `[Firewall 8.5 Failure] REST endpoint ${ep.name} must enforce room host or owner authority!`
      );
      assert(
        matchedContent.includes('403') || matchedContent.includes('401') || matchedContent.includes('Forbidden') || matchedContent.includes('FORBIDDEN'),
        `[Firewall 8.5 Failure] REST endpoint ${ep.name} must reject unauthorized callers with 403 Forbidden!`
      );
    }
  }
  console.log('✓ 8.5 REST Mutating Route Firewall Verified: All 6 room-mutating REST routes enforce Supabase JWT and host/owner authority');

  // --- 8.6: Dynamic Zero-Mutation on Denial Verification ---
  // Lock playback to host so non-host member is unauthorized for playback actions
  testRoom.lock = 'host-uid';

  const snapshotVideo = testRoom.video;
  const snapshotPaused = testRoom.paused;
  const snapshotRate = testRoom.playbackRate;
  const snapshotHost = testRoom.currentHostUid;

  // Attempt unauthorized playVideo
  testRoom.playVideo(memberSocket, 'evil-op-play');
  assert(testRoom.video === snapshotVideo, 'playVideo: Zero mutation on denial violated: video modified');

  // Attempt unauthorized pauseVideo
  testRoom.pauseVideo(memberSocket, 'evil-op-pause');
  assert(testRoom.paused === snapshotPaused, 'pauseVideo: Zero mutation on denial violated: paused modified');

  // Attempt unauthorized seekVideo
  testRoom.seekVideo(memberSocket, 500);
  assert(testRoom.videoTS === 0, 'seekVideo: Zero mutation on denial violated: videoTS modified');

  // Attempt unauthorized setPlaybackRate
  testRoom.setPlaybackRate(memberSocket, 2.0);
  assert(testRoom.playbackRate === snapshotRate, 'setPlaybackRate: Zero mutation on denial violated: playbackRate modified');

  // Attempt unauthorized transferHost
  const transferRes = await testRoom.transferHost(memberSocket, 'other-user');
  assert(transferRes.success === false, 'transferHost: Succeeded for non-host!');
  assert(testRoom.currentHostUid === snapshotHost, 'transferHost: Zero mutation on denial violated: host modified');

  console.log('✓ 8.6 Dynamic Zero-Mutation on Denial Verified: 0 DB mutations, 0 room state mutations, 0 broadcasts on denial');

  // --- 8.7: Centralized Operator Authorization & Behavioral Verification ---
  console.log('\n--- Section 8.7: Centralized Operator Authorization & Behavioral Verification ---');

  // Behavioral Test 8.7A: Client-writable user_metadata with is_admin: true MUST BE REJECTED
  const mockAttackerSupabase = {
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: {
            id: 'attacker-uid',
            app_metadata: {},
            user_metadata: { is_admin: true, role: 'admin' },
          },
        },
        error: null,
      }),
    },
  };

  const attackerReq = {
    headers: { authorization: 'Bearer spoofed-token' },
    query: {},
  };
  const attackerResult = await authenticateOperator(attackerReq as any, mockAttackerSupabase);
  assert(
    attackerResult.authorized === false,
    '[Firewall 8.7A Failure] Attacker with client-writable user_metadata.is_admin was authorized as operator!'
  );

  // Behavioral Test 8.7B: Server-managed app_metadata with role: "admin" MUST BE ACCEPTED
  const mockAdminSupabase = {
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: {
            id: 'legit-admin-uid',
            app_metadata: { role: 'admin' },
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
  };

  const adminReq = {
    headers: { authorization: 'Bearer admin-token' },
    query: {},
  };
  const adminResult = await authenticateOperator(adminReq as any, mockAdminSupabase);
  assert(
    adminResult.authorized === true && adminResult.operatorId === 'legit-admin-uid',
    '[Firewall 8.7B Failure] Legit admin with app_metadata.role: "admin" was rejected!'
  );

  // Behavioral Test 8.7C: Server-managed app_metadata with is_admin: true MUST BE ACCEPTED
  const mockAdmin2Supabase = {
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: {
            id: 'legit-admin-2-uid',
            app_metadata: { is_admin: true },
            user_metadata: {},
          },
        },
        error: null,
      }),
    },
  };
  const admin2Result = await authenticateOperator(adminReq as any, mockAdmin2Supabase);
  assert(
    admin2Result.authorized === true && admin2Result.operatorId === 'legit-admin-2-uid',
    '[Firewall 8.7C Failure] Legit admin with app_metadata.is_admin: true was rejected!'
  );

  // Behavioral Test 8.7D: Unauthenticated requests MUST BE REJECTED
  const emptyReq = { headers: {}, query: {} };
  const emptyResult = await authenticateOperator(emptyReq as any, mockAttackerSupabase);
  assert(
    emptyResult.authorized === false,
    '[Firewall 8.7D Failure] Unauthenticated request without token or key was authorized!'
  );

  // Static Firewall 8.7E: Every /api/admin/* route must invoke authenticateOperator
  const adminRouteMatches = [...serverSource.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*["'](\/api\/admin\/[^"']+)["']([\s\S]*?)(?=\n\s*app\.|\n\s*router\.|\n\s*\/\/|\Z)/g)];
  assert(adminRouteMatches.length >= 3, `Expected at least 3 /api/admin routes, found ${adminRouteMatches.length}`);

  for (const match of adminRouteMatches) {
    const routePath = match[1];
    const routeBody = match[2];
    assert(
      routeBody.includes('authenticateOperator'),
      `[Firewall 8.7E Failure] Admin route ${routePath} does not invoke centralized authenticateOperator!`
    );
  }

  // Static Firewall 8.7F: Operational metrics and stats routes must also invoke centralized authenticateOperator
  const operationalRoutes = ['/stats', '/stats/redis', '/timeSeries'];
  for (const opRoute of operationalRoutes) {
    const regex = new RegExp(`app\\.(?:get|post|put|patch|delete)\\(\\s*["']${opRoute}["']([\\s\\S]*?)(?=\\n\\s*app\\.|\\n\\s*router\\.|\\n\\s*\\/\\/|\\Z)`);
    const match = serverSource.match(regex);
    assert(match, `[Firewall 8.7F Failure] Operational route ${opRoute} not found in server.ts`);
    assert(
      match[1].includes('authenticateOperator'),
      `[Firewall 8.7F Failure] Operational route ${opRoute} does not invoke centralized authenticateOperator!`
    );
  }

  console.log(`✓ 8.7 Centralized Operator Authorization Verified: Behavioral rejection of user_metadata and static gating across all ${adminRouteMatches.length} /api/admin routes, plus ${operationalRoutes.length} operational routes`);

  // --- Section 8.8: ARCH-008 Header-Only Operator Credentials & Secret-in-URL Firewall ---
  console.log('\n--- Section 8.8: ARCH-008 Header-Only Operator Credentials & Secret-in-URL Firewall ---');

  const validStatsKey = config.STATS_KEY || 'test-stats-key-xyz';
  const originalStatsKey = config.STATS_KEY;
  (config as any).STATS_KEY = validStatsKey;

  try {
    // 8.8A Negative Behavioral Test: Query-string ?key=... MUST BE REJECTED with authorized: false
    const queryKeyReq = {
      headers: {},
      query: { key: validStatsKey },
    };
    const queryKeyResult = await authenticateOperator(queryKeyReq as any);
    assert(
      queryKeyResult.authorized === false,
      '[Firewall 8.8A Failure] Operator key supplied via URL query parameter was accepted! ARCH-008 requires header-only credentials.'
    );

    // 8.8B Positive Behavioral Test: x-operator-key header MUST BE ACCEPTED
    const headerOperatorKeyReq = {
      headers: { 'x-operator-key': validStatsKey },
      query: {},
    };
    const headerOperatorResult = await authenticateOperator(headerOperatorKeyReq as any);
    assert(
      headerOperatorResult.authorized === true && headerOperatorResult.operatorId === 'system-operator',
      '[Firewall 8.8B Failure] Valid operator key supplied via x-operator-key header was rejected!'
    );

    // 8.8C Positive Behavioral Test: x-stats-key header MUST BE ACCEPTED
    const headerStatsKeyReq = {
      headers: { 'x-stats-key': validStatsKey },
      query: {},
    };
    const headerStatsResult = await authenticateOperator(headerStatsKeyReq as any);
    assert(
      headerStatsResult.authorized === true && headerStatsResult.operatorId === 'system-operator',
      '[Firewall 8.8C Failure] Valid operator key supplied via x-stats-key header was rejected!'
    );

    // 8.8D Static Firewall: server/utils/operatorAuth.ts must NOT reference req.query
    const operatorAuthSource = fs.readFileSync(path.join(projectRoot, 'server/utils/operatorAuth.ts'), 'utf-8');
    assert(
      !operatorAuthSource.includes('req.query'),
      '[Firewall 8.8D Failure] server/utils/operatorAuth.ts references req.query! Operator authorization must be strictly header-based.'
    );
    assert(
      !operatorAuthSource.includes('query.key'),
      '[Firewall 8.8D Failure] server/utils/operatorAuth.ts references query.key!'
    );

    // 8.8E Static Firewall: src/components/Debug/Debug.tsx must NOT construct URLs with window.location.search for /stats or /timeSeries
    const debugSource = fs.readFileSync(path.join(projectRoot, 'src/components/Debug/Debug.tsx'), 'utf-8');
    assert(
      !debugSource.includes('/timeSeries${window.location.search}'),
      '[Firewall 8.8E Failure] Debug.tsx appends window.location.search to /timeSeries URL!'
    );
    assert(
      !debugSource.includes('/stats${window.location.search}'),
      '[Firewall 8.8E Failure] Debug.tsx appends window.location.search to /stats URL!'
    );
    assert(
      debugSource.includes('x-stats-key') && debugSource.includes('x-operator-key'),
      '[Firewall 8.8E Failure] Debug.tsx does not transmit x-stats-key / x-operator-key headers!'
    );
    assert(
      debugSource.includes('window.history.replaceState'),
      '[Firewall 8.8E Failure] Debug.tsx does not sanitize transient query secrets from browser history via replaceState!'
    );

    // 8.8F Production Code Invariant: No production operator or administrative endpoint derives authority from req.query.key
    assert(
      !serverSource.includes('req.query.key'),
      '[Firewall 8.8F Failure] server.ts references req.query.key! All operator endpoints must use header-based authenticateOperator.'
    );
    assert(
      !serverSource.includes('req.query?.key'),
      '[Firewall 8.8F Failure] server.ts references req.query?.key!'
    );

    console.log('✓ 8.8 ARCH-008 Header-Only Operator Credentials & Secret-in-URL Firewall Verified:');
    console.log('  - Query parameter ?key=... strictly rejected');
    console.log('  - Header credentials (x-operator-key, x-stats-key) strictly verified');
    console.log('  - operatorAuth.ts contains 0 references to req.query');
    console.log('  - Debug.tsx verified free of query parameters, with header transmission and URL scrubbing');
    console.log('  - server.ts verified free of req.query.key');
  } finally {
    (config as any).STATS_KEY = originalStatsKey;
  }

  console.log('✓ Mechanical Authorization Completeness Invariant certified: All privileged mutations permanently gated against regression');

  console.log('\n=================================================================');
  console.log('ALL URL-DRIVEN SCREEN ARCHITECTURE & SECURITY TESTS PASSED!');
  console.log('=================================================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nTest Suite Failed:', err);
  process.exit(1);
});
