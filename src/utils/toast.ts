/**
 * TOAST-001: Unified Toast Presentation Adapter
 *
 * Invariants:
 * 1. Toasts are a strictly transient presentation adapter for UserMessage objects.
 *    They NEVER create, mutate, or reinterpret application or lifecycle state.
 * 2. Zero bypass: raw error strings, exceptions, and un-sanitized server text are
 *    strictly prohibited. All callers MUST pass a structured UserMessage.
 * 3. Presentation routing: only messages where presentation === 'toast' are
 *    appropriate here. Blocking/lifecycle states (overlay, banner, modal) belong
 *    in their respective presentation layers.
 * 4. Deduplication: a deterministic ID derived from the canonical message content
 *    prevents duplicate toasts for the same condition within a short window.
 * 5. Zero infrastructure terminology: raw error codes, session IDs, room IDs,
 *    transport identifiers, or UUIDs must never reach rendered toast text.
 *    All copy comes from pre-approved USER_MESSAGES catalog entries.
 */

import { notifications } from "@mantine/notifications";
import type { UserMessage, MessageSeverity } from "./userMessages";

// Severity → Mantine color mapping
const SEVERITY_COLOR: Record<MessageSeverity, string> = {
  success: "green",
  info: "blue",
  warning: "yellow",
  error: "red",
};

// Default duration (ms) when the UserMessage does not specify one
const DEFAULT_DURATION_MS = 3500;

/**
 * Derives a stable, deterministic notification ID from the message content so
 * that repeated identical events do not stack duplicate toasts.
 * Uses a simple djb2 hash — no crypto dependency needed.
 */
function deriveNotificationId(msg: UserMessage): string {
  const key = `${msg.severity}::${msg.message}`;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
  }
  // Unsigned 32-bit hex, prefixed to make collisions with Mantine internal IDs impossible
  return `cowatch-toast-${(hash >>> 0).toString(16)}`;
}

/**
 * Displays a UserMessage as a transient Mantine notification.
 *
 * ONLY call this for messages whose `presentation` field is `'toast'`.
 * Overlays, banners, and modals are handled by their dedicated layers.
 *
 * @param msg - A structured UserMessage from the USER_MESSAGES catalog.
 */
export function showUserMessage(msg: UserMessage): void {
  notifications.show({
    id: deriveNotificationId(msg),
    message: msg.message,
    color: SEVERITY_COLOR[msg.severity],
    autoClose: msg.duration ?? DEFAULT_DURATION_MS,
    withCloseButton: true,
  });
}

/**
 * Convenience helpers — each strictly wraps showUserMessage to prevent callers
 * from bypassing the UserMessage contract with raw strings.
 */
export const showSuccess = (msg: UserMessage) => showUserMessage(msg);
export const showInfo = (msg: UserMessage) => showUserMessage(msg);
export const showWarning = (msg: UserMessage) => showUserMessage(msg);
export const showError = (msg: UserMessage) => showUserMessage(msg);
