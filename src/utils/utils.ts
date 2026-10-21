//@ts-expect-error
import canAutoplay from "can-autoplay";
import type { User } from "@supabase/supabase-js";
import config from "../config";
import { cyrb53 } from "./hash";
import { supabase, getAccessToken } from "./supabaseClient";

export function formatTimestamp(input: any, zeroTime?: number): string {
  if (
    input === null ||
    input === undefined ||
    input === false ||
    Number.isNaN(input) ||
    input === Infinity
  ) {
    return "";
  }
  if (zeroTime) {
    return new Date((zeroTime + input) * 1000).toLocaleTimeString();
  }
  let hours = Math.abs(Math.trunc(Number(input) / 3600));
  let minutes = Math.abs(Math.trunc(Number(input) / 60) % 60)
    .toString()
    .padStart(2, "0");
  let seconds = Math.abs(Math.trunc(Number(input) % 60))
    .toString()
    .padStart(2, "0");
  return `${Number(input) < 0 ? "-" : ""}${hours ? `${hours}:` : ""}${minutes}:${seconds}`;
}

export function formatSpeed(input: number) {
  if (input >= 1000000) {
    return (input / 1000000).toFixed(2) + " MB/s";
  }
  if (input >= 1000) {
    return (input / 1000).toFixed(0) + " KB/s";
  }
  return input + " B/s";
}

export function formatSize(input: number) {
  if (input >= 1000000000) {
    return (input / 1000000000).toFixed(2) + " GB";
  }
  if (input >= 1000000) {
    return (input / 1000000).toFixed(2) + " MB";
  }
  if (input >= 1000) {
    return (input / 1000).toFixed(0) + " KB";
  }
  return input + " B";
}

export const colorMappings: StringDict = {
  red: "B03060",
  orange: "FE9A76",
  yellow: "FFD700",
  olive: "32CD32",
  green: "016936",
  teal: "008080",
  blue: "0E6EB8",
  violet: "EE82EE",
  purple: "B413EC",
  pink: "FF1493",
  brown: "A52A2A",
  grey: "A0A0A0",
};

export const softWhite = "var(--text-primary)";

let colorCache: NumberDict = {};
export function getColorForString(id: string) {
  let colors = Object.keys(colorMappings);
  if (colorCache[id]) {
    return colors[colorCache[id]];
  }
  colorCache[id] = Math.abs(cyrb53(id)) % colors.length;
  return colors[colorCache[id]];
}

export function getColorForStringHex(id: string) {
  return colorMappings[getColorForString(id)];
}


export const YOUTUBE_VIDEO_ID_REGEX =
  /(?:(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts|live)\/|\S*?[?&]v=)|youtu\.be\/))([a-zA-Z0-9_-]{11})/i;

