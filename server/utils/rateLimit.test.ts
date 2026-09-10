import {
  checkRateLimit,
  recordAttempt,
  resetRateLimit,
  checkPasscodeRateLimits,
  recordPasscodeFailure,
  resetPasscodeLimits,
} from "./rateLimit.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log("Testing basic sliding-window rate limiting...");
  const testKey = "test:user:123";
  await resetRateLimit(testKey);

  let status = await checkRateLimit(testKey, 3, 2);
  assert(status.allowed === true, "Initial request must be allowed");
  assert(status.remainingAttempts === 3, "Remaining attempts should be 3");

  await recordAttempt(testKey, 2);
  status = await checkRateLimit(testKey, 3, 2);
  assert(status.allowed === true, "Request 2 must be allowed");
  assert(status.remainingAttempts === 2, "Remaining attempts should be 2");

  await recordAttempt(testKey, 2);
  await recordAttempt(testKey, 2);

  status = await checkRateLimit(testKey, 3, 2);
  assert(status.allowed === false, "4th request within window must be rejected (429)");
  assert(status.retryAfterSeconds > 0, "retryAfterSeconds must be > 0");

  await resetRateLimit(testKey);
  status = await checkRateLimit(testKey, 3, 2);
  assert(status.allowed === true, "Request after reset must be allowed");

  console.log("Testing multi-dimensional passcode rate limits...");
  const sampleTarget = {
    ip: "192.168.1.100",
    roomId: "secure-room-abc",
    userId: "usr-456",
  };
  await resetPasscodeLimits(sampleTarget);

  status = await checkPasscodeRateLimits(sampleTarget);
  assert(status.allowed === true, "Initial passcode check must be allowed");

  // Record 15 failures on same IP to trigger IP throttle
  for (let i = 0; i < 15; i++) {
    await recordPasscodeFailure(sampleTarget);
  }

  status = await checkPasscodeRateLimits(sampleTarget);
  assert(status.allowed === false, "IP must be rate-limited after 15 failed attempts");
  assert(status.retryAfterSeconds > 0, "Retry-After must be returned");

  await resetPasscodeLimits(sampleTarget);
  status = await checkPasscodeRateLimits(sampleTarget);
  assert(status.allowed === true, "Reset must restore access");

  console.log("All rateLimit tests passed successfully!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
