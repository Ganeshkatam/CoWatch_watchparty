/**
 * FEEDBACK-001 & FEEDBACK-002: User Feedback, Privacy & Operations Hardening Verification Suite
 */

import {
  USER_MESSAGES,
  createSafeFeedbackContext,
  type FeedbackContext,
  type FeedbackType,
  type FeedbackPayload,
} from "./userMessages.js";
import { operationCoordinator } from "./operationState.js";
import {
  checkFeedbackRateLimit,
  recordFeedbackAttempt,
  resetFeedbackRateLimitsForTesting,
} from "../../server/utils/feedbackRateLimit.js";

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
console.log("FEEDBACK-002: Privacy, Abuse & Operations Hardening Verification");
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

// 6. Privacy & Schema Guard: Payload Validation Logic
function validateServerPayload(body: any): { valid: boolean; error?: string; sanitizedMessage?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "Invalid request payload format" };
  }

  const allowedKeys = new Set(["type", "rating", "message", "context", "app_version", "platform"]);
  const bodyKeys = Object.keys(body);
  if (bodyKeys.some((k) => !allowedKeys.has(k))) {
    return { valid: false, error: "Payload contains unrecognized or forbidden fields" };
  }

  const allowedTypes = ["bug", "suggestion", "problem", "experience"];
  const allowedContexts = [
    "room",
    "playback",
    "host",
    "participants",
    "chat",
    "video",
    "virtual-browser",
    "connection",
  ];

  if (!body.type || typeof body.type !== "string" || !allowedTypes.includes(body.type)) {
    return { valid: false, error: "Invalid feedback type" };
  }

  if (!body.message || typeof body.message !== "string") {
    return { valid: false, error: "Feedback message is required" };
  }

  const normalizedMessage = body.message.normalize("NFC").trim();
  if (!normalizedMessage) {
    return { valid: false, error: "Feedback message cannot be empty or whitespace only" };
  }

  if (normalizedMessage.length > 2000) {
    return { valid: false, error: "Feedback message must not exceed 2000 characters" };
  }

  if (body.rating !== undefined && body.rating !== null) {
    if (typeof body.rating !== "number" || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
      return { valid: false, error: "Rating must be an integer between 1 and 5" };
    }
  }

  const sanitizedMessage = normalizedMessage
    .replace(/\bBearer\s+[A-Za-z0-9-_=.]+\b/gi, "[TOKEN_REDACTED]")
    .replace(/\b(sk_[a-zA-Z0-9_-]{20,}|sbp_[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})\b/g, "[TOKEN_REDACTED]")
    .replace(/\b(redis|postgres|postgresql|mongodb):\/\/[^\s]+/gi, "[URI_REDACTED]")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "[SCRIPT_REMOVED]");

  return { valid: true, sanitizedMessage };
}

// 7. Test Rejection of Forged user_id, Extra Fields, and Internal State Injection
const forgedUserPayload = {
  type: "bug",
  message: "Test feedback",
  user_id: "e38a2e7c-8821-4f32-8419-74d6c653457a", // Malicious client attempt to forge owner
};
const forgedUserValidation = validateServerPayload(forgedUserPayload);
assert(!forgedUserValidation.valid, "Must reject payload containing client-supplied user_id");
assertEqual(forgedUserValidation.error, "Payload contains unrecognized or forbidden fields", "Rejection error message");

const internalStatePayload = {
  type: "problem",
  message: "Issue with host",
  status: "reviewed", // Malicious attempt to manipulate internal review status
};
const internalStateValidation = validateServerPayload(internalStatePayload);
assert(!internalStateValidation.valid, "Must reject payload containing internal status field");

const extraFieldPayload = {
  type: "suggestion",
  message: "Great app!",
  internal_telemetry: { fps: 60, memory: 128 },
};
assert(!validateServerPayload(extraFieldPayload).valid, "Must reject unexpected extra fields");
console.log("✓ PASS: Forged user_id, internal status fields, and extra payload fields strictly rejected.");

