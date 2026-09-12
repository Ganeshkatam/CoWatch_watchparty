import {
  USER_MESSAGES,
  getLifecycleStageMessage,
  getAdmissionErrorMessage,
  sanitizeServerErrorMessage,
  getHostTransferredPublicMessage,
} from "./userMessages.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message}\nExpected: "${expected}"\nActual:   "${actual}"`);
    process.exit(1);
  }
}

console.log("----------------------------------------------------------------");
console.log("USERMSG-001: User-Facing Message Sanitization Boundary Verification");
console.log("----------------------------------------------------------------");

// 1. Lifecycle Stage Mapping
assertEqual(getLifecycleStageMessage("connecting"), "Reconnecting to the room...", "connecting message");
assertEqual(getLifecycleStageMessage("synchronizing"), "Getting the latest room information...", "synchronizing message");
assertEqual(
  getLifecycleStageMessage("degraded"),
  "Your connection is unstable. We're still trying to reconnect.",
  "degraded message"
);
assertEqual(getLifecycleStageMessage("failed"), "We couldn't connect to the room.", "failed message");
assertEqual(getLifecycleStageMessage("ready"), "", "ready message");
assertEqual(getLifecycleStageMessage("booting"), "", "booting message");
assertEqual(getLifecycleStageMessage("authenticating"), "", "authenticating message");
console.log("✓ PASS: Lifecycle stages mapped correctly to non-error recovery copy.");

// 2. Admission & Connection Error Codes
assertEqual(
  getAdmissionErrorMessage("PARTICIPANTS_LOCKED"),
  "This room is currently closed to new participants.",
  "PARTICIPANTS_LOCKED"
);
assertEqual(
  getAdmissionErrorMessage("ROOM_FULL"),
  "This room is full. Please try again later.",
  "ROOM_FULL"
);
assertEqual(
  getAdmissionErrorMessage("ROOM_NOT_FOUND"),
  "We couldn't find this room. It may have ended or expired.",
  "ROOM_NOT_FOUND"
);
assertEqual(
  getAdmissionErrorMessage("Invalid namespace"),
  "We couldn't find this room. It may have ended or expired.",
  "Invalid namespace"
);
assertEqual(
  getAdmissionErrorMessage("INVALID_FORMAT"),
  "That room link doesn't look right.",
  "INVALID_FORMAT"
);
assertEqual(
  getAdmissionErrorMessage("SESSION_INVALID"),
  "Your session has expired. Please join the room again.",
  "SESSION_INVALID"
);
assertEqual(
  getAdmissionErrorMessage("passcode"),
  "The room code or password is incorrect.",
  "passcode"
);
assertEqual(
  getAdmissionErrorMessage("PASSCODE_INVALID"),
  "The room code or password is incorrect.",
  "PASSCODE_INVALID"
);
assertEqual(
  getAdmissionErrorMessage("ROOM_ACCESS_DENIED"),
  "You don't have permission to join this room.",
  "ROOM_ACCESS_DENIED"
);
assertEqual(
  getAdmissionErrorMessage("io server disconnect"),
  "You've been disconnected from the room. We'll try to reconnect.",
  "io server disconnect"
);
assertEqual(
  getAdmissionErrorMessage("unknown network glitch"),
  "We couldn't connect to the room. Please try again.",
  "generic fallback"
);
console.log("✓ PASS: Admission & connection error codes sanitized without leaking internal terms.");

