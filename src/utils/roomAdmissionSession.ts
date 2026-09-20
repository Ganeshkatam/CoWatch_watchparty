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
  sessionId: string
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

  try {
    window.sessionStorage.setItem(getStorageKey(roomId), JSON.stringify(payload));
  } catch (err) {
    console.warn("[AdmissionSession] Failed to save admission session:", err);
  }
}

/**
 * Loads and validates a stored admission session for a specific room.
 * Validates structural integrity (matching roomId, non-empty strings, finite createdAt).
 * Never validates cryptographic signatures on client; server remains authoritative.
 */
export function loadAdmissionSession(
  roomId: string
): { admissionToken: string; sessionId: string } | null {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  if (!roomId) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getStorageKey(roomId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const targetRoom = (roomId || "").trim().toLowerCase();
    const storedRoom = typeof parsed.roomId === "string" ? parsed.roomId.trim().toLowerCase() : "";

    if (storedRoom !== targetRoom) {
      return null;
    }

    if (
      typeof parsed.admissionToken !== "string" ||
      parsed.admissionToken.trim().length === 0 ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.trim().length === 0 ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt)
    ) {
      return null;
    }

    return {
      admissionToken: parsed.admissionToken.trim(),
      sessionId: parsed.sessionId.trim(),
    };
  } catch (err) {
    console.warn("[AdmissionSession] Failed to load admission session:", err);
    return null;
  }
}

/**
 * Clears the stored admission session for a room upon explicit exit or terminal admission failure.
 */
export function clearAdmissionSession(roomId: string): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  if (!roomId) {
    return;
  }

  try {
    window.sessionStorage.removeItem(getStorageKey(roomId));
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
export async function restoreAdmissionSession(
  roomId: string,
  serverPath: string,
  token?: string,
  uid?: string
): Promise<{ valid: boolean; admissionToken?: string; sessionId?: string; error?: string; code?: string }> {
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
      if (!token || !uid) {
        return { valid: false, error: "Authentication required", code: "AUTH_REQUIRED" };
      }

      const resp = await fetch(`${serverPath}/room-admission/restore`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.valid && data.admissionToken && data.sessionId) {
          saveAdmissionSession(roomId, data.admissionToken, data.sessionId);
          return {
            valid: true,
            admissionToken: data.admissionToken,
            sessionId: data.sessionId,
          };
        }
        return { valid: false, error: data.error, code: data.code };
      }

      const errData = await resp.json().catch(() => ({}));
      if (resp.status === 401 || resp.status === 403) {
        clearAdmissionSession(roomId);
      }
      return {
        valid: false,
        error: errData.error || "Admission restoration failed",
        code: errData.code,
      };
    } catch (err: any) {
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
