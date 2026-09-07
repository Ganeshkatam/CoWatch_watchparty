import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import config from '../config.ts';

const ENCRYPTION_SECRET = config.SUPABASE_SECRET_KEY || config.STATS_KEY || "cowatch-room-passcode-salt-key-32b";
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

/**
 * Validates and hashes a room passcode.
 * @param passcode The plaintext passcode to hash.
 * @returns The bcrypt hash, or null if the passcode is empty.
 */
export async function hashRoomPasscode(passcode?: string | null): Promise<string | null> {
  if (!passcode || passcode.length === 0) {
    return null;
  }
  
  const byteLength = Buffer.byteLength(passcode, 'utf8');
  if (byteLength > 72) {
    throw new Error('ROOM_PASSCODE_TOO_LONG');
  }
  
  return await bcrypt.hash(passcode, 12);
}

/**
 * Verifies a plaintext passcode against a hash.
 * @param passcode The plaintext passcode provided by the user.
 * @param hash The bcrypt hash stored in the database.
 * @returns True if the passcode matches the hash.
 */
export async function verifyRoomPasscode(passcode: string, hash: string): Promise<boolean> {
  if (!passcode || !hash) {
    return false;
  }
  return await bcrypt.compare(passcode, hash);
}

/**
 * Checks if a given string looks like a bcrypt hash format we support ($2a$, $2b$).
 * @param hash The string to check.
 */
export function isBcryptHash(hash: string): boolean {
  if (!hash) return false;
  return hash.startsWith('$2a$') || hash.startsWith('$2b$');
}

/**
 * Encrypts a room passcode using AES-256-GCM so verified room owners can retrieve and view it.
 */
export function encryptPasscodeForOwner(passcode?: string | null): string | null {
  if (!passcode || passcode.length === 0) {
    return null;
  }
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(passcode, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (e) {
    console.error('Failed to encrypt room passcode for owner', e);
    return null;
  }
}

/**
 * Decrypts a room passcode previously encrypted for the room owner.
 */
export function decryptPasscodeForOwner(encryptedData?: string | null): string | null {
  if (!encryptedData || typeof encryptedData !== 'string') {
    return null;
  }
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, contentHex] = parts;
    if (!ivHex || !tagHex || !contentHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(contentHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    console.error('Failed to decrypt room passcode for owner', e);
    return null;
  }
}