export const getYoutubeVideoID = (url: string): string | undefined => {
  if (!url || typeof url !== "string") {
    return undefined;
  }
  const trimmed = url.trim();
  const idParts = YOUTUBE_VIDEO_ID_REGEX.exec(trimmed);
  if (idParts && idParts[1]) {
    return idParts[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
};

export const normalizeYouTubeUrl = (url: string): string => {
  const id = getYoutubeVideoID(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
};

export const isYouTube = (input: string): boolean => {
  if (!input || typeof input !== "string") {
    return false;
  }
  return Boolean(getYoutubeVideoID(input));
};

export const isHttp = (input: string) => {
  return input.startsWith("http");
};

export const isMagnet = (input: string) => {
  return input.startsWith("magnet:");
};

export const isHls = (input: string) => {
  return input.includes(".m3u8");
};

export const isDash = (input: string) => {
  return input.includes(".mpd");
};

export const isMpegTs = (input: string) => {
  return input.includes(".mpegts");
};

export const isScreenShare = (input: string) => {
  return input.startsWith("screenshare://");
};

export const isFileShare = (input: string) => {
  return input.startsWith("fileshare://");
};

export const isLocalMedia = (input: string) => {
  return Boolean(input && input.startsWith("localmedia://"));
};



export async function testAutoplay() {
  const result = await canAutoplay.video();
  return result.result;
}

export function decodeEntities(input: string) {
  const doc = new DOMParser().parseFromString(input, "text/html");
  return doc.documentElement.textContent;
}

export const debounce = (callback: Function, wait = 500) => {
  let timeoutId: any = null;
  return (...args: any[]) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, wait);
  };
};

export const getDefaultPicture = (name: string, background = "a0a0a0") => {
  const safeName = encodeURIComponent((name || "User").trim());
  const cleanBg = (background || "a0a0a0").replace("#", "");
  return `https://ui-avatars.com/api/?name=${safeName}&background=${cleanBg}&size=256&color=ffffff`;
};

export const isMobile = () => {
  if (typeof window === "undefined") return false;
  return (
    window.innerWidth <= 768 ||
    window.screen.width <= 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
  );
};

export function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

export const getDefaultIceServers = (): RTCIceServer[] => {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(import.meta.env.VITE_ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (e) {
      console.warn("Invalid VITE_ICE_SERVERS JSON configuration; falling back to default ICE servers.", e);
    }
  }

  return [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:5.161.207.54:3478",
      username: "username",
      credential: "password",
    },
    {
      urls: "turn:5.161.49.183:3478",
      username: "username",
      credential: "password",
    },
    {
      urls: "turn:135.181.147.65:3478",
      username: "username",
      credential: "password",
    },
    {
      urls: "turn:5.78.83.26:3478",
      username: "username",
      credential: "password",
    },
    {
      urls: "turn:5.223.48.157:3478",
      username: "username",
      credential: "password",
    },
  ];
};

export interface CachedIceEntry {
  iceServers: RTCIceServer[];
  expiresAt: number;
  refreshTimer?: any;
  retryTimer?: any;
  retryAttempt?: number;
}

export interface PrewarmIceOptions {
  roomId?: string;
  token?: string;
  admissionToken?: string;
  callerUid?: string;
  sessionId?: string;
  forceRefresh?: boolean;
}

const iceCacheByContext = new Map<string, CachedIceEntry>();
const contextGenerationMap = new Map<string, number>();
let activeContextKey: string = "default";
const inflightPrewarmPromises = new Map<string, Promise<RTCIceServer[]>>();

export const iceServers = (contextKey?: string): RTCIceServer[] => {
  const key = contextKey || activeContextKey || "default";
  const entry = iceCacheByContext.get(key);
  if (entry) {
    // If expired, immediately purge to prevent passing expired credentials to RTCPeerConnection
    if (Date.now() >= entry.expiresAt) {
      if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
      if (entry.retryTimer) clearTimeout(entry.retryTimer);
      iceCacheByContext.delete(key);
      return getDefaultIceServers();
    }
    return entry.iceServers;
  }
  return getDefaultIceServers();
};

export async function getIceServersAsync(contextKey?: string): Promise<RTCIceServer[]> {
  const key = contextKey || activeContextKey || "default";
  const inflight = inflightPrewarmPromises.get(key);
  if (inflight) {
    try {
      return await inflight;
    } catch {
      return iceServers(key);
    }
  }
  return iceServers(key);
}

