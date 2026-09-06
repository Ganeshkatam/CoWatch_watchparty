import { hashRoomPasscode, verifyRoomPasscode, isBcryptHash } from './roomPasscode.ts';

async function runTests() {
  console.log('Running roomPasscode tests...');

  // Test 1: Empty passcodes
  const h1 = await hashRoomPasscode('');
  if (h1 !== null) throw new Error('Expected null for empty string');
  const h2 = await hashRoomPasscode(null);
  if (h2 !== null) throw new Error('Expected null for null');

  // Test 2: Valid hashing and verification
  const pass = 'superSecret123!';
  const hash = await hashRoomPasscode(pass);
  if (!hash) throw new Error('Hash was null');
  
  const isValid = await verifyRoomPasscode(pass, hash);
  if (!isValid) throw new Error('Failed to verify correct passcode');

  const isInvalid = await verifyRoomPasscode('wrongPass', hash);
  if (isInvalid) throw new Error('Incorrectly verified wrong passcode');

  // Test 3: isBcryptHash
  if (!isBcryptHash(hash)) throw new Error('Failed to recognize valid bcrypt hash');
  if (isBcryptHash('plaintext_password')) throw new Error('Incorrectly recognized plaintext as hash');

  // Test 4: Too long passcode (byte length > 72)
  const longPass = 'a'.repeat(73);
  try {
    await hashRoomPasscode(longPass);
    throw new Error('Should have thrown on >72 bytes');
  } catch (e: any) {
    if (e.message !== 'ROOM_PASSCODE_TOO_LONG') {
      throw e;
    }
  }

  // Test 5: Unicode >72 bytes
  const unicodePass = '😊'.repeat(20); // Each emoji is 4 bytes, 20 * 4 = 80 bytes
  try {
    await hashRoomPasscode(unicodePass);
    throw new Error('Should have thrown on unicode >72 bytes');
  } catch (e: any) {
    if (e.message !== 'ROOM_PASSCODE_TOO_LONG') {
      throw e;
    }
  }

  console.log('All tests passed!');
}

runTests().catch(console.error);
