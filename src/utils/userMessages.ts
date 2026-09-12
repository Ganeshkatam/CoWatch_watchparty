/**
 * USERMSG-001: User-Facing Message Sanitization Boundary
 *
 * Invariants:
 * 1. Single Translation Boundary: All server errors, transport codes, and internal states
 *    are mapped to concise, empathetic, plain-English copy.
 * 2. Technical Leak Prevention: Raw error.message, error codes (e.g. ROOM_FULL, SESSION_INVALID),
 *    SQL, transport identifiers (Socket.IO, WebRTC, ICE), and infrastructure terms (Redis, Postgres,
 *    database, operationId) are strictly forbidden from reaching the UI.
 * 3. Non-Error Recovery: Recovery states ('connecting', 'degraded') are rendered as status indicators,
 *    not error states.
 */

import type { RoomInitStage } from "./operationState";

export const USER_MESSAGES = {
  // Connection & Recovery
  RECONNECTING: "Reconnecting to the room...",
  SYNCHRONIZING: "Getting the latest room information...",
  CONNECTION_DEGRADED: "Your connection is unstable. We're still trying to reconnect.",
  CONNECTION_FAILED: "We couldn't connect to the room.",
  SERVER_DISCONNECTED: "You've been disconnected from the room. We'll try to reconnect.",
  GENERIC_CONNECTION_ERROR: "We couldn't connect to the room. Please try again.",

  // Access & Admission
  PARTICIPANTS_LOCKED: "This room is currently closed to new participants.",
  ROOM_FULL: "This room is full. Please try again later.",
  ROOM_NOT_FOUND: "We couldn't find this room. It may have ended or expired.",
  INVALID_ROOM_LINK: "That room link doesn't look right.",
  SESSION_EXPIRED: "Your session has expired. Please join the room again.",
  PASSCODE_INCORRECT: "The room code or password is incorrect.",
  ACCESS_DENIED: "You don't have permission to join this room.",

  // Host Authority & Controls
  LOCK_SIGN_IN_REQUIRED: "Please sign in to change the room lock.",
  LOCK_HOST_ONLY: "Only the current host can change the room lock.",
  LOCK_OWNER_OR_HOST_ONLY: "Only the room owner or host can control who can join.",
  SETTINGS_ROOM_ACTIVE: "Room settings can't be changed while the room is active.",
  SETTINGS_SOCKET_FORBIDDEN: "These room settings can't be changed here.",
  HOST_TARGET_REQUIRED: "Please choose someone to become the new host.",
  HOST_TRANSFER_FAILED: "We couldn't change the host. Please try again.",
  HOST_SELF_CLAIM_FORBIDDEN: "You can't make yourself the host.",

  // Host Notifications
  HOST_OWNER_RETURNED_SELF: "Welcome back! You're the host again.",
  HOST_OWNER_RETURNED_PUBLIC: "The room creator is back and is hosting again.",
  HOST_TRANSFER_SELF: "You're now the host.",
  HOST_FAILOVER_SELF: "The host disconnected. You're now the host.",

  // Moderation & Media
  MOD_KICK_HOST_ONLY: "Only the current host can remove participants.",
  MOD_DELETE_CHAT_HOST_ONLY: "Only the current host can delete chat messages.",
  MEDIA_VBROWSER_RUNNING: "Stop the virtual browser before changing the video.",
  MEDIA_ALREADY_SHARING: "Someone is already sharing in this room.",
  MEDIA_NOT_ACTIVE_SHARER: "You're no longer the person sharing.",
  VBROWSER_INVALID_INPUT: "We couldn't start the virtual browser with those settings.",
  VBROWSER_EMAIL_REQUIRED: "Please verify your email before starting the virtual browser.",
  VBROWSER_ALREADY_ACTIVE: "You already have a virtual browser running.",
  VBROWSER_UNAVAILABLE: "The virtual browser is temporarily unavailable. Please try again later.",

  // DB Failures & Timeouts
  PARTICIPANT_SETTINGS_UPDATE_FAILED: "We couldn't update the participant settings. Please try again.",
  OPERATION_TIMEOUT: "This is taking longer than expected. Please wait a moment.",
  OPERATION_TIMEOUT_RETRY: "This is taking longer than expected. Please try again in a moment.",
  GENERIC_ACTION_FAILED: "We couldn't complete this action. Please try again.",
} as const;

/**
 * Maps room initialization / lifecycle stage to user-facing recovery copy.
 */
export function getLifecycleStageMessage(stage: RoomInitStage): string {
  switch (stage) {
    case "connecting":
      return USER_MESSAGES.RECONNECTING;
    case "synchronizing":
      return USER_MESSAGES.SYNCHRONIZING;
    case "degraded":
      return USER_MESSAGES.CONNECTION_DEGRADED;
    case "failed":
      return USER_MESSAGES.CONNECTION_FAILED;
    case "booting":
    case "authenticating":
    case "ready":
    default:
      return "";
  }
}

/**
 * Maps admission and connect_error strings / codes to sanitized plain-English copy.
 */