export function clearIceServersCache(target?: string): void {
  const clearEntryTimers = (entry: CachedIceEntry) => {
    if (entry.refreshTimer) {
      clearTimeout(entry.refreshTimer);
      entry.refreshTimer = undefined;
    }
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = undefined;
    }
  };

  if (target) {
    const keysToDelete: string[] = [];
    for (const [key, entry] of iceCacheByContext.entries()) {
      // Exact match or prefix match (e.g. "room_1" matches "room_1:user_1:sess_1")
      if (key === target || key.startsWith(target + ":")) {
        clearEntryTimers(entry);
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      iceCacheByContext.delete(k);
    }

    // Invalidate per-context generations and in-flight promises matching target
    for (const key of Array.from(contextGenerationMap.keys())) {
      if (key === target || key.startsWith(target + ":")) {
        contextGenerationMap.set(key, (contextGenerationMap.get(key) || 0) + 1);
      }
    }
    for (const key of Array.from(inflightPrewarmPromises.keys())) {
      if (key === target || key.startsWith(target + ":")) {
        inflightPrewarmPromises.delete(key);
      }
    }
    contextGenerationMap.set(target, (contextGenerationMap.get(target) || 0) + 1);

    if (activeContextKey === target || activeContextKey.startsWith(target + ":")) {
      activeContextKey = "default";
    }
  } else {
    for (const entry of iceCacheByContext.values()) {
      clearEntryTimers(entry);
    }
    iceCacheByContext.clear();
    inflightPrewarmPromises.clear();
    for (const k of contextGenerationMap.keys()) {
      contextGenerationMap.set(k, (contextGenerationMap.get(k) || 0) + 1);
    }
    activeContextKey = "default";
  }
}

