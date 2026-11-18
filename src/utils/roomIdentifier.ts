/**
 * Standard 8-4-4-4-12 canonical UUID syntax regex (matches PostgreSQL uuid type).
 * Case-insensitive hex string with standard hyphenation.
 */
export const CANONICAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict 10-digit ASCII numeric regex for public joining codes.
 * Leading zeros are explicitly preserved.
 */
export const JOINING_CODE_STRICT_REGEX = /^\d{10}$/;

/**
 * Permitted presentation/separator characters in user-entered joining codes.
 * e.g., spaces, hyphens, dots, underscores.
 */
const JOINING_CODE_SEPARATORS_REGEX = /[\s\-_.]/g;

export type RoomUuid = string;
export type RoomJoiningCode = string;

export interface RoomIdentity {
  roomId: RoomUuid;
  joiningId: RoomJoiningCode;
}

export interface RoomIdentityPair {
  id?: RoomUuid;
  roomId?: RoomUuid;
  joiningId: RoomJoiningCode;
}

export type ClassifiedIdentifier =
  | { kind: "uuid"; id: RoomUuid }
  | { kind: "joining_code"; code: RoomJoiningCode }
  | { kind: "legacy_moniker"; moniker: string }
  | { kind: "invalid"; raw: string; reason: string };

/**
 * Validates whether a value matches the canonical UUID syntax accepted by PostgreSQL.
 */
export function isValidCanonicalUuid(val: unknown): val is RoomUuid {
  if (typeof val !== "string") return false;
  return CANONICAL_UUID_REGEX.test(val.trim());
}

/**
 * Normalizes a UUID string to lowercase canonical format.
 * Throws an error if the input is not a valid canonical UUID.
 */
export function normalizeCanonicalUuid(val: unknown): RoomUuid {
  if (typeof val !== "string" || !isValidCanonicalUuid(val)) {
    throw new Error("INVALID_CANONICAL_UUID");
  }
  return val.trim().toLowerCase();
}

/**
 * Generates a fresh canonical RFC 4122 v4 UUID in browser or Node environments.
 */
export function generateCanonicalRoomUuid(): RoomUuid {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().toLowerCase();
  }
  // Fallback RFC 4122 v4 generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normalizes a raw user-supplied joining code:
 * 1. Converts input to string and trims surrounding whitespace.
 * 2. Strips permitted separators (spaces, hyphens, dots, underscores).
 * 3. Enforces that the resulting string is strictly 10 digits.
 *
 * Never parses input as a number to guarantee leading zeroes are preserved.
 * Throws an error if the input cannot be normalized to a valid 10-digit code.
 */
export function normalizeJoiningCode(rawCode: unknown): RoomJoiningCode {
  if (rawCode === null || rawCode === undefined) {
    throw new Error("INVALID_JOINING_CODE: Input is null or undefined");
  }

  const str = String(rawCode).trim();
  const stripped = str.replace(JOINING_CODE_SEPARATORS_REGEX, "");

  if (!JOINING_CODE_STRICT_REGEX.test(stripped)) {
    throw new Error("INVALID_JOINING_CODE: Must be exactly 10 digits");
  }

  return stripped;
}

/**
 * Tests whether a raw input can be normalized into a valid 10-digit joining code.
 */
export function isValidJoiningCode(rawCode: unknown): boolean {
  try {
    normalizeJoiningCode(rawCode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats a 10-digit joining code for human presentation (###-###-####).
 * Formatting is strictly presentation-only. If the input is not exactly 10 digits,
 * returns trimmed string as fallback.
 */
export function formatJoiningCodeForDisplay(code: unknown): string {
  if (code === null || code === undefined) return "";
  const raw = String(code).trim().replace(JOINING_CODE_SEPARATORS_REGEX, "");
  if (raw.length !== 10) return String(code).trim();
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 10)}`;
}

/**
 * Classifies a user-supplied room identifier into canonical UUID, joining code, legacy moniker, or invalid.
 */
export function classifyRoomIdentifier(val: unknown): ClassifiedIdentifier {
  if (typeof val !== "string" || !val.trim()) {
    return { kind: "invalid", raw: String(val ?? ""), reason: "Identifier is empty or non-string" };
  }
  const trimmed = val.trim();
  if (isValidCanonicalUuid(trimmed)) {
    return { kind: "uuid", id: trimmed.toLowerCase() };
  }
  if (isValidJoiningCode(trimmed)) {
    return { kind: "joining_code", code: normalizeJoiningCode(trimmed) };
  }
  if (/^[a-zA-Z0-9_\-\s%]+$/.test(trimmed)) {
    return { kind: "legacy_moniker", moniker: trimmed };
  }
  return { kind: "invalid", raw: trimmed, reason: "Contains illegal characters or invalid format" };
}