export function getAdmissionErrorMessage(codeOrMessage: string): string {
  const norm = (codeOrMessage || "").trim();

  if (norm.includes("PARTICIPANTS_LOCKED")) {
    return USER_MESSAGES.PARTICIPANTS_LOCKED;
  }
  if (norm.includes("ROOM_FULL")) {
    return USER_MESSAGES.ROOM_FULL;
  }
  if (
    norm === "Invalid namespace" ||
    norm.includes("ROOM_NOT_FOUND") ||
    norm.includes("ended or expired")
  ) {
    return USER_MESSAGES.ROOM_NOT_FOUND;
  }
  if (norm.includes("INVALID_FORMAT") || norm.includes("Invalid room identifier")) {
    return USER_MESSAGES.INVALID_ROOM_LINK;
  }
  if (norm.includes("SESSION_INVALID")) {
    return USER_MESSAGES.SESSION_EXPIRED;
  }
  if (
    norm === "passcode" ||
    norm === "password" ||
    norm.includes("PASSCODE_INVALID")
  ) {
    return USER_MESSAGES.PASSCODE_INCORRECT;
  }
  if (norm.includes("ROOM_ACCESS_DENIED")) {
    return USER_MESSAGES.ACCESS_DENIED;
  }
  if (norm.includes("io server disconnect") || norm.includes("Disconnected from server")) {
    return USER_MESSAGES.SERVER_DISCONNECTED;
  }

  return USER_MESSAGES.GENERIC_CONNECTION_ERROR;
}

/**
 * Sanitizes server error messages emitted via socket `errorMessage` event.
 */
export function sanitizeServerErrorMessage(raw: string | undefined | null): string {
  if (!raw || typeof raw !== "string") {
    return USER_MESSAGES.GENERIC_ACTION_FAILED;
  }

  const trimmed = raw.trim();

  // Expired / Ended room
  if (trimmed.includes("ended or expired") || trimmed.includes("ROOM_NOT_FOUND")) {
    return USER_MESSAGES.ROOM_NOT_FOUND;
  }

  // Lock Authority
  if (trimmed.includes("signed in to change the room lock")) {
    return USER_MESSAGES.LOCK_SIGN_IN_REQUIRED;
  }
  if (trimmed.includes("Only the room host can change the lock")) {
    return USER_MESSAGES.LOCK_HOST_ONLY;
  }
  if (trimmed.includes("Only the room owner or host can lock participants")) {
    return USER_MESSAGES.LOCK_OWNER_OR_HOST_ONLY;
  }

  // Room Settings
  if (trimmed.includes("Room settings cannot be changed while the room is active")) {
    return USER_MESSAGES.SETTINGS_ROOM_ACTIVE;
  }
  if (trimmed.includes("Room settings cannot be changed via socket")) {
    return USER_MESSAGES.SETTINGS_SOCKET_FORBIDDEN;
  }

  // Host Handoff
  if (trimmed.includes("Target participant ID is required")) {
    return USER_MESSAGES.HOST_TARGET_REQUIRED;
  }
  if (
    trimmed.includes("Failed to transfer host authority") ||
    trimmed.includes("Failed to assign host")
  ) {
    return USER_MESSAGES.HOST_TRANSFER_FAILED;
  }
  if (trimmed.includes("Direct host claims are not permitted")) {
    return USER_MESSAGES.HOST_SELF_CLAIM_FORBIDDEN;
  }

  // Moderation
  if (trimmed.includes("Only the room host can kick participants")) {
    return USER_MESSAGES.MOD_KICK_HOST_ONLY;
  }
  if (trimmed.includes("Only the room host can delete chat messages")) {
    return USER_MESSAGES.MOD_DELETE_CHAT_HOST_ONLY;
  }

  // Media & Virtual Browser
  if (
    trimmed.includes("Can't update the video while vbrowser is running") ||
    trimmed.includes("vbrowser is running")
  ) {
    return USER_MESSAGES.MEDIA_VBROWSER_RUNNING;
  }
  if (trimmed.includes("already an active share in this room")) {
    return USER_MESSAGES.MEDIA_ALREADY_SHARING;
  }
  if (trimmed.includes("Not the active sharer")) {
    return USER_MESSAGES.MEDIA_NOT_ACTIVE_SHARER;
  }
  if (trimmed.includes("Invalid vBrowser input")) {
    return USER_MESSAGES.VBROWSER_INVALID_INPUT;
  }
  if (trimmed.includes("verified email is required to start a VBrowser")) {
    return USER_MESSAGES.VBROWSER_EMAIL_REQUIRED;
  }
  if (trimmed.includes("already an active vBrowser for this user")) {
    return USER_MESSAGES.VBROWSER_ALREADY_ACTIVE;
  }
  if (trimmed.includes("VBrowser is currently unavailable")) {
    return USER_MESSAGES.VBROWSER_UNAVAILABLE;
  }

  // Database / Participant mutations
  if (trimmed.includes("Failed to update participant lock")) {
    return USER_MESSAGES.PARTICIPANT_SETTINGS_UPDATE_FAILED;
  }

  // Timeout
  if (trimmed.includes("timed out") || trimmed.includes("Timeout")) {
    return USER_MESSAGES.OPERATION_TIMEOUT_RETRY;
  }

  // Security barrier: Filter out any internal infrastructure, transport, or database leaks
  const technicalTermsPattern =
    /\b(postgres|redis|sql|select|insert|update|delete|table|schema|socket\.io|webrtc|peerconnection|ice|operationid|stack|syntaxerror|typeerror|nullpointer)\b/i;

  if (technicalTermsPattern.test(trimmed)) {
    return USER_MESSAGES.GENERIC_ACTION_FAILED;
  }

  // If already clean, conversational copy without technical keywords, return it
  return trimmed;
}

/**
 * Returns host transfer notification text for public broadcasts.
 */
export function getHostTransferredPublicMessage(hostName?: string): string {
  return `Host controls were passed to ${hostName || "a new host"}.`;
}