export async function prewarmIceServers(options: PrewarmIceOptions = {}): Promise<RTCIceServer[]> {
  const roomId = options.roomId?.trim() || "";
  const callerUid = options.callerUid?.trim() || "";
  const sessionId = options.sessionId?.trim() || "";
  const contextKey = `${roomId || "global"}:${callerUid || "anon"}:${sessionId || "nosess"}`;
  activeContextKey = contextKey;

  const currentGen = (contextGenerationMap.get(contextKey) || 0) + 1;
  contextGenerationMap.set(contextKey, currentGen);

  const now = Date.now();
  const existing = iceCacheByContext.get(contextKey);
  // Return cached credentials if valid for at least 15 more minutes, unless forceRefresh is requested
  if (!options.forceRefresh && existing && existing.expiresAt > now + 15 * 60 * 1000) {
    return existing.iceServers;
  }

  // Request coalescing: share in-flight fetch promise for identical authorization context
  const inflight = inflightPrewarmPromises.get(contextKey);
  if (inflight) {
    return inflight;
  }

  const fetchPromise = (async () => {
    try {
      const headers: Record<string, string> = {};
      if (options.token) {
        headers["Authorization"] = `Bearer ${options.token}`;
      }
      if (options.admissionToken) {
        headers["X-Admission-Token"] = options.admissionToken;
      }
      if (roomId) {
        headers["X-Room-Id"] = roomId;
      }
      if (callerUid) {
        headers["X-Caller-Uid"] = callerUid;
      }
      if (sessionId) {
        headers["X-Session-Id"] = sessionId;
      }

      const res = await fetch("/api/media/ice-servers", { headers });
      if (!res.ok) {
        throw new Error(`HTTP_${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        // Validate generation: drop late response if context was torn down during in-flight fetch
        if (contextGenerationMap.get(contextKey) !== currentGen) {
          return getDefaultIceServers();
        }

        const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : now + (data.ttlSeconds || 10800) * 1000;
        const oldEntry = iceCacheByContext.get(contextKey);
        if (oldEntry?.refreshTimer) clearTimeout(oldEntry.refreshTimer);
        if (oldEntry?.retryTimer) clearTimeout(oldEntry.retryTimer);

        // Schedule background refresh 15 minutes before expiration (minimum 30 seconds from now)
        const refreshDelayMs = Math.max(30000, expiresAt - now - 15 * 60 * 1000);
        let refreshTimer: any;
        const timerHost = typeof window !== "undefined" ? window : globalThis;
        if (typeof timerHost.setTimeout === "function") {
          refreshTimer = timerHost.setTimeout(() => {
            prewarmIceServers({ ...options, forceRefresh: true }).catch((err) => {
              console.warn("[ICE] Scheduled refresh failed:", err);
            });
          }, refreshDelayMs);
        }

        iceCacheByContext.set(contextKey, {
          iceServers: data.iceServers,
          expiresAt,
          refreshTimer,
          retryAttempt: 0,
        });

        return data.iceServers;
      }
    } catch (err) {
      console.warn("[ICE] Failed to prewarm ICE servers; falling back to default:", err);
      if (contextGenerationMap.get(contextKey) !== currentGen) {
        return getDefaultIceServers();
      }

      const current = iceCacheByContext.get(contextKey);
      if (current) {
        const currentNow = Date.now();
        if (currentNow >= current.expiresAt) {
          // Hard expiry reached: purge dead credentials immediately so they are never served
          if (current.refreshTimer) clearTimeout(current.refreshTimer);
          if (current.retryTimer) clearTimeout(current.retryTimer);
          iceCacheByContext.delete(contextKey);
        } else {
          // Bounded exponential backoff retry while credentials remain valid
          // Backoff delays: 30s, 60s, 120s (max 3 attempts)
          const retryAttempt = current.retryAttempt ?? 0;
          const retryDelays = [30000, 60000, 120000];
          const nextDelay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];

          // Only retry if next attempt occurs at least 30s before hard expiration
          if (retryAttempt < 3 && currentNow + nextDelay < current.expiresAt - 30000) {
            if (current.retryTimer) {
              clearTimeout(current.retryTimer);
            }
            const timerHost = typeof window !== "undefined" ? window : globalThis;
            if (typeof timerHost.setTimeout === "function") {
              current.retryTimer = timerHost.setTimeout(() => {
                prewarmIceServers({ ...options, forceRefresh: true }).catch((e) => {
                  console.warn("[ICE] Retry refresh failed:", e);
                });
              }, nextDelay);
            }
            current.retryAttempt = retryAttempt + 1;
          }
        }
      }
    } finally {
      inflightPrewarmPromises.delete(contextKey);
    }
    return iceServers(contextKey);
  })();

  inflightPrewarmPromises.set(contextKey, fetchPromise);
  return fetchPromise;
}

export const serverCandidates: string[] = (() => {
  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (isLocalhost) {
      return [`${window.location.protocol}//${window.location.hostname}:8080`];
    }
  }
  if (config.VITE_SERVER_HOST) {
    return String(config.VITE_SERVER_HOST)
      .split(",")
      .map((s: string) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return [window.location.origin];
  }
  return [];
})();

const getInitialServerPath = (): string => {
  if (typeof window !== "undefined") {
    try {
      const cached = sessionStorage.getItem("cowatch_active_backend");
      if (cached && serverCandidates.includes(cached)) {
        return cached;
      }
    } catch (_) {}
  }
  return (
    serverCandidates[0] ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:8080")
  );
};

export let serverPath: string = getInitialServerPath();

export function setServerPath(newPath: string): void {
  serverPath = newPath.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem("cowatch_active_backend", serverPath);
    } catch (_) {}
  }
}

export async function resolveFastestServer(): Promise<string> {
  if (serverCandidates.length <= 1) {
    return serverPath;
  }
  try {
    const fastest = await Promise.any(
      serverCandidates.map(async (candidate) => {
        const res = await fetch(`${candidate}/ping`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`Ping failed for ${candidate}`);
        return candidate;
      })
    );
    if (fastest && fastest !== serverPath) {
      setServerPath(fastest);
      console.log(`Active backend switched to fastest server: ${fastest}`);
    }
    return fastest;
  } catch (e) {
    return serverPath;
  }
}

// Automatically race and connect to the fastest available backend
if (typeof window !== "undefined" && serverCandidates.length > 1) {
  resolveFastestServer().catch(() => {});
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryAfter?: number;

  constructor(code: string, message: string, status = 400, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: any;
  requireAuth?: boolean;
  timeoutMs?: number;
  retryOn401?: boolean;
}

/**
 * Authoritative client-to-server HTTP connection layer.
 *
 * Guarantees:
 * 1. Automatic active backend origin routing via serverPath.
 * 2. Automatic Bearer JWT authentication header injection.
 * 3. Transparent token refresh and single retry upon 401 Unauthorized.
 * 4. Deterministic request timeout protection (default 10s).
 * 5. Safe non-JSON proxy/gateway error handling.
 * 6. Structured ApiError parsing with Retry-After support.
 */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const {
    body,
    requireAuth = false,
    timeoutMs = 10000,
    retryOn401 = true,
    headers: customHeaders = {},
    signal: callerSignal,
    ...fetchOptions
  } = options;

  const url =
    endpoint.startsWith("http://") || endpoint.startsWith("https://")
      ? endpoint
      : `${serverPath}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const abortController = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (callerSignal) {
    callerSignal.addEventListener("abort", () => {
      abortController.abort(callerSignal.reason);
    });
  }

  const executeRequest = async (token?: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(customHeaders as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let serializedBody: BodyInit | null | undefined = undefined;
    if (body !== undefined && body !== null) {
      if (
        typeof body === "string" ||
        body instanceof FormData ||
        body instanceof URLSearchParams ||
        body instanceof Blob
      ) {
        serializedBody = body as BodyInit;
      } else {
        headers["Content-Type"] = "application/json";
        serializedBody = JSON.stringify(body);
      }
    }

    return await fetch(url, {
      ...fetchOptions,
      headers,
      body: serializedBody,
      signal: abortController.signal,
    });
  };

  try {
    const providedAuth = (customHeaders as Record<string, string>)?.["Authorization"];
    let token = await getAccessToken(2000);
    if (requireAuth && !token && !providedAuth) {
      throw new ApiError("UNAUTHENTICATED", "Active authentication session is required", 401);
    }

    let res = await executeRequest(token);

    // Transparent token refresh and single replay upon 401
    if (res.status === 401 && retryOn401) {
      try {
        const { data } = await supabase.auth.refreshSession();
        const refreshedToken = data.session?.access_token;
        if (refreshedToken && refreshedToken !== token) {
          token = refreshedToken;
          res = await executeRequest(token);
        }
      } catch (_) {
        // Fall through to error handling
      }
    }

    if (!res.ok) {
      let code = `HTTP_${res.status}`;
      let message = res.statusText || `Request failed with status ${res.status}`;
      let retryAfter: number | undefined = undefined;

      const retryAfterHeader = res.headers.get("Retry-After");
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfter = parsed;
        }
      }

      try {
        const json = await res.json();
        if (json?.error) {
          code = json.error.code || code;
          message = json.error.message || message;
          if (json.error.retryAfter) {
            retryAfter = json.error.retryAfter;
          }
        } else if (json?.message) {
          message = json.message;
        }
      } catch {
        // Non-JSON response (e.g. 502/503 HTML from proxy)
      }

      throw new ApiError(code, message, res.status, retryAfter);
    }

    if (res.status === 204) {
      return undefined as unknown as T;
    }

    const contentType = res.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (timedOut) {
      throw new ApiError("REQUEST_TIMEOUT", `Request to ${endpoint} timed out after ${timeoutMs}ms`, 408);
    }
    if (err.name === "AbortError" && callerSignal?.aborted) {
      throw err;
    }
    throw new ApiError("NETWORK_ERROR", err.message || "Network connection failure", 0);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

export function getRoomUrl(roomId: string): string {
  const cleanId = roomId.replace(/^\//, '');
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return origin ? `${origin}/join/${cleanId}` : `/join/${cleanId}`;
}

export function getInviteMessage(roomId: string, passcode?: string): string {
  const cleanId = roomId.replace(/^\//, '');
  const url = getRoomUrl(roomId);
  if (passcode) {
    return `Hey! Join my watch party on CoWatch:\n\nLink: ${url}\n\nRoom ID:\n\`${cleanId}\`\n\nPasscode:\n\`${passcode}\``;
  }
  return `Hey! Join my watch party on CoWatch:\n\nLink: ${url}\n\nRoom ID:\n\`${cleanId}\`\n\nPasscode: [Passcode Required - Ask Host]`;
}

