/**
 * routeParams.ts - Centralized Typed URL Boundary Layer
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. URL parsing is strictly input normalization, never authorization.
 * 2. Unknown or untrusted parameters (such as ?role=host, ?admin=true, ?isHost=true)
 *    have no semantic meaning and are completely excluded from typed output.
 * 3. Security state is never URL-controlled. Server is the sole authority for
 *    identity, membership, lifecycle, and host permissions.
 */

export type WatchPanel = "chat" | "participants" | "none";

export interface ParsedWatchParams {
  roomId: string;
  panel: WatchPanel;
}

export type MyRoomsStatusFilter = "all" | "active" | "finished" | "expiring";
export type MyRoomsViewMode = "grid" | "stack";

export interface ParsedMyRoomsParams {
  status: MyRoomsStatusFilter;
  view: MyRoomsViewMode;
  page: number;
}

export type AccountTab = "profile" | "preferences" | "security";

export interface ParsedAccountParams {
  tab: AccountTab;
  isCanonicalPath: boolean;
}

export type SafeErrorCode =
  | "session_expired"
  | "permission_denied"
  | "server_unavailable"
  | "room_not_found"
  | "room_ended"
  | "room_full"
  | "unauthorized";

export interface ParsedErrorParams {
  code: SafeErrorCode;
}

export type SafeNotFoundResource = "room" | "page";

export interface ParsedNotFoundParams {
  resource: SafeNotFoundResource;
}

const ALLOWED_WATCH_PANELS = new Set<WatchPanel>(["chat", "participants", "none"]);
const ALLOWED_MYROOMS_STATUS = new Set<MyRoomsStatusFilter>(["all", "active", "finished", "expiring"]);
const ALLOWED_MYROOMS_VIEW = new Set<MyRoomsViewMode>(["grid", "stack"]);
const ALLOWED_ACCOUNT_TABS = new Set<AccountTab>(["profile", "preferences", "security"]);
const ALLOWED_ERROR_CODES = new Set<SafeErrorCode>([
  "session_expired",
  "permission_denied",
  "server_unavailable",
  "room_not_found",
  "room_ended",
  "room_full",
  "unauthorized",
]);
const ALLOWED_NOT_FOUND_RESOURCES = new Set<SafeNotFoundResource>(["room", "page"]);

/**
 * Normalizes watch party URL state.
 * Extracts presentation panel and ignores any untrusted authorization keys.
 */
export function parseWatchParams(search: string, pathRoomId: string = ""): ParsedWatchParams {
  const cleanRoomId = (pathRoomId || "").trim();
  let panel: WatchPanel = "none";

  try {
    const params = new URLSearchParams(search || "");
    const rawPanel = params.get("panel");
    if (rawPanel && ALLOWED_WATCH_PANELS.has(rawPanel as WatchPanel)) {
      panel = rawPanel as WatchPanel;
    }
  } catch {
    panel = "none";
  }

  return {
    roomId: cleanRoomId,
    panel,
  };
}

/**
 * Normalizes My Rooms dashboard query parameters.
 */
export function parseMyRoomsParams(search: string): ParsedMyRoomsParams {
  let status: MyRoomsStatusFilter = "all";
  let view: MyRoomsViewMode = "grid";
  let page = 1;

  try {
    const params = new URLSearchParams(search || "");
    const rawStatus = params.get("status");
    if (rawStatus && ALLOWED_MYROOMS_STATUS.has(rawStatus as MyRoomsStatusFilter)) {
      status = rawStatus as MyRoomsStatusFilter;
    }

    const rawView = params.get("view");
    if (rawView && ALLOWED_MYROOMS_VIEW.has(rawView as MyRoomsViewMode)) {
      view = rawView as MyRoomsViewMode;
    }

    const rawPage = parseInt(params.get("page") || "1", 10);
    if (!isNaN(rawPage) && rawPage > 0) {
      page = rawPage;
    }
  } catch {
    // Defaults on any malformed input
  }

  return { status, view, page };
}

/**
 * Normalizes Account screen parameters.
 * Determines if the current path is canonical (/account/profile, etc.)
 * or if it needs redirecting from legacy query /account?tab=security.
 */
export function parseAccountParams(search: string = "", pathname: string = ""): ParsedAccountParams {
  let tab: AccountTab = "profile";
  let isCanonicalPath = false;

  const normalizedPath = pathname.toLowerCase().replace(/\/+$/, "");

  if (normalizedPath === "/account/preferences") {
    tab = "preferences";
    isCanonicalPath = true;
  } else if (normalizedPath === "/account/security") {
    tab = "security";
    isCanonicalPath = true;
  } else if (normalizedPath === "/account/profile") {
    tab = "profile";
    isCanonicalPath = true;
  } else {
    // Check query parameter fallback
    try {
      const params = new URLSearchParams(search || "");
      const rawTab = params.get("tab");
      if (rawTab && ALLOWED_ACCOUNT_TABS.has(rawTab as AccountTab)) {
        tab = rawTab as AccountTab;
      }
    } catch {
      tab = "profile";
    }
    isCanonicalPath = false;
  }

  return { tab, isCanonicalPath };
}

/**
 * Normalizes application error codes against the safe allowlist.
 * Never allows raw database exceptions or stack traces to be parsed.
 */
export function parseErrorParams(search: string): ParsedErrorParams {
  let code: SafeErrorCode = "server_unavailable";

  try {
    const params = new URLSearchParams(search || "");
    const rawCode = params.get("code");
    if (rawCode && ALLOWED_ERROR_CODES.has(rawCode as SafeErrorCode)) {
      code = rawCode as SafeErrorCode;
    }
  } catch {
    code = "server_unavailable";
  }

  return { code };
}

/**
 * Normalizes not found context resource.
 */
export function parseNotFoundParams(search: string): ParsedNotFoundParams {
  let resource: SafeNotFoundResource = "page";

  try {
    const params = new URLSearchParams(search || "");
    const rawResource = params.get("resource");
    if (rawResource && ALLOWED_NOT_FOUND_RESOURCES.has(rawResource as SafeNotFoundResource)) {
      resource = rawResource as SafeNotFoundResource;
    }
  } catch {
    resource = "page";
  }

  return { resource };
}

// Canonical URL Builders

export function getWatchUrl(roomId: string, panel: WatchPanel = "none"): string {
  const base = `/watch/${encodeURIComponent(roomId)}`;
  if (panel === "chat" || panel === "participants") {
    return `${base}?panel=${panel}`;
  }
  return base;
}

export function getMyRoomsUrl(options: Partial<ParsedMyRoomsParams> = {}): string {
  const params = new URLSearchParams();
  if (options.status && options.status !== "all") {
    params.set("status", options.status);
  }
  if (options.view && options.view !== "grid") {
    params.set("view", options.view);
  }
  if (options.page && options.page > 1) {
    params.set("page", String(options.page));
  }
  const qs = params.toString();
  return qs ? `/myrooms?${qs}` : "/myrooms";
}

export function getAccountUrl(tab: AccountTab = "profile"): string {
  return `/account/${tab}`;
}

export function getErrorUrl(code: SafeErrorCode): string {
  return `/error?code=${encodeURIComponent(code)}`;
}

export function getNotFoundUrl(resource: SafeNotFoundResource = "page"): string {
  return resource === "room" ? "/not-found?resource=room" : "/not-found";
}
