/**
 * NOTIFY-001A Deliverability Suppression Utilities
 *
 * Implements SHA-256 cryptographic normalization of email addresses.
 * The raw email address is NEVER stored in the suppression table.
 */

import crypto from 'node:crypto';

/**
 * Normalizes an email address for consistent hashing:
 * Trims leading/trailing whitespace and converts to lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Computes deterministic SHA-256 hex digest from an email address.
 * Primary key for public.email_delivery_suppressions.
 */
export function computeEmailHash(email: string): string {
  const normalized = normalizeEmail(email);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}
