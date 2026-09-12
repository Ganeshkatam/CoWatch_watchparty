/**
 * USERMSG-002: Message Consistency & Presentation Boundary
 *
 * Invariants:
 * 1. Single Translation Boundary: All server errors, transport codes, and internal states
 *    are mapped to structured UserMessage objects containing clear, empathetic, plain-English copy.
 * 2. Technical Leak Prevention: Raw error.message, error codes (e.g. ROOM_FULL, SESSION_INVALID,
 *    HOST_TRANSITION_CONFLICT), SQL, transport identifiers (Socket.IO, WebRTC, ICE), infrastructure
 *    terms (Redis, Postgres, database, operationId), and UUIDs are strictly forbidden from reaching the UI.
 * 3. Diagnostic Separation: Technical errors, stack traces, and raw codes remain strictly for internal
 *    telemetry/logging and are never exposed directly to the user.
 * 4. Structured Presentation Metadata: Returns rich UserMessage objects with explicit severity,
 *    presentation mode, action binding, and duration.
 */

import { platform } from "os";
import type { RoomInitStage } from "./operationState";

export type MessageSeverity = "info" | "success" | "warning" | "error";
export type MessagePresentation = "toast" | "banner" | "overlay" | "modal";
export type MessageAction = "none" | "retry" | "rejoin" | "choose-host";

export interface UserMessage {
  message: string;
  severity: MessageSeverity;
  presentation: MessagePresentation;
  action: MessageAction;
  duration?: number;
}

