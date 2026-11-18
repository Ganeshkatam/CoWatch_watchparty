import test from "node:test";
import assert from "node:assert/strict";

// Mock window and sessionStorage for Node test environment
class MockSessionStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockSessionStorage();
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {
    sessionStorage: mockStorage,
    location: { origin: "https://cowatch.watch" },
  };
}
(globalThis as any).sessionStorage = mockStorage;

import {
  isValidCanonicalUuid,
  normalizeCanonicalUuid,
  generateCanonicalRoomUuid,
  isValidJoiningCode,
  normalizeJoiningCode,
  formatJoiningCodeForDisplay,
  classifyRoomIdentifier,
} from "./roomIdentifier.js";
import { parseRoomInput } from "./utils.js";
import { formatInvitationMessage, parseJoinRoute } from "./notificationAction.js";
import {
  saveAdmissionSession,
  loadAdmissionSession,
  clearAdmissionSession,
} from "./roomAdmissionSession.js";

test("Phase 5 Frontend Identity Migration Test Suite", async (t) => {
  await t.test("1. Client Room Identifier Utilities", async (t2) => {
    await t2.test("isValidCanonicalUuid & normalizeCanonicalUuid", () => {
      const validUuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const upperUuid = "A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D";
      const invalidShort = "a1b2c3d4-e5f6-4a7b-8c9d";
      const nonHex = "g1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

      assert.equal(isValidCanonicalUuid(validUuid), true);
      assert.equal(isValidCanonicalUuid(upperUuid), true);
      assert.equal(isValidCanonicalUuid(invalidShort), false);
      assert.equal(isValidCanonicalUuid(nonHex), false);
      assert.equal(isValidCanonicalUuid(""), false);
      assert.equal(isValidCanonicalUuid(null), false);

      assert.equal(normalizeCanonicalUuid(upperUuid), validUuid);
      assert.equal(normalizeCanonicalUuid(`  ${validUuid}  `), validUuid);
      assert.throws(() => normalizeCanonicalUuid("invalid-uuid"), /INVALID_CANONICAL_UUID/);
    });

    await t2.test("generateCanonicalRoomUuid produces canonical UUID", () => {
      const generated = generateCanonicalRoomUuid();
      assert.equal(isValidCanonicalUuid(generated), true);
      assert.equal(generated, generated.toLowerCase());
      assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    await t2.test("isValidJoiningCode & normalizeJoiningCode preserves leading zeroes", () => {
      const validCode = "0123456789";
      const formattedCode = "012-345-6789";
      const spacedCode = "012 345 6789";

      assert.equal(isValidJoiningCode(validCode), true);
      assert.equal(isValidJoiningCode(formattedCode), true);
      assert.equal(isValidJoiningCode(spacedCode), true);
      assert.equal(isValidJoiningCode("123456789"), false); // 9 digits
      assert.equal(isValidJoiningCode("12345678901"), false); // 11 digits

      assert.equal(normalizeJoiningCode(validCode), "0123456789");
      assert.equal(normalizeJoiningCode(formattedCode), "0123456789");
      assert.equal(normalizeJoiningCode(spacedCode), "0123456789");
      assert.throws(() => normalizeJoiningCode("abc-1234567890"), /INVALID_JOINING_CODE/);
      assert.throws(() => normalizeJoiningCode("123"), /INVALID_JOINING_CODE/);
    });

    await t2.test("formatJoiningCodeForDisplay produces ###-###-####", () => {
      assert.equal(formatJoiningCodeForDisplay("0123456789"), "012-345-6789");
      assert.equal(formatJoiningCodeForDisplay("9876543210"), "987-654-3210");
      assert.equal(formatJoiningCodeForDisplay("012-345-6789"), "012-345-6789");
      assert.equal(formatJoiningCodeForDisplay("invalid"), "invalid");
    });

    await t2.test("classifyRoomIdentifier classifies UUID, code, and moniker", () => {
      assert.deepEqual(classifyRoomIdentifier("b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d"), {
        kind: "uuid",
        id: "b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
      });
      assert.deepEqual(classifyRoomIdentifier("0123456789"), {
        kind: "joining_code",
        code: "0123456789",
      });
      assert.deepEqual(classifyRoomIdentifier("012-345-6789"), {
        kind: "joining_code",
        code: "0123456789",
      });
      assert.deepEqual(classifyRoomIdentifier("movie-party-room"), {
        kind: "legacy_moniker",
        moniker: "movie-party-room",
      });
      assert.equal(classifyRoomIdentifier("   ").kind, "invalid");
    });
  });

  await t.test("2. Room Input Parsing (parseRoomInput)", async (t2) => {
    await t2.test("Parses raw and formatted inputs correctly", () => {
      const canonicalUuid = "b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
      assert.equal(parseRoomInput(canonicalUuid), canonicalUuid);

      // Raw 10-digit code
      assert.equal(parseRoomInput("0123456789"), "0123456789");

      // Formatted 10-digit code with hyphens
      assert.equal(parseRoomInput("012-345-6789"), "0123456789");

      // Alphanumeric legacy moniker
      assert.equal(parseRoomInput("friday-night-chill"), "friday-night-chill");

      // Full URL with canonical UUID
      assert.equal(
        parseRoomInput(`https://cowatch.watch/watch/${canonicalUuid}?panel=chat`),
        canonicalUuid
      );

      // Full URL with 10-digit joining code
      assert.equal(
        parseRoomInput("https://cowatch.watch/join/0123456789"),
        "0123456789"
      );

      // Full URL with legacy moniker
      assert.equal(
        parseRoomInput("https://cowatch.watch/join/classic-party"),
        "classic-party"
      );
    });
  });

  await t.test("3. Invitation & Message Generation", async (t2) => {
    await t2.test("formatInvitationMessage formats with joiningCode display", () => {
      const msg = formatInvitationMessage({
        roomId: "b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
        joiningCode: "0123456789",
        passcode: "secret-pass",
        invitationUrl: "https://cowatch.watch/join/0123456789",
        roomTitle: "Friday Watch Party",
      });

      assert.ok(msg.includes("Join: https://cowatch.watch/join/0123456789"));
      assert.ok(msg.includes("Room Code: 012-345-6789"));
      assert.ok(msg.includes("Passcode: secret-pass"));
    });

    await t2.test("formatInvitationMessage fallback without joiningCode", () => {
      const msg = formatInvitationMessage({
        roomId: "classic-room",
        passcode: "open-pass",
        invitationUrl: "https://cowatch.watch/join/classic-room",
      });

      assert.ok(msg.includes("Join: https://cowatch.watch/join/classic-room"));
      assert.ok(msg.includes("Room ID: classic-room"));
      assert.ok(msg.includes("Passcode: open-pass"));
    });

    await t2.test("parseJoinRoute identifies joining code route", () => {
      const parsedCodeRoute = parseJoinRoute("/join/0123456789");
      assert.equal(parsedCodeRoute.type, "join");
      assert.equal(parsedCodeRoute.identifier, "0123456789");
      assert.equal(parsedCodeRoute.path, "/join/0123456789");

      const parsedUuidRoute = parseJoinRoute("/join/b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d");
      assert.equal(parsedUuidRoute.type, "join");
      assert.equal(parsedUuidRoute.identifier, "b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d");
      assert.equal(parsedUuidRoute.path, "/join/b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d");
    });
  });

  await t.test("4. Multi-Key Tab-Scoped Admission Session Storage", async (t2) => {
    const canonicalUuid = "b4a1c5d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
    const joiningCode = "0123456789";
    const legacyMoniker = "retro-watch";
    const token = "admission-jwt-token-alpha";
    const sessionId = "session-id-alpha";

    await t2.test("saveAdmissionSession stores across canonical UUID and aliases", () => {
      // User entered via legacy moniker, received canonical UUID and joining code
      saveAdmissionSession(canonicalUuid, token, sessionId, [legacyMoniker, joiningCode]);

      // Can be loaded via canonical UUID
      const loadedByUuid = loadAdmissionSession(canonicalUuid);
      assert.ok(loadedByUuid);
      assert.equal(loadedByUuid?.admissionToken, token);
      assert.equal(loadedByUuid?.sessionId, sessionId);

      // Can be loaded via legacy moniker fallback
      const loadedByMoniker = loadAdmissionSession(legacyMoniker);
      assert.ok(loadedByMoniker);
      assert.equal(loadedByMoniker?.admissionToken, token);
      assert.equal(loadedByMoniker?.sessionId, sessionId);

      // Can be loaded via joining code fallback
      const loadedByCode = loadAdmissionSession(joiningCode);
      assert.ok(loadedByCode);
      assert.equal(loadedByCode?.admissionToken, token);
      assert.equal(loadedByCode?.sessionId, sessionId);
    });

    await t2.test("clearAdmissionSession clears canonical and all aliases", () => {
      clearAdmissionSession(canonicalUuid, [legacyMoniker, joiningCode]);

      assert.equal(loadAdmissionSession(canonicalUuid), null);
      assert.equal(loadAdmissionSession(legacyMoniker), null);
      assert.equal(loadAdmissionSession(joiningCode), null);
    });
  });
});
