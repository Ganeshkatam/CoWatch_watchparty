import assert from "assert";
import {
  generateAdmissionToken,
  verifyAdmissionToken,
} from "./admissionToken.ts";

console.log("Starting Admission Token Cryptographic Invariant Tests...");

// Test 1: Valid generation and verification
{
  const roomId = "test-room-1";
  const userId = "user-uuid-123";
  const sessionId = "session-uuid-456";

  const token = generateAdmissionToken({ roomId, userId, sessionId });
  assert(typeof token === "string", "Token must be a string");
  assert(token.includes("."), "Token must contain payload and signature separator");

  const result = verifyAdmissionToken(token, roomId, userId, sessionId);
  assert(result.valid === true, "Valid token must pass verification");
  assert(result.payload?.roomId === roomId, "Payload roomId must match");
  assert(result.payload?.userId === userId, "Payload userId must match");
  assert(result.payload?.sessionId === sessionId, "Payload sessionId must match");
  console.log("PASS: Test 1 Passed: Valid token passes cryptographic verification");
}

// Test 2: Tampered signature rejection
{
  const token = generateAdmissionToken({
    roomId: "test-room-1",
    userId: "user-uuid-123",
    sessionId: "session-uuid-456",
  });
  const tampered = token.slice(0, -4) + "XXXX";
  const result = verifyAdmissionToken(tampered, "test-room-1", "user-uuid-123", "session-uuid-456");
  assert(result.valid === false, "Tampered signature must be rejected");
  assert(result.error === "ADMISSION_TOKEN_SIGNATURE_INVALID", "Error must indicate invalid signature");
  console.log("PASS: Test 2 Passed: Tampered signature is strictly rejected");
}

// Test 3: Expired token rejection
{
  const token = generateAdmissionToken({
    roomId: "test-room-1",
    userId: "user-uuid-123",
    sessionId: "session-uuid-456",
    ttlSeconds: -10, // already expired
  });
  const result = verifyAdmissionToken(token, "test-room-1", "user-uuid-123", "session-uuid-456");
  assert(result.valid === false, "Expired token must be rejected");
  assert(result.error === "ADMISSION_TOKEN_EXPIRED", "Error must indicate expired token");
  console.log("PASS: Test 3 Passed: Expired token is rejected");
}

// Test 4: Mismatched room ID rejection
{
  const token = generateAdmissionToken({
    roomId: "room-A",
    userId: "user-uuid-123",
    sessionId: "session-uuid-456",
  });
  const result = verifyAdmissionToken(token, "room-B", "user-uuid-123", "session-uuid-456");
  assert(result.valid === false, "Mismatched room must be rejected");
  assert(result.error === "ADMISSION_TOKEN_ROOM_MISMATCH", "Error must indicate room mismatch");
  console.log("PASS: Test 4 Passed: Cross-room token replay is rejected");
}

// Test 5: Mismatched UID rejection
{
  const token = generateAdmissionToken({
    roomId: "test-room-1",
    userId: "user-uuid-123",
    sessionId: "session-uuid-456",
  });
  const result = verifyAdmissionToken(token, "test-room-1", "attacker-uuid-999", "session-uuid-456");
  assert(result.valid === false, "Mismatched user ID must be rejected");
  assert(result.error === "ADMISSION_TOKEN_USER_MISMATCH", "Error must indicate user mismatch");
  console.log("PASS: Test 5 Passed: Cross-user token theft is rejected");
}

// Test 6: Mismatched session ID rejection
{
  const token = generateAdmissionToken({
    roomId: "test-room-1",
    userId: "user-uuid-123",
    sessionId: "original-session-1",
  });
  const result = verifyAdmissionToken(token, "test-room-1", "user-uuid-123", "different-session-2");
  assert(result.valid === false, "Mismatched session ID must be rejected");
  assert(result.error === "ADMISSION_TOKEN_SESSION_MISMATCH", "Error must indicate session mismatch");
  console.log("PASS: Test 6 Passed: Token replayed across different sessions is rejected");
}

// Test 7: Missing or malformed token rejection
{
  assert(verifyAdmissionToken(undefined, "test-room-1", "user-uuid-123", "session-uuid-456").valid === false, "Undefined token rejected");
  assert(verifyAdmissionToken("", "test-room-1", "user-uuid-123", "session-uuid-456").valid === false, "Empty token rejected");
  assert(verifyAdmissionToken("malformed-no-dot", "test-room-1", "user-uuid-123", "session-uuid-456").valid === false, "Malformed token rejected");
  console.log("PASS: Test 7 Passed: Missing and malformed tokens rejected");
}

// Test 8: Missing/unauthenticated callerUid rejection (FULL-001)
{
  const token = generateAdmissionToken({
    roomId: "test-room-1",
    userId: "user-uuid-123",
    sessionId: "session-uuid-456",
  });
  const noUidResult = verifyAdmissionToken(token, "test-room-1", undefined, "session-uuid-456");
  assert(noUidResult.valid === false, "Unauthenticated caller without UID must be rejected");
  assert(noUidResult.error === "ADMISSION_TOKEN_USER_MISMATCH", "Error must indicate user mismatch");

  const emptyUidResult = verifyAdmissionToken(token, "test-room-1", "", "session-uuid-456");
  assert(emptyUidResult.valid === false, "Empty caller UID must be rejected");
  assert(emptyUidResult.error === "ADMISSION_TOKEN_USER_MISMATCH", "Error must indicate user mismatch");
  console.log("PASS: Test 8 Passed: Missing and empty caller UIDs are strictly rejected");
}

// Test 9: Missing clientSessionId rejection (FULL-001)
{
  const token = generateAdmissionToken({
    roomId: "test-room-1",
    userId: "user-uuid-123",
    sessionId: "session-uuid-456",
  });
  const noSessionResult = verifyAdmissionToken(token, "test-room-1", "user-uuid-123", undefined);
  assert(noSessionResult.valid === false, "Caller without session ID must be rejected");
  assert(noSessionResult.error === "ADMISSION_TOKEN_SESSION_MISMATCH", "Error must indicate session mismatch");

  const emptySessionResult = verifyAdmissionToken(token, "test-room-1", "user-uuid-123", "");
  assert(emptySessionResult.valid === false, "Caller with empty session ID must be rejected");
  assert(emptySessionResult.error === "ADMISSION_TOKEN_SESSION_MISMATCH", "Error must indicate session mismatch");
  console.log("PASS: Test 9 Passed: Missing and empty session IDs are strictly rejected");
}

console.log("All Admission Token Cryptographic Invariant Tests Passed!");
