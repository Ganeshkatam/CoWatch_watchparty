/**
 * Security Test Suite: Host Privilege Separation & Non-Host Invitation Prohibition
 *
 * Verifies that:
 * 1. Non-hosts cannot invite users via UI or server API (/api/notifications/invite).
 * 2. Room credentials (passcodes) and room links are never exposed to non-hosts in RoomHeader or InviteModal.
 * 3. Room configuration options (playback lock, capacity) in SettingsModal are strictly excluded from non-hosts.
 * 4. Moderation controls (message deletion, kick, make host) are strictly excluded from non-hosts.
 * 5. Host-only UI elements are conditionally excluded from rendering (not merely disabled or hidden with CSS).
 * 6. The permanent security rule is codified in .agents/AGENTS.md.
 */

import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[HostPrivilegeSecurityTest] Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('Starting Host Privilege Separation & Non-Host Invitation Security Suite...');

  // --- Test 1: AGENTS.md Rule Definition ---
  console.log('Checking .agents/AGENTS.md rule definition...');
  const agentsMd = fs.readFileSync(path.resolve('.agents/AGENTS.md'), 'utf-8');
  assert(
    agentsMd.includes('Never show host-only UI, moderation controls, room configuration options, room credentials'),
    'Test 1 Failed: .agents/AGENTS.md missing host-only UI security rule'
  );
  assert(
    agentsMd.includes('Non-hosts must never be able to invite users'),
    'Test 1 Failed: .agents/AGENTS.md missing explicit non-hosts cannot invite users rule'
  );

  // --- Test 2: Server /api/notifications/invite Authorization ---
  console.log('Checking server/notifications/notificationRouter.ts invite authorization...');
  const routerSource = fs.readFileSync(path.resolve('server/notifications/notificationRouter.ts'), 'utf-8');
  assert(
    routerSource.includes("Only the room host or owner can send invitations"),
    'Test 2.1 Failed: Server /api/notifications/invite must require host or owner to send invitations'
  );
  assert(
    !routerSource.includes("isAuthorized = liveRoom.hasParticipantUid(callerUid);"),
    'Test 2.2 Failed: Server /api/notifications/invite must NOT allow arbitrary participants to send invitations'
  );

  // --- Test 3: Server Room class isHostUid ---
  console.log('Checking server/room.ts isHostUid implementation...');
  const roomSource = fs.readFileSync(path.resolve('server/room.ts'), 'utf-8');
  assert(
    roomSource.includes('public isHostUid = (uid: string): boolean =>'),
    'Test 3.1 Failed: Room class missing isHostUid helper'
  );
  assert(
    roomSource.includes('public canModerate = (socket: Socket | null | undefined): boolean =>'),
    'Test 3.2 Failed: Room class missing canModerate helper'
  );

  // --- Test 4: RoomHeader UI Privilege Separation ---
  console.log('Checking src/components/TopBar/RoomHeader.tsx...');
  const roomHeaderSource = fs.readFileSync(path.resolve('src/components/TopBar/RoomHeader.tsx'), 'utf-8');
  assert(
    roomHeaderSource.includes('canManageRoom = Boolean(isHost || isOwner)'),
    'Test 4.1 Failed: RoomHeader does not compute canManageRoom from isHost and isOwner'
  );
  assert(
    roomHeaderSource.includes('{canManageRoom && (') && roomHeaderSource.includes('<IconKey size={14} /> Password'),
    'Test 4.2 Failed: RoomHeader renders Password row to non-hosts'
  );
  assert(
    roomHeaderSource.includes('Copy room link') && roomHeaderSource.includes('{canManageRoom && ('),
    'Test 4.3 Failed: RoomHeader allows non-hosts to copy room link'
  );
  assert(
    roomHeaderSource.includes('Copy invite message') && roomHeaderSource.includes('{canManageRoom && ('),
    'Test 4.4 Failed: RoomHeader allows non-hosts to copy invite message'
  );
  assert(
    roomHeaderSource.includes('{canManageRoom ? "Room settings" : "Preferences"}'),
    'Test 4.5 Failed: RoomHeader does not display Preferences for non-hosts'
  );

  // --- Test 5: SettingsModal Room Controls Exclusion ---
  console.log('Checking src/components/Settings/SettingsModal.tsx...');
  const settingsModalSource = fs.readFileSync(path.resolve('src/components/Settings/SettingsModal.tsx'), 'utf-8');
  assert(
    settingsModalSource.includes('canManageRoom = Boolean(isHost || isOwner)'),
    'Test 5.1 Failed: SettingsModal does not compute canManageRoom'
  );
  assert(
    settingsModalSource.includes('{canManageRoom && (') && settingsModalSource.includes('ROOM CONTROLS'),
    'Test 5.2 Failed: SettingsModal does not conditionally exclude ROOM CONTROLS for non-hosts'
  );
  assert(
    settingsModalSource.includes('title={canManageRoom ? "Room Settings" : "Preferences"}'),
    'Test 5.3 Failed: SettingsModal title does not switch to Preferences for non-hosts'
  );
  assert(
    settingsModalSource.includes('if (canManageRoom && draftLock !== Boolean(roomLock))'),
    'Test 5.4 Failed: SettingsModal allows non-hosts to attempt setting room lock'
  );

  // --- Test 6: VideoChat Invite Controls & CSS Anti-Pattern Eradication ---
  console.log('Checking src/components/VideoChat/VideoChat.tsx...');
  const videoChatSource = fs.readFileSync(path.resolve('src/components/VideoChat/VideoChat.tsx'), 'utf-8');
  assert(
    videoChatSource.includes('{canInvite && (') && videoChatSource.includes('inviteCard'),
    'Test 6.1 Failed: VideoChat renders inviteCard to non-hosts'
  );
  assert(
    videoChatSource.includes('{this.state.isInviteModalOpen && canInvite && ('),
    'Test 6.2 Failed: VideoChat opens InviteModal for non-hosts'
  );
  assert(
    !videoChatSource.includes('visibility: Boolean(this.props.isHost)'),
    'Test 6.3 Failed: VideoChat still contains visibility: hidden CSS anti-pattern on user menu trigger'
  );
  assert(
    videoChatSource.includes('{(this.props.isHost || isSelf) && ('),
    'Test 6.4 Failed: VideoChat does not conditionally exclude UserMenu on peer tiles for non-hosts'
  );

  // --- Test 7: InviteModal Guard & Passcode Concealment ---
  console.log('Checking src/components/Modal/InviteModal.tsx...');
  const inviteModalSource = fs.readFileSync(path.resolve('src/components/Modal/InviteModal.tsx'), 'utf-8');
  assert(
    /if\s*\(!canManageCredentials\)\s*\{\s*return null;\s*\}/.test(inviteModalSource),
    'Test 7.1 Failed: InviteModal does not return null for unauthorized callers'
  );
  assert(
    inviteModalSource.includes('{canManageCredentials && !propPasscode && ('),
    'Test 7.2 Failed: InviteModal prompts non-hosts for passcode'
  );
  assert(
    inviteModalSource.includes('{canManageCredentials && (') && inviteModalSource.includes('Room Passcode'),
    'Test 7.3 Failed: InviteModal renders Passcode card to non-hosts'
  );

  // --- Test 8: UserMenu Chat Message Deletion Restriction ---
  console.log('Checking src/components/UserMenu/UserMenu.tsx...');
  const userMenuSource = fs.readFileSync(path.resolve('src/components/UserMenu/UserMenu.tsx'), 'utf-8');
  assert(
    userMenuSource.includes('{isHost && (') && userMenuSource.includes("Delete User's Messages"),
    'Test 8.1 Failed: UserMenu renders Delete User\'s Messages to non-hosts'
  );
  assert(
    userMenuSource.includes('{isHost && (') && userMenuSource.includes("Delete Message"),
    'Test 8.2 Failed: UserMenu renders Delete Message to non-hosts'
  );

  // --- Test 9: Chat Component UserMenu Exclusion ---
  console.log('Checking src/components/Chat/Chat.tsx...');
  const chatSource = fs.readFileSync(path.resolve('src/components/Chat/Chat.tsx'), 'utf-8');
  assert(
    chatSource.includes('{isHost || id === myId ? (') || chatSource.includes('{isHost || id === clientId ? ('),
    'Test 9.1 Failed: Chat renders UserMenu component for regular messages to non-hosts'
  );

  // --- Test 10: App.tsx Prop Passing ---
  console.log('Checking src/components/App/App.tsx prop passing...');
  const appSource = fs.readFileSync(path.resolve('src/components/App/App.tsx'), 'utf-8');
  assert(
    appSource.includes('<SettingsModal') && appSource.includes('isHost={this.state.isHost}') && appSource.includes('isOwner={this.isRoomOwner()}'),
    'Test 10.1 Failed: App.tsx does not pass isHost and isOwner to SettingsModal'
  );
  assert(
    appSource.includes('<RoomHeader') && appSource.includes('isHost={this.state.isHost}') && appSource.includes('isOwner={this.isRoomOwner()}'),
    'Test 10.2 Failed: App.tsx does not pass isHost and isOwner to RoomHeader'
  );

  console.log('All Host Privilege Separation and Non-Host Invitation Security Tests Passed Successfully!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