// 3. Server Error Messages & Moderation/Media copy
assertEqual(
  sanitizeServerErrorMessage("You must be signed in to change the room lock"),
  "Please sign in to change the room lock.",
  "lock sign-in"
);
assertEqual(
  sanitizeServerErrorMessage("Only the room host can change the lock"),
  "Only the current host can change the room lock.",
  "lock host only"
);
assertEqual(
  sanitizeServerErrorMessage("Only the room owner or host can lock participants."),
  "Only the room owner or host can control who can join.",
  "lock participants"
);
assertEqual(
  sanitizeServerErrorMessage("Room settings cannot be changed while the room is active"),
  "Room settings can't be changed while the room is active.",
  "settings active"
);
assertEqual(
  sanitizeServerErrorMessage("Room settings cannot be changed via socket."),
  "These room settings can't be changed here.",
  "settings socket"
);
assertEqual(
  sanitizeServerErrorMessage("Target participant ID is required."),
  "Please choose someone to become the new host.",
  "host target required"
);
assertEqual(
  sanitizeServerErrorMessage("Failed to transfer host authority."),
  "We couldn't change the host. Please try again.",
  "host transfer failed"
);
assertEqual(
  sanitizeServerErrorMessage("Direct host claims are not permitted."),
  "You can't make yourself the host.",
  "direct host claim"
);
assertEqual(
  sanitizeServerErrorMessage("Only the room host can kick participants"),
  "Only the current host can remove participants.",
  "kick mod"
);
assertEqual(
  sanitizeServerErrorMessage("Only the room host can delete chat messages"),
  "Only the current host can delete chat messages.",
  "chat mod"
);
assertEqual(
  sanitizeServerErrorMessage("Can't update the video while vbrowser is running"),
  "Stop the virtual browser before changing the video.",
  "vbrowser running"
);
assertEqual(
  sanitizeServerErrorMessage("There is already an active share in this room"),
  "Someone is already sharing in this room.",
  "active share"
);
assertEqual(
  sanitizeServerErrorMessage("Not the active sharer"),
  "You're no longer the person sharing.",
  "not active sharer"
);
assertEqual(
  sanitizeServerErrorMessage("Invalid vBrowser input"),
  "We couldn't start the virtual browser with those settings.",
  "vbrowser input"
);
assertEqual(
  sanitizeServerErrorMessage("A verified email is required to start a VBrowser."),
  "Please verify your email before starting the virtual browser.",
  "vbrowser email"
);
assertEqual(
  sanitizeServerErrorMessage("There is already an active vBrowser for this user."),
  "You already have a virtual browser running.",
  "vbrowser active"
);
assertEqual(
  sanitizeServerErrorMessage("VBrowser is currently unavailable. Please try again later."),
  "The virtual browser is temporarily unavailable. Please try again later.",
  "vbrowser unavailable"
);
assertEqual(
  sanitizeServerErrorMessage("Failed to update participant lock."),
  "We couldn't update the participant settings. Please try again.",
  "participant lock db fail"
);
assertEqual(
  sanitizeServerErrorMessage("Operation timed out waiting for server response"),
  "This is taking longer than expected. Please try again in a moment.",
  "timeout retry"
);
console.log("✓ PASS: Server authority and media error messages cleanly sanitized.");

// 4. Leak Prevention for DB, SQL, Redis, and Transport
assertEqual(
  sanitizeServerErrorMessage("SELECT * FROM rooms WHERE id = 123 failed in postgres"),
  "We couldn't complete this action. Please try again.",
  "postgres leak prevented"
);
assertEqual(
  sanitizeServerErrorMessage("Redis connection error on zincrby"),
  "We couldn't complete this action. Please try again.",
  "redis leak prevented"
);
assertEqual(
  sanitizeServerErrorMessage("WebRTC RTCPeerConnection ICE candidate state failure"),
  "We couldn't complete this action. Please try again.",
  "webrtc leak prevented"
);
assertEqual(
  sanitizeServerErrorMessage("Socket.IO transport close"),
  "We couldn't complete this action. Please try again.",
  "socket.io leak prevented"
);
assertEqual(
  sanitizeServerErrorMessage("TypeError: Cannot read property 'id' of undefined at operationId:123"),
  "We couldn't complete this action. Please try again.",
  "stack error leak prevented"
);
console.log("✓ PASS: Infrastructure, SQL, transport, and stack trace leaks strictly prevented.");

// 5. Host Notifications & Public Copy
assertEqual(
  getHostTransferredPublicMessage("Alice"),
  "Host controls were passed to Alice.",
  "host transfer public named"
);
assertEqual(
  getHostTransferredPublicMessage(),
  "Host controls were passed to a new host.",
  "host transfer public unnamed"
);
console.log("✓ PASS: Host transfer notifications cleanly formatted.");

console.log("----------------------------------------------------------------");
console.log("ALL USERMSG-001 TESTS PASSED WITH ZERO FAILURES.");
console.log("----------------------------------------------------------------");
