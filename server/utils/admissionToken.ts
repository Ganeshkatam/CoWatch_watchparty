import crypto from "crypto";
import config from "../config.ts";

const ADMISSION_SECRET =
  config.SUPABASE_SECRET_KEY ||
  config.STATS_KEY ||
  "cowatch-participant-admission-salt-32b";

export interface AdmissionPayload {
  roomId: string;
  userId: string;
  sessionId: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AdmissionVerificationResult {
  valid: boolean;
  error?: string;
  payload?: AdmissionPayload;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}

/**
 * Generates a signed, short-lived admission token for a participant.
 * Binds the room ID, verified user ID, and client session ID.
 */
export function generateAdmissionToken(params: {
  roomId: string;
  userId: string;
  sessionId: string;
  ttlSeconds?: number;
}): string {
  const { roomId, userId, sessionId, ttlSeconds = 900 } = params;
  if (!roomId || !userId || !sessionId) {
    throw new Error("ADMISSION_TOKEN_MISSING_PARAMS");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: AdmissionPayload = {
    roomId: roomId.trim(),
    userId: userId.trim(),
    sessionId: sessionId.trim(),
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };

  const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadEncoded = toBase64Url(payloadBuffer);

  const hmac = crypto.createHmac("sha256", ADMISSION_SECRET);
  hmac.update(payloadEncoded);
  const signatureEncoded = toBase64Url(hmac.digest());

  return `${payloadEncoded}.${signatureEncoded}`;
}

/**
 * Verifies an admission token against cryptographic signature, expiration,
 * room ID, verified user ID, and client session ID.
 */
export function verifyAdmissionToken(
  token: string | undefined | null,
  expectedRoomId: string,
  callerUid?: string | null,
  clientSessionId?: string | null
): AdmissionVerificationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "ADMISSION_TOKEN_MISSING" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "ADMISSION_TOKEN_MALFORMED" };
  }

  const [payloadEncoded, signatureEncoded] = parts;

  // Verify HMAC signature in constant time
  const hmac = crypto.createHmac("sha256", ADMISSION_SECRET);
  hmac.update(payloadEncoded);
  const expectedSignatureBuffer = hmac.digest();
  const actualSignatureBuffer = fromBase64Url(signatureEncoded);

  if (
    actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
  ) {
    return { valid: false, error: "ADMISSION_TOKEN_SIGNATURE_INVALID" };
  }

  let payload: AdmissionPayload;
  try {
    const rawJson = fromBase64Url(payloadEncoded).toString("utf8");
    payload = JSON.parse(rawJson);
  } catch {
    return { valid: false, error: "ADMISSION_TOKEN_PAYLOAD_INVALID" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { valid: false, error: "ADMISSION_TOKEN_EXPIRED" };
  }

  const cleanExpectedRoom = (expectedRoomId || "").trim();
  if (!cleanExpectedRoom || payload.roomId !== cleanExpectedRoom) {
    return { valid: false, error: "ADMISSION_TOKEN_ROOM_MISMATCH" };
  }

  if (callerUid && payload.userId !== callerUid.trim()) {
    return { valid: false, error: "ADMISSION_TOKEN_USER_MISMATCH" };
  }

  if (clientSessionId && payload.sessionId !== clientSessionId.trim()) {
    return { valid: false, error: "ADMISSION_TOKEN_SESSION_MISMATCH" };
  }

  return { valid: true, payload };
}
