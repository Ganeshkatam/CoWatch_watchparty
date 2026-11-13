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
  isExternal?: boolean;
}

export interface SanitizedExternalUrlResult {
  url: string;
  isExternal: boolean;
}

const DUMMY_BASE = 'http://localhost';

const SUPPORTED_EXACT_ROUTES = new Set([
  '/',
  '/about',
  '/creator',
  '/developer',
  '/support',
  '/terms',
  '/privacy',
  '/faq',
  '/community-guidelines',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/create',
  '/join',
  '/invite',
  '/myrooms',
  '/profile',
  '/room-ended',
  '/debug',
  '/error',
  '/not-found',
]);

const ALLOWED_ACCOUNT_TABS = new Set(['profile', 'preferences', 'security']);

const PARAMETERIZED_ROUTE_PREFIXES = [
  '/watch/',
  '/join/',
  '/invite/',
  '/preflight/',
  '/myrooms/',
];

const TRUSTED_EXTERNAL_HOSTS = new Set([
  'tomesphere.in',
  'cowatch.tomesphere.in',
  'github.com',
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function isValidRouteParam(rawSegment: string): boolean {
  if (!rawSegment || rawSegment.length > 128) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return false; // Rejects malformed percent-encoding (%zz, %, %2)
  }

  // Reject decoded separators and dot traversal
  if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) {
    return false;
  }

  // Strictly alphanumeric, underscores, and hyphens (matching moniker, UUID, base64url generators)
  return /^[a-zA-Z0-9_\-]+$/.test(decoded);
}

function isValidAccountPath(pathname: string): boolean {
  if (pathname === '/account' || pathname === '/account/') return true;
  if (!pathname.startsWith('/account/')) return false;

  const subpath = pathname.slice('/account/'.length).replace(/\/+$/, '');
  const segments = subpath.split('/');
  return segments.length === 1 && ALLOWED_ACCOUNT_TABS.has(segments[0]);
}

function isValidInternalPath(pathname: string): boolean {
  if (SUPPORTED_EXACT_ROUTES.has(pathname)) return true;
  if (isValidAccountPath(pathname)) return true;

  for (const prefix of PARAMETERIZED_ROUTE_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length);
      if (rest.includes('/')) return false;
      return isValidRouteParam(rest);
    }
  }

  return false;
}

/**
 * Validates and normalizes internal notification destinations.
 * Rejects non-relative paths, protocol-relative tricks, external origins,
 * and unsupported route paths, while preserving valid queries and hashes.
 */
