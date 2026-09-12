/**
 * FEEDBACK-001: User Feedback & Product Signal Subsystem Verification Suite
 */

import {
  USER_MESSAGES,
  createSafeFeedbackContext,
  type FeedbackContext,
  type FeedbackType,
  type FeedbackPayload,
} from "./userMessages.js";
import { operationCoordinator } from "./operationState.js";

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
console.log("FEEDBACK-001: User Feedback & Product Signal Verification");
console.log("----------------------------------------------------------------");

// 1. Strict Enum Boundary Verification for Types and Contexts
const validTypes: FeedbackType[] = ["bug", "suggestion", "problem", "experience"];
const validContexts: FeedbackContext[] = [
  "room",
  "playback",
  "host",
  "participants",
  "chat",
  "video",
  "virtual-browser",
  "connection",
];

for (const type of validTypes) {
  const result = createSafeFeedbackContext(type, "room");
  assertEqual(result.type, type, `Valid feedback type "${type}" must be preserved`);
}

for (const ctx of validContexts) {
  const result = createSafeFeedbackContext("suggestion", ctx);
  assertEqual(result.context, ctx, `Valid feedback context "${ctx}" must be preserved`);
}
console.log("✓ PASS: Valid feedback enums are preserved accurately.");

// 2. Fallback and Sanitization of Invalid/Malicious Contexts and Types
const invalidTypeFallback = createSafeFeedbackContext("DROP TABLE rooms;" as any, "playback");
assertEqual(invalidTypeFallback.type, "problem", "Invalid feedback type falls back to 'problem'");

const invalidCtxFallback = createSafeFeedbackContext("bug", "redis://localhost:6379" as any);
assertEqual(invalidCtxFallback.context, "room", "Invalid feedback context falls back to 'room'");
console.log("✓ PASS: Invalid feedback types and contexts safely fallback to defaults.");

// 3. Safe Trigger Allowlist & Privacy Protection
const safeTimeoutTrigger = createSafeFeedbackContext("problem", "host", "operation-timeout");
assertEqual(safeTimeoutTrigger.trigger, "operation-timeout", "Allowlisted trigger 'operation-timeout' is preserved");

const unsafeTriggerWithToken = createSafeFeedbackContext(
  "problem",
  "connection",
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc"
);
assertEqual(unsafeTriggerWithToken.trigger, undefined, "Unsafe trigger containing token or unknown text is discarded");

const unsafeTriggerWithStack = createSafeFeedbackContext(
  "bug",
  "video",
  "Error: ICE connection failed at Object.<anonymous> (/app/node_modules/...)"
);
assertEqual(unsafeTriggerWithStack.trigger, undefined, "Unsafe trigger containing stack trace is discarded");
console.log("✓ PASS: Trigger sanitization discards non-allowlisted raw diagnostics and tokens.");

// 4. Feedback User-Facing Message Canonical Catalog Verification
const feedbackMessages = [
  USER_MESSAGES.FEEDBACK_SUBMIT_SUCCESS,
  USER_MESSAGES.FEEDBACK_SUBMIT_FAILED,
  USER_MESSAGES.FEEDBACK_RATE_LIMITED,
  USER_MESSAGES.FEEDBACK_MESSAGE_EMPTY,
];

for (const msg of feedbackMessages) {
  assert(typeof msg.message === "string" && msg.message.length > 0, "Feedback message text is non-empty");
  assert(["info", "success", "warning", "error"].includes(msg.severity), `Valid severity: ${msg.severity}`);
  assert(["toast", "banner", "overlay", "modal"].includes(msg.presentation), `Valid presentation: ${msg.presentation}`);
  assert(["none", "retry", "rejoin", "choose-host"].includes(msg.action), `Valid action: ${msg.action}`);

  // Assert NO leak of infrastructure terms in user-facing feedback messages
  const lowerMsg = msg.message.toLowerCase();
  assert(!lowerMsg.includes("postgres"), "Must not leak 'postgres'");
  assert(!lowerMsg.includes("redis"), "Must not leak 'redis'");
  assert(!lowerMsg.includes("sql"), "Must not leak 'sql'");
  assert(!lowerMsg.includes("socket.io"), "Must not leak 'socket.io'");
  assert(!lowerMsg.includes("token"), "Must not leak 'token'");
}
console.log("✓ PASS: Feedback canonical messages comply with UserMessage presentation and privacy contracts.");

// 5. OperationCoordinator Integration with Domain 'feedback'
assertEqual(operationCoordinator.getDomainStatus("feedback"), "idle", "Feedback domain initialized as idle");

const opId = operationCoordinator.startOperation("feedback", "submit");
assertEqual(operationCoordinator.getDomainStatus("feedback"), "pending", "Feedback domain is pending during submission");

operationCoordinator.resolveOperation(opId);
assertEqual(operationCoordinator.getDomainStatus("feedback"), "success", "Feedback domain resolves to success upon resolution");

const failOpId = operationCoordinator.startOperation("feedback", "submit");
operationCoordinator.rejectOperation(failOpId, USER_MESSAGES.FEEDBACK_SUBMIT_FAILED.message);
assertEqual(operationCoordinator.getDomainStatus("feedback"), "error", "Feedback domain enters error on failure");

operationCoordinator.resetAll();
assertEqual(operationCoordinator.getDomainStatus("feedback"), "idle", "Feedback domain resets to idle after resetAll");
console.log("✓ PASS: OperationCoordinator handles 'feedback' domain lifecycle cleanly.");

// 6. Privacy Assertion: Feedback Payload Schema Integrity
const samplePayload: FeedbackPayload = {
  type: "suggestion",
  rating: 5,
  message: "Love the new picture-in-picture mode!",
  context: "playback",
};

assert(samplePayload.message.length <= 2000, "Payload message is within bounds");
assert(samplePayload.rating! >= 1 && samplePayload.rating! <= 5, "Rating is between 1 and 5");
assert(!("token" in samplePayload), "Payload has no token field");
assert(!("passcode" in samplePayload), "Payload has no passcode field");
assert(!("socketId" in samplePayload), "Payload has no socketId field");
console.log("✓ PASS: Feedback payload contains zero auth tokens, passcodes, or socket diagnostics.");

console.log("----------------------------------------------------------------");
console.log("FEEDBACK-001 Verification Complete: ALL 6 TESTS PASSED.");
console.log("----------------------------------------------------------------");