/**
 * Parses user input into a canonical room ID / slug.
 * Supports:
 * - abc123
 * - /abc123
 * - https://<host>/join/abc123
 * - https://<host>/join/abc123/...
 * - https://<host>/watch/abc123
 * - /join/abc123
 * - /watch/abc123
 * Rejects unrelated URLs and malformed inputs.
 */
export function parseRoomInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Handle absolute URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      const pathname = parsed.pathname;

      if (pathname.includes("/join/")) {
        const afterJoin = pathname.split("/join/")[1] || "";
        const segment = afterJoin.split("/")[0]?.split("?")[0];
        return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
      }

      if (pathname.includes("/watch/")) {
        const afterWatch = pathname.split("/watch/")[1] || "";
        const segment = afterWatch.split("/")[0]?.split("?")[0];
        return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  // Handle path-based inputs
  if (trimmed.startsWith("/join/")) {
    const segment = trimmed.slice(6).split("/")[0]?.split("?")[0];
    return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
  }

  if (trimmed.startsWith("/watch/")) {
    const segment = trimmed.slice(7).split("/")[0]?.split("?")[0];
    return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
  }

  if (trimmed.startsWith("/")) {
    const segment = trimmed.slice(1).split("/")[0]?.split("?")[0];
    return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
  }

  // Handle plain room code or slug
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function getMediaPathResults(
  mediaPath: string,
  query: string,
): Promise<SearchResult[]> {
  let results: SearchResult[] = [];
  // if (mediaPath.includes('s3.')) {
  //   const response = await fetch(mediaPath);
  //   // S3-style buckets return data in XML
  //   const xml = await response.text();
  //   const parser = new XMLParser();
  //   const data = parser.parse(xml);
  //   let filtered = data.ListBucketResult.Contents.filter(
  //     // Exclude subdirectories
  //     (file: any) => !file.Key.includes('/'),
  //   );
  //   results = filtered.map((file: any) => ({
  //     url: mediaPath + '/' + file.Key,
  //     name: mediaPath + '/' + file.Key,
  //   }));
  // } else
  const playlistMatch = /(?:youtube\.com\/playlist\?list=)([a-zA-Z0-9_-]+)/i.exec(mediaPath);
  if (playlistMatch) {
    // https://www.youtube.com/playlist?list=<playlist ID>
    const playlistID = playlistMatch[1];
    try {
      const response = await fetch(serverPath + "/youtubePlaylist/" + playlistID);
      if (response.ok) {
        const json = await response.json();
        if (Array.isArray(json)) {
          results = json;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch YouTube playlist:", e);
    }
  } else {
    // Assume it's a text list of URLs
    const response = await fetch(mediaPath);
    const text = await response.text();
    results = text
      .split("\n")
      .map((line) => ({ url: line, name: line, duration: 0, type: "file" }));
  }
  return results.filter((res) => res.url);
}

export async function getStreamPathResults(
  streamPath: string,
  query: string,
): Promise<SearchResult[]> {
  const response = await fetch(
    streamPath + `/${query ? "search" : "top"}?q=` + encodeURIComponent(query),
  );
  const data = await response.json();
  return data.map((d: any, i: number) => ({
    ...d,
    url: d.magnet ?? String(i),
  }));
}

export type YouTubeSearchResults = SearchResult[] & { nextPageToken?: string };

export async function getYouTubeResults(
  query: string,
  pageToken?: string,
): Promise<YouTubeSearchResults> {
  const cleanQuery = query?.trim();
  if (!cleanQuery) {
    const emptyResults: any = [];
    emptyResults.nextPageToken = undefined;
    return emptyResults;
  }

  // 1. Try active serverPath first
  try {
    let url = `${serverPath}/youtube?q=${encodeURIComponent(cleanQuery)}`;
    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }
    url += "&paginated=1";
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (response.ok) {
      const data = await response.json();
      let rawItems: any[] = [];
      let nextToken: string | undefined = undefined;

      if (Array.isArray(data)) {
        rawItems = data;
      } else if (data && Array.isArray(data.items)) {
        rawItems = data.items;
        nextToken = data.nextPageToken || undefined;
      }

      if (rawItems.length > 0) {
        const results: any = rawItems.map((d: any) => ({ ...d, type: "youtube" }));
        results.nextPageToken = nextToken;
        return results;
      }
    }
  } catch (err) {
    console.warn("Primary backend YouTube search error:", err);
  }

  // 2. Try secondary serverCandidates if active server failed or returned empty
  for (const candidate of serverCandidates) {
    if (candidate === serverPath) continue;
    try {
      let url = `${candidate}/youtube?q=${encodeURIComponent(cleanQuery)}`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }
      url += "&paginated=1";
      const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (response.ok) {
        const data = await response.json();
        let rawItems: any[] = [];
        let nextToken: string | undefined = undefined;

        if (Array.isArray(data)) {
          rawItems = data;
        } else if (data && Array.isArray(data.items)) {
          rawItems = data.items;
          nextToken = data.nextPageToken || undefined;
        }

        if (rawItems.length > 0) {
          setServerPath(candidate);
          const results: any = rawItems.map((d: any) => ({ ...d, type: "youtube" }));
          results.nextPageToken = nextToken;
          return results;
        }
      }
    } catch (_) {}
  }

  // 3. Client-side fallback to verified public Invidious instances with CORS
  const fallbackInstances = [
    "https://invidious.f5.si",
  ];
  const pageNum =
    pageToken && !isNaN(Number(pageToken)) ? Math.max(1, Number(pageToken)) : 1;

  for (const instance of fallbackInstances) {
    try {
      const invRes = await fetch(
        `${instance}/api/v1/search?q=${encodeURIComponent(cleanQuery)}&page=${pageNum}&type=video`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4500),
        },
      );
      if (invRes.ok) {
        const invData = await invRes.json();
        if (Array.isArray(invData) && invData.length > 0) {
          const items = invData.map((d: any) => ({
            name: d.title || "YouTube Video",
            url: `https://www.youtube.com/watch?v=${d.videoId}`,
            img:
              d.videoThumbnails?.[0]?.url ||
              `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`,
            channel: d.author || "YouTube",
            duration: Number(d.lengthSeconds) || 0,
            type: "youtube" as const,
          }));
          const results: any = items;
          results.nextPageToken = items.length >= 10 ? String(pageNum + 1) : undefined;
          return results;
        }
      }
    } catch (_) {}
  }

  const emptyResults: any = [];
  emptyResults.nextPageToken = undefined;
  return emptyResults;
}

