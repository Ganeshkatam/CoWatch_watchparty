import assert from "node:assert/strict";
import {
  isValidCanonicalUuid,
  normalizeCanonicalUuid,
  generateCanonicalRoomUuid,
  normalizeJoiningCode,
  isValidJoiningCode,
  formatJoiningCodeForDisplay,
  classifyRoomIdentifier,
  resolveJoiningCodeToRoomId,
} from "./roomIdentifier.ts";

async function runTests() {
  console.log("========================================================================");
  console.log("STARTING ROOM IDENTIFIER & PUBLIC JOINING CONTRACT TEST SUITE");
  console.log("========================================================================");

  // --------------------------------------------------------------------------
  // 1. CANONICAL UUID SYNTAX & NORMALIZATION
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 1: Canonical UUID Validation & Normalization ---");

  // Valid canonical UUID v4
  const v4 = "5f1bd3fb-a1eb-4a8a-8dce-392d590bd587";
  assert.equal(isValidCanonicalUuid(v4), true, "Standard UUID v4 should be valid");
  assert.equal(normalizeCanonicalUuid(v4), v4, "Normalized v4 should match");

  // Valid canonical UUID uppercase
  const upper = "5F1BD3FB-A1EB-4A8A-8DCE-392D590BD587";
  assert.equal(isValidCanonicalUuid(upper), true, "Uppercase UUID should be valid");
  assert.equal(normalizeCanonicalUuid(upper), v4, "Uppercase UUID should normalize to lowercase");

  // Other valid canonical UUID versions (e.g. nil UUID, v1, v5) supported by PostgreSQL
  const nilUuid = "00000000-0000-0000-0000-000000000000";
  assert.equal(isValidCanonicalUuid(nilUuid), true, "Nil UUID should be valid in PostgreSQL");

  const v1Uuid = "216fff40-98d9-11e3-a5e2-0800200c9a66";
  assert.equal(isValidCanonicalUuid(v1Uuid), true, "UUID v1 should be valid syntax");

  // Generator produces valid canonical UUID
  const generated = generateCanonicalRoomUuid();
  assert.equal(isValidCanonicalUuid(generated), true, "Generated UUID must be valid");
  assert.equal(generated, generated.toLowerCase(), "Generated UUID must be lowercase");

  // Invalid UUIDs
  assert.equal(isValidCanonicalUuid(""), false, "Empty string is not a UUID");
  assert.equal(isValidCanonicalUuid(null), false, "Null is not a UUID");
  assert.equal(isValidCanonicalUuid(undefined), false, "Undefined is not a UUID");
  assert.equal(isValidCanonicalUuid(12345), false, "Number is not a UUID");
  assert.equal(isValidCanonicalUuid("not-a-uuid"), false, "Plain text moniker is not a UUID");
  assert.equal(isValidCanonicalUuid("idiotic-authority-detail"), false, "Moniker is not a UUID");
  assert.equal(isValidCanonicalUuid("5f1bd3fb-a1eb-4a8a-8dce-392d590bd58"), false, "Short UUID (35 chars) is invalid");
  assert.equal(isValidCanonicalUuid("5f1bd3fb-a1eb-4a8a-8dce-392d590bd587a"), false, "Long UUID (37 chars) is invalid");
  assert.equal(isValidCanonicalUuid("5f1bd3fb_a1eb_4a8a_8dce_392d590bd587"), false, "Underscore UUID is invalid");
  assert.equal(isValidCanonicalUuid("5f1bd3fba1eb4a8a8dce392d590bd587"), false, "Un-hyphenated hex string is invalid");
  assert.equal(isValidCanonicalUuid("zzzzzzzz-a1eb-4a8a-8dce-392d590bd587"), false, "Non-hex characters are invalid");

  assert.throws(() => normalizeCanonicalUuid("invalid"), /INVALID_CANONICAL_UUID/);
  console.log("  ✔ [PASS] 1.1 Valid and invalid canonical UUID syntax verified");

  // --------------------------------------------------------------------------
  // 2. PUBLIC JOINING CODE NORMALIZATION & PRESERVATION OF LEADING ZEROES
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 2: Public Joining Code Contract & Normalization ---");

  // Clean 10 digits
  const standardCode = "2591753574";
  assert.equal(normalizeJoiningCode(standardCode), "2591753574");
  assert.equal(isValidJoiningCode(standardCode), true);

  // Critical requirement: Leading zeroes preserved
  const codeWithLeadingZero = "0710749246";
  assert.equal(normalizeJoiningCode(codeWithLeadingZero), "0710749246", "Leading zero must be strictly preserved");
  assert.equal(normalizeJoiningCode("0012345678"), "0012345678", "Multiple leading zeros must be preserved");

  // Separator stripping: spaces, hyphens, dots, underscores
  assert.equal(normalizeJoiningCode("071-074-9246"), "0710749246", "Hyphens should be stripped");
  assert.equal(normalizeJoiningCode("071 074 9246"), "0710749246", "Spaces should be stripped");
  assert.equal(normalizeJoiningCode(" 071-074-9246  "), "0710749246", "Trimming with hyphens should work");
  assert.equal(normalizeJoiningCode("071.074.9246"), "0710749246", "Dots should be stripped");
  assert.equal(normalizeJoiningCode("071_074_9246"), "0710749246", "Underscores should be stripped");
  assert.equal(normalizeJoiningCode("071 - 074 - 9246"), "0710749246", "Mixed spaces and hyphens stripped");

  // Invalid joining codes
  assert.equal(isValidJoiningCode(""), false, "Empty string is invalid");
  assert.equal(isValidJoiningCode(null), false, "Null is invalid");
  assert.equal(isValidJoiningCode(undefined), false, "Undefined is invalid");
  assert.equal(isValidJoiningCode("123456789"), false, "9 digits is invalid");
  assert.equal(isValidJoiningCode("12345678901"), false, "11 digits is invalid");
  assert.equal(isValidJoiningCode("12345abcde"), false, "Alphanumeric code is invalid");
  assert.equal(isValidJoiningCode("071-074-924A"), false, "Code with letters is invalid");
  assert.equal(isValidJoiningCode("!@#$%^&*()"), false, "Special characters are invalid");

  assert.throws(() => normalizeJoiningCode("12345"), /INVALID_JOINING_CODE/);
  console.log("  ✔ [PASS] 2.1 10-digit normalization, separator stripping, and leading zeros verified");

  // --------------------------------------------------------------------------
  // 3. PRESENTATION-ONLY FORMATTING
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 3: Presentation Formatting ---");

  assert.equal(formatJoiningCodeForDisplay("2591753574"), "259-175-3574");
  assert.equal(formatJoiningCodeForDisplay("0710749246"), "071-074-9246", "Preserves leading zero when formatted");
  assert.equal(formatJoiningCodeForDisplay("0012345678"), "001-234-5678", "Preserves multiple leading zeros");
  assert.equal(formatJoiningCodeForDisplay(""), "");
  assert.equal(formatJoiningCodeForDisplay(null), "");
  assert.equal(formatJoiningCodeForDisplay(undefined), "");
  assert.equal(formatJoiningCodeForDisplay("short"), "short", "Malformed input left as-is");
  console.log("  ✔ [PASS] 3.1 Presentation grouping (###-###-####) verified");

  // --------------------------------------------------------------------------
  // 4. BOUNDARY IDENTIFIER CLASSIFICATION
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 4: Boundary Identifier Classification ---");

  const c1 = classifyRoomIdentifier("5f1bd3fb-a1eb-4a8a-8dce-392d590bd587");
  assert.equal(c1.kind, "uuid");
  if (c1.kind === "uuid") {
    assert.equal(c1.id, "5f1bd3fb-a1eb-4a8a-8dce-392d590bd587");
  }

  const c2 = classifyRoomIdentifier("071-074-9246");
  assert.equal(c2.kind, "joining_code");
  if (c2.kind === "joining_code") {
    assert.equal(c2.code, "0710749246");
  }

  const c3 = classifyRoomIdentifier("invalid-random-string");
  assert.equal(c3.kind, "invalid");

  const c4 = classifyRoomIdentifier("");
  assert.equal(c4.kind, "invalid");
  console.log("  ✔ [PASS] 4.1 Boundary classification accurately distinguishes UUID vs joining_code vs invalid");

  // --------------------------------------------------------------------------
  // 5. AUTHORITATIVE JOINING CODE RESOLUTION
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 5: Authoritative Boundary Resolution ---");

  // Mock PostgreSQL Pool
  const mockPostgres = {
    query: async (sql: string, params: any[]) => {
      assert.equal(sql.includes("WHERE joining_id = $1"), true);
      const code = params[0];
      if (code === "2591753574") {
        return { rows: [{ id: "5f1bd3fb-a1eb-4a8a-8dce-392d590bd587" }] };
      }
      if (code === "0710749246") {
        return { rows: [{ id: "165e7e2c-ae98-4c2d-a7c4-2504670630bd" }] };
      }
      return { rows: [] };
    },
  };

  const resolved1 = await resolveJoiningCodeToRoomId("259-175-3574", mockPostgres as any);
  assert.equal(resolved1, "5f1bd3fb-a1eb-4a8a-8dce-392d590bd587", "Resolved formatted code to UUID");

  const resolved2 = await resolveJoiningCodeToRoomId("071.074.9246", mockPostgres as any);
  assert.equal(resolved2, "165e7e2c-ae98-4c2d-a7c4-2504670630bd", "Resolved dotted code with leading zero to UUID");

  const nonExistent = await resolveJoiningCodeToRoomId("9999999999", mockPostgres as any);
  assert.equal(nonExistent, null, "Non-existent code returns null");

  // Rejection of invalid syntax before DB query
  await assert.rejects(
    async () => await resolveJoiningCodeToRoomId("invalid-code", mockPostgres as any),
    /INVALID_JOINING_CODE/,
  );

  // Missing database pool
  await assert.rejects(
    async () => await resolveJoiningCodeToRoomId("2591753574", null),
    /DATABASE_UNAVAILABLE/,
  );

  console.log("  ✔ [PASS] 5.1 Authoritative DB lookup and boundary error handling verified");

  console.log("\n========================================================================");
  console.log("ALL ROOM IDENTIFIER TESTS COMPLETED SUCCESSFULLY");
  console.log("========================================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