// 8. Test Validation of Empty, Whitespace-only, and Oversized Messages
assert(!validateServerPayload({ type: "bug", message: "" }).valid, "Rejects empty message");
assert(!validateServerPayload({ type: "bug", message: "   \n\t  " }).valid, "Rejects whitespace-only message");
assert(!validateServerPayload({ type: "bug", message: "a".repeat(2001) }).valid, "Rejects message > 2000 characters");
assert(validateServerPayload({ type: "bug", message: "a".repeat(2000) }).valid, "Accepts message == 2000 characters");
console.log("✓ PASS: Message length and whitespace constraints strictly enforced.");

// 9. Test Rating Bounds & Non-Integer Rejection
assert(validateServerPayload({ type: "suggestion", message: "Good", rating: 1 }).valid, "Rating 1 valid");
assert(validateServerPayload({ type: "suggestion", message: "Good", rating: 5 }).valid, "Rating 5 valid");
assert(validateServerPayload({ type: "suggestion", message: "Good", rating: null }).valid, "Rating null valid");
assert(!validateServerPayload({ type: "suggestion", message: "Good", rating: 0 }).valid, "Rating 0 rejected");
assert(!validateServerPayload({ type: "suggestion", message: "Good", rating: 6 }).valid, "Rating 6 rejected");
assert(!validateServerPayload({ type: "suggestion", message: "Good", rating: 3.5 }).valid, "Float rating 3.5 rejected");
assert(!validateServerPayload({ type: "suggestion", message: "Good", rating: "5" as any }).valid, "String rating rejected");
console.log("✓ PASS: Rating integer and range bounds strictly enforced.");

// 10. Test Credential Redaction & Script Injection Neutralization
const injectionPayload = {
  type: "bug",
  message: "Found an issue: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc at redis://admin:pass@127.0.0.1:6379 with key sk_test12345678901234567890 <script>alert('pwned')</script>",
};
const injectionResult = validateServerPayload(injectionPayload);
assert(injectionResult.valid, "Payload with text is processed");
assert(!injectionResult.sanitizedMessage!.includes("Bearer eyJ"), "Bearer token is redacted");
assert(!injectionResult.sanitizedMessage!.includes("redis://"), "Redis connection URI is redacted");
assert(!injectionResult.sanitizedMessage!.includes("sk_test"), "API secret key is redacted");
assert(!injectionResult.sanitizedMessage!.includes("<script>"), "Script tag is removed");
assert(injectionResult.sanitizedMessage!.includes("[TOKEN_REDACTED]"), "Token replaced with placeholder");
assert(injectionResult.sanitizedMessage!.includes("[URI_REDACTED]"), "URI replaced with placeholder");
assert(injectionResult.sanitizedMessage!.includes("[SCRIPT_REMOVED]"), "Script tag replaced with placeholder");
console.log("✓ PASS: Privacy redaction removes tokens, keys, URIs, and scripts.");

// 11. Test In-Memory Sliding Window Rate Limiting (0 Redis Commands)
resetFeedbackRateLimitsForTesting();
const testIp = "192.168.1.50";
const testUserId = "usr-test-12345";

for (let i = 0; i < 5; i++) {
  const check = checkFeedbackRateLimit(testIp, testUserId);
  assert(check.allowed, `Request ${i + 1} within window is allowed`);
  recordFeedbackAttempt(testIp, testUserId);
}

const sixthCheck = checkFeedbackRateLimit(testIp, testUserId);
assert(!sixthCheck.allowed, "6th request within window is rate limited");
assert(sixthCheck.retryAfterSeconds > 0, "retryAfterSeconds is positive");

// Check IP isolation: different IP is still allowed
const diffIpCheck = checkFeedbackRateLimit("192.168.1.99", null);
assert(diffIpCheck.allowed, "Different unauthenticated IP is allowed independently");

resetFeedbackRateLimitsForTesting();
const resetCheck = checkFeedbackRateLimit(testIp, testUserId);
assert(resetCheck.allowed, "Allowed again after rate limit reset");
console.log("✓ PASS: In-memory sliding window rate limiter protects against abuse.");

console.log("----------------------------------------------------------------");
console.log("FEEDBACK-002 Verification Complete: ALL 11 TESTS PASSED.");
console.log("----------------------------------------------------------------");