export async function openFileSelector(accept?: string) {
  return new Promise<FileList | null>((resolve) => {
    // Create an input element
    const inputElement = document.createElement("input");

    // Set its type to file
    inputElement.type = "file";

    // Set accept to the file types you want the user to select.
    // Include both the file extension and the mime type
    if (accept) {
      inputElement.accept = accept;
    }

    // set onchange event to call callback when user has selected file
    inputElement.addEventListener("change", () => {
      resolve(inputElement.files);
    });

    // dispatch a click event to open the file dialog
    inputElement.dispatchEvent(new MouseEvent("click"));
  });
}

let ephemeralClientId: string | null = null;
export function getOrCreateClientId() {
  if (!ephemeralClientId) {
    ephemeralClientId = createUuid();
  }
  return ephemeralClientId;
}

export function getOrCreateSessionId() {
  let sessionId = window.localStorage.getItem("cowatch-sessionid");
  if (!sessionId) {
    // Generate a new sessionID and save it
    // This requires https, so fallback to JS implementation if needed
    sessionId = createUuid();
    window.localStorage.setItem("cowatch-sessionid", sessionId);
  }
  return sessionId;
}

// Passcodes must NEVER be stored locally. Purge any legacy stored passcodes on module load.
if (typeof window !== "undefined" && window.localStorage) {
  try {
    window.localStorage.removeItem("cowatch-passcodes");
  } catch (e) {}
}

