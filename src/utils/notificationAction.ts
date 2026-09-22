/**
 * NOTIFY-003B Canonical Notification Action Resolver
 *
 * This module is the single client authority for resolving the actionable
 * behavior, label, and navigation URL for any notification.
 *
 * It guarantees that:
 *   1. No notification action is inferred from roomId alone.
 *   2. Expired rooms and moderation events (kick/ban) never render "Join Room".
 *   3. metadata.action is authoritative, with robust fallback for legacy items.
 */

export interface NotificationActionSource {
  id?: string;
  user_id?: string;
  type: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  read_at?: string | null;
  expires_at?: string | null;
  event_id?: string;
}

export type NotificationActionType = 'open_room' | 'join_room' | 'join_invitation' | 'go_home' | 'dismiss';

export interface ResolvedNotificationAction {
  action: NotificationActionType;
  label: string;
  url?: string;
}

export function resolveNotificationAction(notification: NotificationActionSource): ResolvedNotificationAction {
  const metadata = notification.metadata || {};
  const explicitAction = typeof metadata.action === 'string' ? (metadata.action as NotificationActionType) : undefined;
  const rawRoomId = typeof metadata.roomId === 'string' ? metadata.roomId.trim() : undefined;
  const cleanRoomId = rawRoomId ? encodeURIComponent(rawRoomId) : undefined;
  const explicitTargetUrl = typeof metadata.targetUrl === 'string' ? metadata.targetUrl.trim() : undefined;
  const invitationId = typeof metadata.invitationId === 'string' ? metadata.invitationId.trim() : undefined;

  // 1. Authoritative explicit action in metadata
  if (explicitAction) {
    switch (explicitAction) {
      case 'go_home':
        return {
          action: 'go_home',
          label: 'Go Home',
          url: explicitTargetUrl || '/home',
        };
      case 'join_room':
        return {
          action: 'join_room',
          label: 'Join Room',
          url: explicitTargetUrl || (cleanRoomId ? `/join/${cleanRoomId}` : '/home'),
        };
      case 'join_invitation':
        return {
          action: 'join_invitation',
          label: 'Join Watch Party',
          url: explicitTargetUrl || (invitationId ? `/invite?invitationId=${encodeURIComponent(invitationId)}` : (cleanRoomId ? `/join/${cleanRoomId}` : '/home')),
        };
      case 'open_room':
        return {
          action: 'open_room',
          label: 'Open Room',
          url: explicitTargetUrl || (cleanRoomId ? `/watch/${cleanRoomId}` : '/home'),
        };
      case 'dismiss':
        return {
          action: 'dismiss',
          label: 'Dismiss',
          url: explicitTargetUrl,
        };
    }
  }

  // 2. Safe fallback for legacy/unversioned notifications
  switch (notification.type) {
    case 'ROOM_ENDED':
    case 'MODERATION_ACTION':
      return {
        action: 'go_home',
        label: 'Go Home',
        url: '/home',
      };

    // Legacy notification fallback (strictly for pre-INVITE-001 notifications):
    //   legacy notification -> /join/:roomId -> manual credential admission
    // New unified invitations use explicit metadata.action = 'join_invitation':
    //   new invitation -> /invite?invitationId=... -> invitation preview -> explicit acceptance
    case 'ROOM_INVITATION':
      return {
        action: 'join_room',
        label: 'Join Room',
        url: cleanRoomId ? `/join/${cleanRoomId}` : '/home',
      };

    case 'ROOM_STARTED':
    case 'ROOM_HOST_TRANSFER':
    case 'ROOM_ENDING':

      return {
        action: 'open_room',
        label: 'Open Room',
        url: cleanRoomId ? `/watch/${cleanRoomId}` : '/home',
      };

    case 'SYSTEM_ANNOUNCEMENT':
    default: {
      const ctaUrl = typeof metadata.ctaUrl === 'string' ? metadata.ctaUrl.trim() : undefined;
      const ctaLabel = typeof metadata.ctaLabel === 'string' ? metadata.ctaLabel.trim() : 'Dismiss';
      if (ctaUrl) {
        return {
          action: 'open_room',
          label: ctaLabel,
          url: ctaUrl,
        };
      }
      return {
        action: 'dismiss',
        label: 'Dismiss',
      };
    }
  }
}

