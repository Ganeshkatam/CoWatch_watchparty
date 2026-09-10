import assert from "node:assert";
import bcrypt from "bcryptjs";
import { checkPasscodeRateLimits, recordPasscodeFailure, resetPasscodeLimits } from "./rateLimit.js";

console.log("Testing gateway and passcode validation invariants...");

// 1. Invariant: Query parameter extraction must strictly ignore credentials
const testUrls = [
  "https://cowatch.tv/join/my-test-room?passcode=secret1234",
  "https://cowatch.tv/join/my-test-room?pass=secret1234",
  "https://cowatch.tv/join/my-test-room?password=secret1234",
  "/join/my-test-room?passcode=secret1234&autoplay=true",
  "https://cowatch.tv/watch/my-test-room?passcode=secret1234",
];

const normalizeRoomId = (value: string): string => {
  let clean = value.trim();
  if (clean.includes("/watch/")) {
    clean = clean.split("/watch/")[1]?.split("?")[0] || clean;
  } else if (clean.includes("/join/")) {
    clean = clean.split("/join/")[1]?.split("?")[0] || clean;
  }
  return clean.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\/+|\/+$/g, "").split("?")[0];
};

for (const url of testUrls) {
  const extracted = normalizeRoomId(url);
  assert.strictEqual(extracted, "my-test-room", `Expected 'my-test-room' but got '${extracted}' for ${url}`);
  assert.strictEqual(extracted.includes("passcode"), false, "URL normalization must not leak passcode parameter");
  assert.strictEqual(extracted.includes("secret"), false, "URL normalization must not leak secret value");
}
console.log("Invariant passed: URL normalization strictly discards query credentials.");

// 2. Invariant: Bcrypt hash comparison works as expected for verification
async function testBcryptVerification() {
  const plain = "ValidPassword123";
  const wrong = "WrongPassword123";
  const hashed = await bcrypt.hash(plain, 10);

  const matchCorrect = await bcrypt.compare(plain, hashed);
  assert.strictEqual(matchCorrect, true, "Bcrypt compare should match correct passcode");

  const matchWrong = await bcrypt.compare(wrong, hashed);
  assert.strictEqual(matchWrong, false, "Bcrypt compare must reject incorrect passcode");
}

// 3. Invariant: Multi-dimensional rate limit enforces block after repeated failures
async function testRateLimitEnforcement() {
  const target = {
    ip: "10.0.0.99",
    roomId: "room-limit-check",
    userId: "user-limit-check",
  };

  await resetPasscodeLimits(target);

  // First check: should be allowed
  let status = await checkPasscodeRateLimits(target);
  assert.strictEqual(status.allowed, true);

  // Record 15 failures for IP limit
  for (let i = 0; i < 15; i++) {
    await recordPasscodeFailure(target);
  }

  // 16th check: should be blocked
  status = await checkPasscodeRateLimits(target);
  assert.strictEqual(status.allowed, false, "16th attempt on IP must be rate-limited");
  assert.ok(status.retryAfterSeconds > 0, "retryAfterSeconds must be greater than 0");

  // Reset and verify recovery
  await resetPasscodeLimits(target);
  status = await checkPasscodeRateLimits(target);
  assert.strictEqual(status.allowed, true, "Reset must restore allowed state");
}

async function runAll() {
  await testBcryptVerification();
  console.log("Invariant passed: Passcode cryptographic verification behaves correctly.");

  await testRateLimitEnforcement();
  console.log("Invariant passed: Rate limiting enforces threshold and recovery.");

  console.log("All gateway invariant tests passed successfully!");
  process.exit(0);
}

runAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