export function sanitizeInternalNotificationUrl(
  rawUrl: unknown,
  callerFallback: string = '/',
): string {
  const fallback = callerFallback === '' ? '' : '/';
  if (typeof rawUrl !== 'string') return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallback;

  // 1. Must start with a single slash; reject protocol-relative (//) and backslash bypasses (/\, \\)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) {
    return fallback;
  }

  // 2. Reject pseudo-protocol injections
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return fallback;
  }

  // 3. Structural parse against fixed dummy origin
  let parsed: URL;
  try {
    parsed = new URL(trimmed, DUMMY_BASE);
  } catch {
    return fallback;
  }

  // Reject origin escapes or shifts
  if (parsed.origin !== DUMMY_BASE) {
    return fallback;
  }

  let pathname = parsed.pathname;

  // 4. Legacy route normalization (preserves query params & hashes)
  // Strictly normalize canonical /home and /home/; do not silently rewrite nested /home/anything
  if (pathname === '/home' || pathname === '/home/') {
    pathname = '/';
  } else if (pathname.startsWith('/room/')) {
    pathname = pathname.replace(/^\/room\//, '/watch/');
  }

  // 5. Whitelist validation against registered routes
  if (!isValidInternalPath(pathname)) {
    return fallback;
  }

  // 6. Return verified relative path + query + fragment
  return `${pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Validates external CTA URLs (specifically for SYSTEM_ANNOUNCEMENT).
 * Enforces fail-closed development detection, HTTPS, default port, and explicit trusted host allowlist.
 */
export function sanitizeExternalNotificationUrl(rawUrl: unknown): SanitizedExternalUrlResult | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  // Safe internal relative route check
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\') && !trimmed.startsWith('\\')) {
    const internal = sanitizeInternalNotificationUrl(trimmed, '');
    return internal ? { url: internal, isExternal: false } : undefined;
  }

  try {
    const parsed = new URL(trimmed);

    // Reject userinfo (@) to prevent credential/origin spoofing
    if (parsed.username || parsed.password) {
      return undefined;
    }

    const hostname = parsed.hostname.toLowerCase();
    const isDevelopment = Boolean(
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development')
    );

    // Fail-closed loopback handling: strictly during development
    if (LOOPBACK_HOSTS.has(hostname)) {
      if (!isDevelopment || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        return undefined;
      }
      return { url: parsed.href, isExternal: true };
    }

    // Production destinations must use HTTPS, default port, and match exact trusted hosts
    if (
      parsed.protocol !== 'https:' ||
      parsed.port !== '' ||
      !TRUSTED_EXTERNAL_HOSTS.has(hostname)
    ) {
      return undefined;
    }

    return { url: parsed.href, isExternal: true };
  } catch {
    return undefined;
  }
}

export function resolveNotificationAction(notification: NotificationActionSource): ResolvedNotificationAction {
  const metadata = notification.metadata || {};
  const explicitAction = typeof metadata.action === 'string' ? (metadata.action as NotificationActionType) : undefined;
  const rawRoomId = typeof metadata.roomId === 'string' ? metadata.roomId.trim() : undefined;
  const cleanRoomId = rawRoomId ? encodeURIComponent(rawRoomId) : undefined;
  const sanitizedTarget = typeof metadata.targetUrl === 'string'
    ? sanitizeInternalNotificationUrl(metadata.targetUrl, '')
    : undefined;
  const explicitTargetUrl = sanitizedTarget || undefined;
  const invitationId = typeof metadata.invitationId === 'string' ? metadata.invitationId.trim() : undefined;

  // 1. Authoritative explicit action in metadata
  if (explicitAction) {
    switch (explicitAction) {
      case 'go_home':
        return {
          action: 'go_home',
          label: 'Go Home',
          url: explicitTargetUrl || '/',
          isExternal: false,
        };
      case 'join_room':
        return {
          action: 'join_room',
          label: 'Join Room',
          url: explicitTargetUrl || (cleanRoomId ? `/join/${cleanRoomId}` : '/'),
          isExternal: false,
        };
      case 'join_invitation':
        return {
          action: 'join_invitation',
          label: 'Join Watch Party',
          url: explicitTargetUrl || (invitationId ? `/invite?invitationId=${encodeURIComponent(invitationId)}` : (cleanRoomId ? `/join/${cleanRoomId}` : '/')),
          isExternal: false,
        };
      case 'open_room':
        return {
          action: 'open_room',
          label: 'Open Room',
          url: explicitTargetUrl || (cleanRoomId ? `/watch/${cleanRoomId}` : '/'),
          isExternal: false,
        };
      case 'dismiss':
        return {
          action: 'dismiss',
          label: 'Dismiss',
          url: explicitTargetUrl,
          isExternal: false,
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
        url: '/',
        isExternal: false,
      };

    // Legacy notification fallback (strictly for pre-INVITE-001 notifications):
    //   legacy notification -> /join/:roomId -> manual credential admission
    // New unified invitations use explicit metadata.action = 'join_invitation':
    //   new invitation -> /invite?invitationId=... -> invitation preview -> explicit acceptance
    case 'ROOM_INVITATION':
      return {
        action: 'join_room',
        label: 'Join Room',
        url: cleanRoomId ? `/join/${cleanRoomId}` : '/',
        isExternal: false,
      };

    case 'ROOM_STARTED':
    case 'ROOM_HOST_TRANSFER':
    case 'ROOM_ENDING':
      return {
        action: 'open_room',
        label: 'Open Room',
        url: cleanRoomId ? `/watch/${cleanRoomId}` : '/',
        isExternal: false,
      };

    case 'SYSTEM_ANNOUNCEMENT': {
      const ctaResult = sanitizeExternalNotificationUrl(metadata.ctaUrl);
      const ctaLabel = typeof metadata.ctaLabel === 'string' ? metadata.ctaLabel.trim() : 'Dismiss';
      if (ctaResult) {
        return {
          action: 'open_room',
          label: ctaLabel,
          url: ctaResult.url,
          isExternal: ctaResult.isExternal,
        };
      }
      return {
        action: 'dismiss',
        label: 'Dismiss',
      };
    }

    default:
      return {
        action: 'dismiss',
        label: 'Dismiss',
      };
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