export function addAndSavePasscode(_roomId: string, _passcode: string) {
  // Passcodes must NEVER be stored locally in localStorage or IndexedDB
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem("cowatch-passcodes");
    } catch (e) {}
  }
}

export function removeSavedPasscode(_roomId: string) {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem("cowatch-passcodes");
    } catch (e) {}
  }
}

export function getSavedPasscodes(): Record<string, string> {
  // Always return empty and ensure local storage is clean
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem("cowatch-passcodes");
    } catch (e) {}
  }
  return {};
}

export function createUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : uuidv4();
}

export function calculateMedian(array: number[]): number {
  // Check If Data Exists
  if (array.length >= 1) {
    // Sort Array
    array = array.sort((a: number, b: number) => {
      return a - b;
    });

    // Array Length: Even
    if (array.length % 2 === 0) {
      // Average Of Two Middle Numbers
      return (array[array.length / 2 - 1] + array[array.length / 2]) / 2;
    }
    // Array Length: Odd
    else {
      // Middle Number
      return array[(array.length - 1) / 2];
    }
  }
  return 0;
}

export function isTsMapEqual(
  prev: NumberDict | null | undefined,
  next: NumberDict | null | undefined,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i];
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

type ResolvedProfile = {
  displayName: string;
  avatarUrl: string | null;
};

