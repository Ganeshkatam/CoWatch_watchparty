import { apiFetch, ApiError } from "./utils";

export interface StoredRoomAdmission {
  roomId: string;
  admissionToken: string;
  sessionId: string;
  createdAt: number;
}

const STORAGE_KEY_PREFIX = "cowatch_admission_";

function getStorageKey(roomId: string): string {
  const sanitized = (roomId || "").trim().toLowerCase();
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(sanitized)}`;
}

/**
 * Computes a non-reversible 12-char fingerprint of an admission token for secure correlation across trace checkpoints.
 */
export function fingerprintToken(token?: string | null): string {
  if (!token || typeof token !== "string") return "none";
  let h1 = 0x811c9dc5;
  let h2 = 0x9dc5811c;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch << 1), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return (hex1 + hex2).slice(0, 12);
}

/**
 * Persists an issued admission token and its bound sessionId into sessionStorage.
 * Strictly tab-scoped; does not persist raw passcodes.
 */
export function saveAdmissionSession(
  roomId: string,
  admissionToken: string,
  sessionId: string,
  aliases?: string[]
): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  if (!roomId || !admissionToken || !sessionId) {
    return;
  }

  const payload: StoredRoomAdmission = {
    roomId: roomId.trim(),
    admissionToken: admissionToken.trim(),
    sessionId: sessionId.trim(),
    createdAt: Date.now(),
  };

  const keysToSave = new Set<string>();
  keysToSave.add(getStorageKey(roomId));
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      if (alias && typeof alias === "string" && alias.trim()) {
        keysToSave.add(getStorageKey(alias));
      }
    }
  }

  try {
    const serialized = JSON.stringify(payload);
    for (const key of keysToSave) {
      window.sessionStorage.setItem(key, serialized);
    }
  } catch (err) {
    console.warn("[AdmissionSession] Failed to save admission session:", err);
  }
}

/**
 * Loads and validates a stored admission session for a specific room or alias.
 * Validates structural integrity (non-empty strings, finite createdAt).
 * Never validates cryptographic signatures on client; server remains authoritative.
 */
export function loadAdmissionSession(
  roomId: string,
  fallbackAliases?: string[]
): { admissionToken: string; sessionId: string } | null {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  if (!roomId) {
    return null;
  }

  const candidateKeys = [getStorageKey(roomId)];
  if (Array.isArray(fallbackAliases)) {
    for (const alias of fallbackAliases) {
      if (alias && typeof alias === "string" && alias.trim()) {
        candidateKeys.push(getStorageKey(alias));
      }
    }
  }

  for (const key of candidateKeys) {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") continue;

      if (
        typeof parsed.admissionToken !== "string" ||
        parsed.admissionToken.trim().length === 0 ||
        typeof parsed.sessionId !== "string" ||
        parsed.sessionId.trim().length === 0 ||
        typeof parsed.createdAt !== "number" ||
        !Number.isFinite(parsed.createdAt)
      ) {
        continue;
      }

      return {
        admissionToken: parsed.admissionToken.trim(),
        sessionId: parsed.sessionId.trim(),
      };
    } catch {
      // Continue to next alias
    }
  }

  return null;
}

/**
 * Clears the stored admission session for a room upon explicit exit or terminal admission failure.
 */
export function clearAdmissionSession(roomId: string, aliases?: string[]): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  if (!roomId) {
    return;
  }

  const keysToRemove = new Set<string>();
  keysToRemove.add(getStorageKey(roomId));
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      if (alias && typeof alias === "string" && alias.trim()) {
        keysToRemove.add(getStorageKey(alias));
      }
    }
  }

  try {
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch (err) {
    console.warn("[AdmissionSession] Failed to clear admission session:", err);
  }
}

// In-flight restoration promises keyed by cleanRoomId for strict single-flight execution
const inFlightRestorations = new Map<
  string,
  Promise<{ valid: boolean; admissionToken?: string; sessionId?: string; error?: string; code?: string }>
>();

/**
 * Authoritatively restores an active room admission for an authenticated user.
 * Single-flight: concurrent calls for the same room await the existing request.
 */
export interface RestoreAdmissionApiResponse {
  valid: boolean;
  admissionToken?: string;
  sessionId?: string;
  error?: string;
  code?: string;
}

export async function restoreAdmissionSession(
  roomId: string,
  serverPath?: string,
  token?: string,
  uid?: string
): Promise<RestoreAdmissionApiResponse> {
  const cleanRoomId = (roomId || "").trim().toLowerCase();
  if (!cleanRoomId) {
    return { valid: false, error: "Missing roomId", code: "INVALID_ROOM" };
  }

  const existing = inFlightRestorations.get(cleanRoomId);
  if (existing) {
    return existing;
  }

  const restorationPromise = (async () => {
    try {
      const data = await apiFetch<RestoreAdmissionApiResponse>("/room-admission/restore", {
        method: "POST",
        requireAuth: true,
        body: { roomId },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (data?.valid && data.admissionToken && data.sessionId) {
        saveAdmissionSession(roomId, data.admissionToken, data.sessionId);
        return {
          valid: true,
          admissionToken: data.admissionToken,
          sessionId: data.sessionId,
        };
      }
      return { valid: false, error: data?.error, code: data?.code };
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          clearAdmissionSession(roomId);
        }
        return {
          valid: false,
          error: err.message || "Admission restoration failed",
          code: err.code,
        };
      }
      return {
        valid: false,
        error: err?.message || "Network error",
        code: "NETWORK_ERROR",
      };
    } finally {
      inFlightRestorations.delete(cleanRoomId);
    }
  })();

  inFlightRestorations.set(cleanRoomId, restorationPromise);
  return restorationPromise;
}
