/**
 * Strictly Pure Room Authorization Engine
 *
 * INVARIANTS:
 * 1. Zero I/O, zero database access, zero network calls, zero socket inspection, zero mutable state.
 * 2. Pure function: Authorization = f(context, action, target)
 * 3. Never relies on client-provided capabilities or client-controlled identifiers.
 * 4. Normalizes all authorization-sensitive denials to uniform code: "FORBIDDEN".
 */

export type RoomAction =
  | "chat:send"
  | "chat:edit"
  | "chat:delete_own"
  | "chat:delete_other"
  | "chat:clear"
  | "chat:reaction"
  | "user:kick"
  | "user:ban"
  | "room:transfer_host"
  | "room:lock"
  | "room:lock_participants"
  | "room:play"
  | "room:pause"
  | "room:seek"
  | "room:change_rate"
  | "room:set_media"
  | "playlist:add"
  | "playlist:move"
  | "playlist:delete"
  | "playlist:next"
  | "vbrowser:start"
  | "vbrowser:stop"
  | "vbrowser:control"
  | "room:subtitle_change";

export interface AuthorizationContext {
  actorUid: string;
  actorClientId: string;
  roomId: string;
  isMember: boolean;
  isHost: boolean;
  isOwner: boolean;
  isLockHolder: boolean;
  chatEnabled: boolean;
  playbackLocked: boolean;
  hostEpoch: number;
}

export interface ActionTarget {
  targetMessage?: {
    id: string;
    roomId: string;
    authorUid: string | null;
  };
  targetUserId?: string;
  targetIsOwner?: boolean;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?:
    | "UNAUTHENTICATED"
    | "NOT_MEMBER"
    | "NOT_HOST"
    | "NOT_AUTHOR"
    | "ROOM_MISMATCH"
    | "PLAYBACK_LOCKED"
    | "TARGET_IS_OWNER"
    | "CHAT_DISABLED"
    | "FORBIDDEN";
  code: "FORBIDDEN" | "OK" | "ROOM_MISMATCH";
}

/**
 * Strictly pure authorization evaluation function.
 */
export function authorizeRoomAction(
  context: AuthorizationContext,
  action: RoomAction,
  target?: ActionTarget
): AuthorizationResult {
  // 1. Target Room Scope Validation (Cross-room probing defense)
  if (target?.targetMessage?.roomId && target.targetMessage.roomId !== context.roomId) {
    return { allowed: false, reason: "ROOM_MISMATCH", code: "ROOM_MISMATCH" };
  }

  // 2. Mandatory Membership Invariant: Room ownership strictly implies admitted room membership
  const isAdmitted = context.isMember || context.isOwner;
  if (!isAdmitted) {
    return { allowed: false, reason: "NOT_MEMBER", code: "FORBIDDEN" };
  }

  const isHostOrOwner = context.isHost || context.isOwner;

  // 3. Action-Specific Pure Evaluation
  switch (action) {
    case "chat:send":
    case "chat:reaction":
      if (!context.chatEnabled && !isHostOrOwner) {
        return { allowed: false, reason: "CHAT_DISABLED", code: "FORBIDDEN" };
      }
      return { allowed: true, code: "OK" };

    case "chat:edit":
      // Host or Room Owner has complete chat moderation authority (including editing)
      if (isHostOrOwner) {
        return { allowed: true, code: "OK" };
      }
      // Author self-editing strictly by verified UID
      if (!context.actorUid || !target?.targetMessage?.authorUid || context.actorUid !== target.targetMessage.authorUid) {
        return { allowed: false, reason: "NOT_AUTHOR", code: "FORBIDDEN" };
      }
      return { allowed: true, code: "OK" };

    case "chat:delete_own":
      // Author self-moderation strictly by verified UID
      if (!context.actorUid || !target?.targetMessage?.authorUid || context.actorUid !== target.targetMessage.authorUid) {
        return { allowed: false, reason: "NOT_AUTHOR", code: "FORBIDDEN" };
      }
      return { allowed: true, code: "OK" };

    case "chat:delete_other":
    case "chat:clear":
      // Host or Room Owner moderation authority
      if (isHostOrOwner) {
        return { allowed: true, code: "OK" };
      }
      return { allowed: false, reason: "NOT_HOST", code: "FORBIDDEN" };

    case "user:kick":
    case "user:ban":
      if (!isHostOrOwner) {
        return { allowed: false, reason: "NOT_HOST", code: "FORBIDDEN" };
      }
      // Target Protection Invariant: Room Owner can never be kicked or banned
      if (target?.targetIsOwner) {
        return { allowed: false, reason: "TARGET_IS_OWNER", code: "FORBIDDEN" };
      }
      return { allowed: true, code: "OK" };

    case "room:transfer_host":
      // Current Host ONLY (Room Owner cannot transfer host unless holding the current host role)
      if (context.isHost) {
        return { allowed: true, code: "OK" };
      }
      return { allowed: false, reason: "NOT_HOST", code: "FORBIDDEN" };

    case "room:lock":
    case "room:lock_participants":
      if (isHostOrOwner) {
        return { allowed: true, code: "OK" };
      }
      return { allowed: false, reason: "NOT_HOST", code: "FORBIDDEN" };

    // Granular Playback & Media Operations
    case "room:play":
    case "room:pause":
    case "room:seek":
    case "room:change_rate":
    case "room:set_media":
    case "playlist:add":
    case "playlist:move":
    case "playlist:delete":
    case "playlist:next":
    case "vbrowser:start":
    case "vbrowser:stop":
    case "vbrowser:control":
    case "room:subtitle_change":
      if (!context.playbackLocked) {
        return { allowed: true, code: "OK" };
      }
      if (isHostOrOwner || context.isLockHolder) {
        return { allowed: true, code: "OK" };
      }
      return { allowed: false, reason: "PLAYBACK_LOCKED", code: "FORBIDDEN" };

    default:
      return { allowed: false, reason: "FORBIDDEN", code: "FORBIDDEN" };
  }
}