export const resolveProfile = (
  profile: any | null,
  user: User
): ResolvedProfile => ({
  displayName:
    profile?.display_name?.trim() ||
    user.user_metadata?.display_name?.trim() ||
    user.user_metadata?.full_name?.trim() ||
    user.user_metadata?.name?.trim() ||
    profile?.username?.trim() ||
    user.user_metadata?.username?.trim() ||
    user.email?.split("@")[0] ||
    "Guest",

  avatarUrl:
    profile?.avatar_url ||
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null,
});
export const autoCreateUsername = (
  name?: string | null,
  email?: string | null,
  suffix?: number
): string => {
  // Requirement: Generated from email, all small letters only, must have numbers, unique, no capitals or space
  let source = "";
  if (email && email.trim()) {
    source = email.split("@")[0];
  } else if (name && name.trim()) {
    source = name;
  }

  // Normalize diacritics / accents: e.g. "François" -> "Francois"
  const normalized = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Small letters only, no capitals, no space. Underscores allowed as separator.
  const clean = normalized
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);

  const base = clean.replace(/_[0-9]+$/, "") || "user";
  const num = suffix ?? Math.floor(1000 + Math.random() * 9000);
  return `${base}_${num}`;
};

export const getFileName = (input: string) => {
  return input.split("/").slice(-1)[0];
};

export const isEmojiString = (input?: string): boolean => {
  return /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])+$/g.test(
    input ?? "",
  );
};

function uuidv4() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16),
  );
}

// Subtract header, URL row, button row, 3 gaps, controls
export const VIDEO_MAX_HEIGHT_CSS =
  "calc(100vh - 64px - 36px - 36px - 4px - 4px - 4px - 32px)";

/**
 * Distinguishes permanently dead / concluded rooms from reusable rooms.
 * Permanent rooms are reusable indefinitely across sessions (active <-> inactive)
 * and only destroyed via explicit owner deletion.
 */
export const isTerminalRoom = (
  room?: { isPermanent?: boolean | null; status?: string | null } | null
): boolean => {
  if (!room) return false;
  return !room.isPermanent && (room.status === "ended" || room.status === "expired");
};

