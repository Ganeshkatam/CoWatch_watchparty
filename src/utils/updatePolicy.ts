import type { AppBuildInfo, UpdateState } from "./appVersion";

/**
 * Evaluates the update state between the currently running client
 * and the latest manifest served by the deployment server (/version.json).
 *
 * Invariants:
 * 1. Protocol compatibility is paramount: if latest.protocolVersion > current.protocolVersion,
 *    the update is strictly "required".
 * 2. Active watch rooms must never be disrupted: if an update exists while the user is inside
 *    an active watch room, the state is "available" (deferred) rather than "recommended".
 * 3. Outside watch rooms, new builds are classified as "recommended".
 * 4. Identical build IDs return "current".
 */
export function evaluateUpdateState(
  current: AppBuildInfo,
  latest: AppBuildInfo,
  isWatchRoomActive: boolean
): UpdateState {
  if (latest.protocolVersion > current.protocolVersion) {
    return "required";
  }

  if (latest.buildId !== current.buildId) {
    if (isWatchRoomActive) {
      return "available";
    }
    return "recommended";
  }

  return "current";
}

/**
 * Determines whether a user-facing update prompt should be presented.
 *
 * @param state - The evaluated UpdateState.
 * @param dismissedBuildId - The buildId the user explicitly chose to defer ("Later") during this session.
 * @param latestBuildId - The buildId of the newly available deployment.
 */
export function shouldPromptUser(
  state: UpdateState,
  dismissedBuildId?: string | null,
  latestBuildId?: string
): boolean {
  if (state === "current") {
    return false;
  }

  // Required updates represent breaking protocol changes and cannot be dismissed
  if (state === "required") {
    return true;
  }

  // Available updates inside active watch rooms are deferred to prevent playback disruption
  if (state === "available") {
    return false;
  }

  // Recommended updates are shown unless the user previously dismissed this exact buildId
  if (state === "recommended") {
    if (!latestBuildId) {
      return false;
    }
    return dismissedBuildId !== latestBuildId;
  }

  return false;
}
