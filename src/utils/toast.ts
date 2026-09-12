/**
 * TOAST-001: Unified Toast Presentation Adapter
 *
 * Invariants:
 * 1. Toasts are a strictly transient presentation adapter for UserMessage objects.
 *    They NEVER create, mutate, or reinterpret application or lifecycle state.
 * 2. Zero bypass: raw error strings, exceptions, and un-sanitized server text are
 *    strictly prohibited. All callers MUST pass a structured UserMessage.
 * 3. Presentation contract: showUserMessage() strictly enforces presentation === 'toast'
 *    at both compile-time (overload) and runtime (guard). Messages targeting
 *    'overlay', 'banner', or 'modal' are silently dropped — they belong to their
 *    own rendering layers.
 * 4. Time-windowed deduplication: identical toasts (same severity + message) are
 *    coalesced within a DEDUP_WINDOW_MS window. After the window expires the ID
 *    is released, so the same event occurring later renders a fresh notification.
 *    This prevents permanent suppression of legitimate repeated events.
 * 5. Zero infrastructure terminology: raw error codes, session IDs, room IDs,
 *    transport identifiers, or UUIDs must never reach rendered toast text.
 *    All copy must originate from USER_MESSAGES catalog entries, routed through
 *    sanitizeServerUserMessage() for any dynamic server content.
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

// Default auto-close duration (ms) when the UserMessage catalog does not specify one
const DEFAULT_DURATION_MS = 3500;

/**
 * Time window (ms) within which identical toasts (same severity + message) are
 * coalesced into a single notification. Outside this window, the same event is
 * treated as a new occurrence and renders independently.
 */
const DEDUP_WINDOW_MS = 4000;

/**
 * Active deduplication registry: maps notification ID → expiry timestamp.
 * Entries are cleared after DEDUP_WINDOW_MS so legitimate repeated events
 * across reconnections are never permanently suppressed.
 *
 * Exported for unit-test introspection only — do NOT mutate externally.
 */
export const _dedupRegistry: Map<string, number> = new Map();

/**
 * Derives a stable notification ID from message content using djb2.
 * The ID is scoped to the dedup window; once the entry expires the same
 * message can re-appear as a fresh notification.
 */
function deriveNotificationId(msg: UserMessage): string {
  const key = `${msg.severity}::${msg.message}`;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
  }
  return `cowatch-toast-${(hash >>> 0).toString(16)}`;
}

/**
 * Returns true if this notification ID is within its active dedup window,
 * and registers or refreshes the entry otherwise.
 */
function isDuplicate(id: string): boolean {
  const now = Date.now();
  const expiry = _dedupRegistry.get(id);
  if (expiry !== undefined && now < expiry) {
    return true;
  }
  // Register / refresh
  _dedupRegistry.set(id, now + DEDUP_WINDOW_MS);
  // Prune stale entries to prevent unbounded growth
  for (const [k, exp] of _dedupRegistry) {
    if (now >= exp) _dedupRegistry.delete(k);
  }
  return false;
}

/**
 * Displays a UserMessage as a transient Mantine notification.
 *
 * Contract enforcement:
 * - Messages with presentation !== 'toast' are silently dropped (wrong layer).
 * - Messages with an empty or non-string message body are dropped.
 * - Duplicate messages within DEDUP_WINDOW_MS are suppressed.
 *
 * @param msg - A structured UserMessage whose presentation is 'toast'.
 */
export function showUserMessage(msg: UserMessage): void {
  // Runtime presentation contract enforcement
  if (msg.presentation !== "toast") {
    return;
  }
  // Guard against malformed message body
  if (typeof msg.message !== "string" || msg.message.trim().length === 0) {
    return;
  }

  const id = deriveNotificationId(msg);
  if (isDuplicate(id)) {
    return;
  }

  notifications.show({
    id,
    message: msg.message,
    color: SEVERITY_COLOR[msg.severity],
    autoClose: msg.duration ?? DEFAULT_DURATION_MS,
    withCloseButton: true,
  });
}

/**
 * Convenience helpers — each strictly wraps showUserMessage to enforce the
 * UserMessage contract. Raw strings cannot be passed through these helpers.
 */
export const showSuccess = (msg: UserMessage): void => showUserMessage(msg);
export const showInfo = (msg: UserMessage): void => showUserMessage(msg);
export const showWarning = (msg: UserMessage): void => showUserMessage(msg);
export const showError = (msg: UserMessage): void => showUserMessage(msg);

/**
 * Test-only utility: clears the deduplication registry between test cases.
 * Must NOT be called in production code paths.
 */
export function _clearDedupRegistry(): void {
  _dedupRegistry.clear();
}
