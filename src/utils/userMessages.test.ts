/**
 * USERMSG-002: Message Consistency & Presentation Boundary Verification Suite
 */

import {
  USER_MESSAGES,
  getLifecycleUserMessage,
  getLifecycleStageMessage,
  getAdmissionUserMessage,
  getAdmissionErrorMessage,
  sanitizeServerUserMessage,
  sanitizeServerErrorMessage,
  getHostTransferredUserMessage,
  getHostTransferredPublicMessage,
  type UserMessage,
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
console.log("USERMSG-002: Message Consistency & Presentation Boundary Verification");
console.log("----------------------------------------------------------------");

// 1. Structured UserMessage Schema Integrity across Canonical Dictionary
for (const [key, item] of Object.entries(USER_MESSAGES)) {
  assert(typeof item.message === "string" && item.message.length > 0, `Key ${key} has valid message`);
  assert(
    ["info", "success", "warning", "error"].includes(item.severity),
    `Key ${key} has valid severity: ${item.severity}`
  );
  assert(
    ["toast", "banner", "overlay", "modal"].includes(item.presentation),
    `Key ${key} has valid presentation: ${item.presentation}`
  );
  assert(
    ["none", "retry", "rejoin", "choose-host"].includes(item.action),
    `Key ${key} has valid action: ${item.action}`
  );
}
console.log("✓ PASS: Canonical dictionary adheres to UserMessage metadata contract.");

// 2. Lifecycle Stage Metadata & Non-Error Status Semantics
const connectingMsg = getLifecycleUserMessage("connecting");
assert(connectingMsg !== null, "connecting message exists");
assertEqual(connectingMsg?.severity, "info", "connecting severity is info (non-error)");
assertEqual(connectingMsg?.presentation, "overlay", "connecting presentation is overlay");
assertEqual(connectingMsg?.action, "none", "connecting action is none");

const degradedMsg = getLifecycleUserMessage("degraded");
assert(degradedMsg !== null, "degraded message exists");
assertEqual(degradedMsg?.severity, "warning", "degraded severity is warning");
assertEqual(degradedMsg?.presentation, "overlay", "degraded presentation is overlay");

const failedMsg = getLifecycleUserMessage("failed");
assert(failedMsg !== null, "failed message exists");
assertEqual(failedMsg?.severity, "error", "failed severity is error");
assertEqual(failedMsg?.action, "retry", "failed action is retry");

assertEqual(getLifecycleUserMessage("ready"), null, "ready produces null overlay message");
console.log("✓ PASS: Lifecycle state metadata verified with appropriate severity and actions.");

// 3. Admission & Access Control Metadata
const lockedMsg = getAdmissionUserMessage("PARTICIPANTS_LOCKED");
assertEqual(lockedMsg.severity, "error", "PARTICIPANTS_LOCKED severity");
assertEqual(lockedMsg.presentation, "overlay", "PARTICIPANTS_LOCKED presentation");
assertEqual(lockedMsg.action, "none", "PARTICIPANTS_LOCKED action");
assertEqual(lockedMsg.message, "This room is currently closed to new participants.", "locked copy");

const fullMsg = getAdmissionUserMessage("ROOM_FULL");
assertEqual(fullMsg.severity, "error", "ROOM_FULL severity");
assertEqual(fullMsg.action, "retry", "ROOM_FULL action");
assertEqual(fullMsg.message, "This room is full. Please try again later.", "full copy");

const sessionMsg = getAdmissionUserMessage("SESSION_INVALID");
assertEqual(sessionMsg.severity, "warning", "SESSION_INVALID severity");
assertEqual(sessionMsg.presentation, "toast", "SESSION_INVALID presentation");
assertEqual(sessionMsg.action, "rejoin", "SESSION_INVALID action");

const passcodeMsg = getAdmissionUserMessage("PASSCODE_INVALID");
assertEqual(passcodeMsg.severity, "error", "PASSCODE_INVALID severity");
assertEqual(passcodeMsg.presentation, "modal", "PASSCODE_INVALID presentation");
assertEqual(passcodeMsg.action, "retry", "PASSCODE_INVALID action");

console.log("✓ PASS: Admission errors mapped to structured objects with accurate action bindings.");

// 4. Host Transitions & Authority Errors
const hostHandoffFail = sanitizeServerUserMessage("Failed to transfer host authority.");
assertEqual(hostHandoffFail.severity, "error", "Host handoff fail severity");
assertEqual(hostHandoffFail.action, "choose-host", "Host handoff fail action is choose-host");
assertEqual(
  hostHandoffFail.message,
  "We couldn't change the host. Please choose another participant and try again.",
  "Host handoff copy with clear next step"
);

const hostTargetReq = sanitizeServerUserMessage("Target participant ID is required.");
assertEqual(hostTargetReq.action, "choose-host", "Host target required action");

const ownerReturnSelf = USER_MESSAGES.HOST_OWNER_RETURNED_SELF;
assertEqual(ownerReturnSelf.severity, "success", "Owner return self severity");
assertEqual(ownerReturnSelf.presentation, "banner", "Owner return self presentation");

const transferPublic = getHostTransferredUserMessage("Bob");
assertEqual(transferPublic.severity, "info", "Public transfer severity");
assertEqual(transferPublic.presentation, "banner", "Public transfer presentation");
assertEqual(transferPublic.message, "Host controls were passed to Bob.", "Public transfer copy");

console.log("✓ PASS: Host authority mutations and notifications validated with structured metadata.");

// 5. Operation Timeouts: In-Flight Treatment (Never imply server rejection)
const timeoutMsg = sanitizeServerUserMessage("Operation timed out waiting for server response");
assertEqual(timeoutMsg.severity, "warning", "Timeout severity is warning (not hard error)");
assertEqual(timeoutMsg.action, "retry", "Timeout action is retry");
assert(
  timeoutMsg.message.includes("longer than expected") && timeoutMsg.message.includes("still be processing"),
  "Timeout message treats operation as in-flight and avoids implying server rejection"
);
console.log("✓ PASS: Timeout copy accurately conveys in-flight / processing state.");

// 6. Zero Leakage of Infrastructure Tokens, IDs, SQL, UUIDs, or Internal Error Codes
const leakedSamples = [
  "PostgreSQL query error: SELECT * FROM rooms WHERE id = 'b2b3a32f-46e3-4d7a-a63e-324c0d12e879'",
  "Redis ZINCRBY failed on cluster node 127.0.0.1:6379",
  "Uncaught Error: HOST_TRANSITION_CONFLICT in operationId:op-99238-ab12",
  "RTCPeerConnection ICE failed on candidate 192.168.1.1:5004",
  "Socket.IO websocket transport closed unexpectedly",
  "Internal server exception at RoomManager.executeMutation (room.ts:142)",
  "TypeError: Cannot read properties of null (reading 'uuid')",
];

for (const sample of leakedSamples) {
  const sanitized = sanitizeServerUserMessage(sample);
  assertEqual(
    sanitized.message,
    "We couldn't complete this action. Please try again.",
    `Leaked sample sanitized: "${sample}"`
  );
  assertEqual(sanitized.severity, "error", "Fallback error severity");
  assertEqual(sanitized.action, "retry", "Fallback action is retry");
}
console.log("✓ PASS: Technical keywords, SQL, UUIDs, stack traces, and internal codes strictly stripped.");

console.log("----------------------------------------------------------------");
console.log("ALL USERMSG-002 TESTS PASSED WITH ZERO FAILURES.");
console.log("----------------------------------------------------------------");