export const USER_MESSAGES: Record<string, UserMessage> = {
  // Connection & Recovery (Non-error indicators during transition)
  RECONNECTING: {
    message: "Reconnecting to the room...",
    severity: "info",
    presentation: "overlay",
    action: "none",
  },
  SYNCHRONIZING: {
    message: "Getting the latest room information...",
    severity: "info",
    presentation: "overlay",
    action: "none",
  },
  CONNECTION_DEGRADED: {
    message: "Your connection is unstable. We're still trying to reconnect.",
    severity: "warning",
    presentation: "overlay",
    action: "none",
  },
  CONNECTION_FAILED: {
    message: "We couldn't connect to the room.",
    severity: "error",
    presentation: "overlay",
    action: "retry",
  },
  SERVER_DISCONNECTED: {
    message: "You've been disconnected from the room. We'll try to reconnect.",
    severity: "warning",
    presentation: "overlay",
    action: "none",
  },
  GENERIC_CONNECTION_ERROR: {
    message: "We couldn't connect to the room. Please try again.",
    severity: "error",
    presentation: "overlay",
    action: "retry",
  },

  // Access & Admission
  PARTICIPANTS_LOCKED: {
    message: "This room is currently closed to new participants.",
    severity: "error",
    presentation: "overlay",
    action: "none",
  },
  ROOM_FULL: {
    message: "This room is full. Please try again later.",
    severity: "error",
    presentation: "overlay",
    action: "retry",
  },
  ROOM_NOT_FOUND: {
    message: "We couldn't find this room. It may have ended or expired.",
    severity: "error",
    presentation: "overlay",
    action: "none",
  },
  INVALID_ROOM_LINK: {
    message: "That room link doesn't look right.",
    severity: "error",
    presentation: "overlay",
    action: "none",
  },
  SESSION_EXPIRED: {
    message: "Your session has expired. Please join the room again.",
    severity: "warning",
    presentation: "toast",
    action: "rejoin",
    duration: 4000,
  },
  PASSCODE_INCORRECT: {
    message: "The room code or password is incorrect.",
    severity: "error",
    presentation: "modal",
    action: "retry",
  },
  ACCESS_DENIED: {
    message: "You don't have permission to join this room.",
    severity: "error",
    presentation: "overlay",
    action: "none",
  },

  // Host Authority & Controls
  LOCK_SIGN_IN_REQUIRED: {
    message: "Please sign in to change the room lock.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  LOCK_HOST_ONLY: {
    message: "Only the current host can change the room lock.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  LOCK_OWNER_OR_HOST_ONLY: {
    message: "Only the room owner or host can control who can join.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  SETTINGS_ROOM_ACTIVE: {
    message: "Room settings can't be changed while the room is active.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  SETTINGS_SOCKET_FORBIDDEN: {
    message: "These room settings can't be changed here.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  HOST_TARGET_REQUIRED: {
    message: "Please choose someone to become the new host.",
    severity: "warning",
    presentation: "toast",
    action: "choose-host",
    duration: 3000,
  },
  HOST_TRANSFER_FAILED: {
    message: "We couldn't change the host. Please choose another participant and try again.",
    severity: "error",
    presentation: "toast",
    action: "choose-host",
    duration: 4000,
  },
  HOST_SELF_CLAIM_FORBIDDEN: {
    message: "You can't make yourself the host.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },

  // Host Notifications
  HOST_OWNER_RETURNED_SELF: {
    message: "Welcome back! You're the host again.",
    severity: "success",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },
  HOST_OWNER_RETURNED_PUBLIC: {
    message: "The room creator is back and is hosting again.",
    severity: "info",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },
  HOST_TRANSFER_SELF: {
    message: "You're now the host.",
    severity: "success",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },
  HOST_FAILOVER_SELF: {
    message: "The previous host disconnected. You're now the host.",
    severity: "success",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },

  // Moderation & Media
  MOD_KICK_HOST_ONLY: {
    message: "Only the current host can remove participants.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  MOD_DELETE_CHAT_HOST_ONLY: {
    message: "Only the current host can delete chat messages.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  MEDIA_VBROWSER_RUNNING: {
    message: "Stop the virtual browser before changing the video.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  MEDIA_ALREADY_SHARING: {
    message: "Someone is already sharing in this room.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  MEDIA_NOT_ACTIVE_SHARER: {
    message: "You're no longer the person sharing.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  VBROWSER_INVALID_INPUT: {
    message: "We couldn't start the virtual browser with those settings.",
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 3000,
  },
  VBROWSER_EMAIL_REQUIRED: {
    message: "Please verify your email before starting the virtual browser.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },
  VBROWSER_ALREADY_ACTIVE: {
    message: "You already have a virtual browser running.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  VBROWSER_UNAVAILABLE: {
    message: "The virtual browser is temporarily unavailable. Please try again later.",
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 4000,
  },

  // DB Failures & Timeouts (never imply server rejection)
  GENERIC_ACTION_FAILED: {
    message: "We couldn't complete this action. Please try again.",
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 3000,
  },
  PARTICIPANT_SETTINGS_UPDATE_FAILED: {
    message: "We couldn't update the participant settings. Please try again.",
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 3000,
  },
  OPERATION_TIMEOUT: {
    message: "This is taking longer than expected. Your change may still be processing.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },
  OPERATION_TIMEOUT_RETRY: {
    message: "This is taking longer than expected. Your change may still be processing. Please try again in a moment.",
    severity: "warning",
    presentation: "toast",
    action: "retry",
    duration: 4000,
  },
  // Feedback & Product Signals
  FEEDBACK_SUBMIT_SUCCESS: {
    message: "Thanks for your feedback.",
    severity: "success",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
  FEEDBACK_SUBMIT_FAILED: {
    message: "We couldn't send your feedback. Please try again.",
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 4000,
  },
  FEEDBACK_SERVICE_UNAVAILABLE: {
    message: "Feedback is temporarily unavailable. Please try again in a few moments.",
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 4000,
  },
  FEEDBACK_VALIDATION_FAILED: {
    message: "Please check your feedback and try again.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3500,
  },
  FEEDBACK_RATE_LIMITED: {
    message: "You've submitted several feedback reports recently. Please wait a moment before sending more.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 4000,
  },
  FEEDBACK_MESSAGE_EMPTY: {
    message: "Please enter a message before sending.",
    severity: "warning",
    presentation: "toast",
    action: "none",
    duration: 3000,
  },
};

export type FeedbackType = "bug" | "suggestion" | "problem" | "experience";
export type FeedbackContext =
  | "room"
  | "playback"
  | "host"
  | "participants"
  | "chat"
  | "video"
  | "virtual-browser"
  | "connection";

export interface FeedbackPayload {
  type: FeedbackType;
  rating?: number | null;
  message: string;
  context?: FeedbackContext;
  app_version?: string;
  platform?: string;
  idempotency_key?: string;
}

/**
 * Creates safe, semantic feedback context for contextual feedback prompts.
 * NEVER leaks internal tokens, passcodes, raw errors, or private IDs.
 */
export function createSafeFeedbackContext(
  typeOrParams?: FeedbackType | { type?: FeedbackType; context?: FeedbackContext; trigger?: string },
  contextArg?: FeedbackContext,
  triggerArg?: string
): { type: FeedbackType; context: FeedbackContext; trigger?: string; safeTrigger?: string } {
  const allowedTypes: FeedbackType[] = ["bug", "suggestion", "problem", "experience"];
  const allowedContexts: FeedbackContext[] = [
    "room",
    "playback",
    "host",
    "participants",
    "chat",
    "video",
    "virtual-browser",
    "connection",
  ];

  let rawType: FeedbackType | undefined;
  let rawContext: FeedbackContext | undefined;
  let rawTrigger: string | undefined;

  if (typeof typeOrParams === "object" && typeOrParams !== null) {
    rawType = typeOrParams.type;
    rawContext = typeOrParams.context;
    rawTrigger = typeOrParams.trigger;
  } else {
    rawType = typeOrParams;
    rawContext = contextArg;
    rawTrigger = triggerArg;
  }

  const type = rawType && allowedTypes.includes(rawType) ? rawType : "problem";
  const context =
    rawContext && allowedContexts.includes(rawContext) ? rawContext : "room";

  // Allowed safe trigger list (strict semantic tokens)
  const allowedTriggers = [
    "operation-timeout",
    "connection-failed",
    "playback-error",
    "vbrowser-error",
    "general",
  ];

  // Discard any trigger containing tokens, jwt, sql, stack traces, or non-allowlisted identifiers
  let safeTrigger: string | undefined;
  if (rawTrigger && allowedTriggers.includes(rawTrigger)) {
    safeTrigger = rawTrigger;
  }

  return { type, context, trigger: safeTrigger, safeTrigger };
}

/**
 * Returns structured UserMessage object for room initialization / recovery stages.
 */
export function getLifecycleUserMessage(stage: RoomInitStage): UserMessage | null {
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
      return null;
  }
}

/**
 * Maps room initialization / lifecycle stage to user-facing recovery copy string.
 */
export function getLifecycleStageMessage(stage: RoomInitStage): string {
  const meta = getLifecycleUserMessage(stage);
  return meta ? meta.message : "";
}

/**
 * Returns structured UserMessage object for admission and connect_error strings.
 */
export function getAdmissionUserMessage(codeOrMessage: string): UserMessage {
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
 * Maps admission and connect_error strings / codes to sanitized plain-English copy string.
 */
export function getAdmissionErrorMessage(codeOrMessage: string): string {
  return getAdmissionUserMessage(codeOrMessage).message;
}

/**
 * Sanitizes server error messages and returns a structured UserMessage object.
 */
export function sanitizeServerUserMessage(raw: string | undefined | null): UserMessage {
  if (!raw || typeof raw !== "string") {
    return USER_MESSAGES.GENERIC_ACTION_FAILED;
  }

  const trimmed = raw.trim();

  // Security barrier: Filter out any internal infrastructure, transport, or database leaks
  const technicalTermsPattern =
    /\b(postgres|postgresql|redis|zincrby|socket\.io|webrtc|peerconnection|candidate|ice|operationid|uncaught|syntaxerror|typeerror|nullpointer|internalerror|exception|cluster\s+node)\b/i;
  const sqlPattern =
    /\b(select\s+.*from|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;
  const uuidPattern =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

  if (technicalTermsPattern.test(trimmed) || sqlPattern.test(trimmed) || uuidPattern.test(trimmed)) {
    return USER_MESSAGES.GENERIC_ACTION_FAILED;
  }

  // Admission & Capacity codes
  if (trimmed.includes("PARTICIPANTS_LOCKED")) {
    return USER_MESSAGES.PARTICIPANTS_LOCKED;
  }
  if (trimmed.includes("ROOM_FULL") || trimmed.includes("max capacity reached")) {
    return USER_MESSAGES.ROOM_FULL;
  }
  if (trimmed.includes("SESSION_INVALID")) {
    return USER_MESSAGES.SESSION_EXPIRED;
  }
  if (trimmed.includes("ECONNREFUSED") || trimmed.includes("connect_error")) {
    return USER_MESSAGES.GENERIC_CONNECTION_ERROR;
  }

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

  // Host Handoff / Transitions
  if (trimmed.includes("Target participant ID is required")) {
    return USER_MESSAGES.HOST_TARGET_REQUIRED;
  }
  if (
    trimmed.includes("Failed to transfer host authority") ||
    trimmed.includes("Failed to assign host") ||
    trimmed.includes("HOST_TRANSITION_CONFLICT")
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

  // Timeout (never imply server rejection)
  if (trimmed.includes("timed out") || trimmed.includes("Timeout")) {
    return USER_MESSAGES.OPERATION_TIMEOUT_RETRY;
  }

  // If already clean, conversational copy without technical keywords, return custom object
  return {
    message: trimmed,
    severity: "error",
    presentation: "toast",
    action: "retry",
    duration: 3000,
  };
}

/**
 * Sanitizes server error messages emitted via socket `errorMessage` event to string copy.
 */
export function sanitizeServerErrorMessage(raw: string | undefined | null): string {
  return sanitizeServerUserMessage(raw).message;
}

/**
 * Returns structured UserMessage for public host transfer broadcast.
 */
export function getHostTransferredUserMessage(hostName?: string): UserMessage {
  return {
    message: `Host controls were passed to ${hostName || "a new host"}.`,
    severity: "info",
    presentation: "toast",
    action: "none",
    duration: 4000,
  };
}

/**
 * Returns host transfer notification text string for public broadcasts.
 */
export function getHostTransferredPublicMessage(hostName?: string): string {
  return getHostTransferredUserMessage(hostName).message;
}
