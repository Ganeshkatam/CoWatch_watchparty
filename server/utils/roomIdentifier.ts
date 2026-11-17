import crypto from "crypto";
import type pg from "pg";

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

export interface RoomIdentityPair {
  id: RoomUuid;
  joiningId: RoomJoiningCode;
}

export type ClassifiedIdentifier =
  | { kind: "uuid"; id: RoomUuid }
  | { kind: "joining_code"; code: RoomJoiningCode }
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
 * Generates a fresh canonical RFC 4122 v4 UUID using Node.js crypto CSPRNG.
 */
export function generateCanonicalRoomUuid(): RoomUuid {
  return crypto.randomUUID().toLowerCase();
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
 * returns the input unchanged.
 */
export function formatJoiningCodeForDisplay(joiningCode?: string | null): string {
  if (!joiningCode || typeof joiningCode !== "string") return "";
  const clean = joiningCode.trim();
  if (JOINING_CODE_STRICT_REGEX.test(clean)) {
    return clean.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
  }
  return clean;
}

/**
 * Classifies an incoming identifier at the application boundary (e.g., URL parameters,
 * request query/body) before routing to internal services.
 *
 * Boundary entry points can inspect whether an input is a UUID, a public joining code,
 * or invalid, preventing ambiguous dual-handling deeper in the stack.
 */
export function classifyRoomIdentifier(input: unknown): ClassifiedIdentifier {
  if (typeof input !== "string" || !input.trim()) {
    return { kind: "invalid", raw: String(input ?? ""), reason: "Identifier cannot be empty" };
  }

  const trimmed = input.trim();

  if (isValidCanonicalUuid(trimmed)) {
    return { kind: "uuid", id: trimmed.toLowerCase() };
  }

  try {
    const code = normalizeJoiningCode(trimmed);
    return { kind: "joining_code", code };
  } catch (err: any) {
    return { kind: "invalid", raw: trimmed, reason: err?.message || "Invalid identifier syntax" };
  }
}

/**
 * Authoritative boundary resolution: Resolves a public joining code to the canonical room UUID.
 *
 * This resolution MUST be performed strictly at the server entry boundary (e.g. `/join/:code`).
 * Once resolved, internal services, foreign keys, and Socket.IO handlers operate solely on UUID.
 *
 * @param rawJoiningCode The user-supplied public code (with or without hyphens).
 * @param postgres The node-postgres connection pool.
 * @returns The canonical UUID of the room, or null if the room does not exist.
 */
export async function resolveJoiningCodeToRoomId(
  rawJoiningCode: unknown,
  postgres?: pg.Pool | null,
): Promise<RoomUuid | null> {
  if (!postgres) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  const normalizedCode = normalizeJoiningCode(rawJoiningCode);

  const result = await postgres.query<{ id: string }>(
    `SELECT id FROM public.rooms WHERE joining_id = $1 LIMIT 1`,
    [normalizedCode],
  );

  if (!result || result.rows.length === 0) {
    return null;
  }

  return result.rows[0].id.toLowerCase();
}
