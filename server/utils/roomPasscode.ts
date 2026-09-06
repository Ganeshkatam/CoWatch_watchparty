import bcrypt from 'bcryptjs';

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