export function formatInvitationMessage(params: {
  roomId: string;
  roomTitle?: string;
  passcode?: string;
  invitationUrl: string;
  inviterName?: string;
}): string {
  const cleanId = params.roomId.replace(/^\//, "").trim();
  const title = params.roomTitle?.trim() || cleanId;
  const inviter = params.inviterName?.trim() || "A friend";
  const pass = params.passcode?.trim();

  const lines = [
    "You're invited to a CoWatch watch party!",
    "",
    `"${title}"`,
    `${inviter} invited you to join.`,
    "",
    `Join: ${params.invitationUrl}`,
    `Room ID: ${cleanId}`,
  ];

  if (pass) {
    lines.push(`Passcode: ${pass}`);
  }

  lines.push("", "See you there!");
  return lines.join("\n");
}

export interface ParsedJoinRoute {
  type: "invite" | "invite_query" | "join";
  path: string;
  identifier: string;
}

export function parseJoinRoute(value: string): ParsedJoinRoute {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return { type: "join", path: "", identifier: "" };
  }

  // 1. Check for invitation query: ?invitationId=... or /invite?invitationId=...
  if (trimmed.includes("invitationId=")) {
    try {
      const parsedUrl = new URL(trimmed.startsWith("http") ? trimmed : `http://localhost/${trimmed.replace(/^\/+/, "")}`);
      const invId = parsedUrl.searchParams.get("invitationId")?.trim();
      if (invId) {
        return {
          type: "invite_query",
          path: `/invite?invitationId=${encodeURIComponent(invId)}`,
          identifier: invId,
        };
      }
    } catch {
      const match = trimmed.match(/[?&]invitationId=([^&#\s]+)/i);
      if (match) {
        const invId = decodeURIComponent(match[1]).trim();
        return {
          type: "invite_query",
          path: `/invite?invitationId=${encodeURIComponent(invId)}`,
          identifier: invId,
        };
      }
    }
  }

  // 2. Check for /invite/:token path
  if (trimmed.includes("/invite/")) {
    const rawToken = trimmed.split("/invite/")[1]?.split(/[?&#\s]/)[0] || "";
    const cleanToken = rawToken.replace(/^\/+|\/+$/g, "").trim();
    if (cleanToken) {
      return {
        type: "invite",
        path: `/invite/${encodeURIComponent(cleanToken)}`,
        identifier: cleanToken,
      };
    }
  }

  // 3. Check for /join/:roomId path
  if (trimmed.includes("/join/")) {
    const rawRoom = trimmed.split("/join/")[1]?.split(/[?&#\s]/)[0] || "";
    const cleanRoom = rawRoom.replace(/^\/+|\/+$/g, "").trim();
    if (cleanRoom) {
      return {
        type: "join",
        path: `/join/${encodeURIComponent(cleanRoom)}`,
        identifier: cleanRoom,
      };
    }
  }

  // 4. Check for /watch/:roomId path
  if (trimmed.includes("/watch/")) {
    const rawRoom = trimmed.split("/watch/")[1]?.split(/[?&#\s]/)[0] || "";
    const cleanRoom = rawRoom.replace(/^\/+|\/+$/g, "").trim();
    if (cleanRoom) {
      return {
        type: "join",
        path: `/join/${encodeURIComponent(cleanRoom)}`,
        identifier: cleanRoom,
      };
    }
  }

  // 5. Default: treat as plain roomId (strip protocol/host if user pasted a generic link)
  const plainRoom = trimmed
    .replace(/^https?:\/\/[^/]+\/?/, "")
    .replace(/^\/+|\/+$/g, "")
    .split(/[?&#\s]/)[0]
    .trim();

  return {
    type: "join",
    path: plainRoom ? `/join/${encodeURIComponent(plainRoom)}` : "",
    identifier: plainRoom,
  };
}

/**
 * Normalizes room identifiers strictly for /join and /watch paths.
 * Invitation paths (/invite/...) are deliberately NOT parsed here
 * and must be processed exclusively through parseJoinRoute().
 */
export function normalizeRoomId(value: string): string {
  let clean = (value || "").trim();
  if (clean.includes("/watch/")) {
    clean = clean.split("/watch/")[1]?.split(/[?&#\s]/)[0] || clean;
  } else if (clean.includes("/join/")) {
    clean = clean.split("/join/")[1]?.split(/[?&#\s]/)[0] || clean;
  }
  return clean.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\/+|\/+$/g, "").split(/[?&#\s]/)[0].trim();
}

