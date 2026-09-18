import assert from "node:assert/strict";
import type { AppBuildInfo } from "./appVersion";
import { evaluateUpdateState, shouldPromptUser } from "./updatePolicy";

const CURRENT: AppBuildInfo = {
  buildId: "20260918-1200-abcdef1",
  commit: "abcdef1234567890",
  appVersion: "1.1.0",
  protocolVersion: 1,
  deploymentTime: "2026-09-18T12:00:00.000Z",
};

console.log("Running updatePolicy test suite...");

// Test 1: Identical build returns "current"
{
  const latest: AppBuildInfo = { ...CURRENT };
  const stateInWatch = evaluateUpdateState(CURRENT, latest, true);
  const stateOutsideWatch = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(stateInWatch, "current", "Identical build in watch room must be 'current'");
  assert.equal(stateOutsideWatch, "current", "Identical build outside watch room must be 'current'");
  assert.equal(shouldPromptUser(stateOutsideWatch, null, latest.buildId), false, "Current state must never prompt user");
}

// Test 2: New build while in active watch room returns "available" (deferred)
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1300-fedcba9",
    commit: "fedcba9876543210",
  };
  const state = evaluateUpdateState(CURRENT, latest, true);
  assert.equal(state, "available", "New build in watch room must be 'available' (deferred)");
  assert.equal(shouldPromptUser(state, null, latest.buildId), false, "Deferred update in watch room must not prompt user");
}

// Test 3: New build while outside watch room returns "recommended"
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1300-fedcba9",
    commit: "fedcba9876543210",
  };
  const state = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(state, "recommended", "New build outside watch room must be 'recommended'");
  assert.equal(shouldPromptUser(state, null, latest.buildId), true, "Recommended update without prior dismissal must prompt user");
}

// Test 4: Recommended update dismissed with "Later" is not re-prompted for same buildId
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1300-fedcba9",
  };
  const state = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(shouldPromptUser(state, "20260918-1300-fedcba9", latest.buildId), false, "Dismissed buildId must not prompt user");
  assert.equal(shouldPromptUser(state, "older-build-id", latest.buildId), true, "Newer buildId must prompt user even if older build was dismissed");
}

// Test 5: Protocol version increase is strictly "required" even inside watch room
{
  const latest: AppBuildInfo = {
    ...CURRENT,
    buildId: "20260918-1400-protocol2",
    protocolVersion: 2,
  };
  const stateInWatch = evaluateUpdateState(CURRENT, latest, true);
  const stateOutsideWatch = evaluateUpdateState(CURRENT, latest, false);
  assert.equal(stateInWatch, "required", "Protocol mismatch inside watch room must be 'required'");
  assert.equal(stateOutsideWatch, "required", "Protocol mismatch outside watch room must be 'required'");
  assert.equal(shouldPromptUser("required", "20260918-1400-protocol2", latest.buildId), true, "Required update must prompt user even if dismissed");
}

console.log("All updatePolicy tests passed successfully!");
