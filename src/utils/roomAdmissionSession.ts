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
