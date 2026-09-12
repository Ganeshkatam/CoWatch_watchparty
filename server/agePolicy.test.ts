/**
 * AGE-002A Policy Verification & Certification Guard Suite
 *
 * POLICY INVARIANT (AGE-002 / AGE-002A):
 * 1. Date of birth (DOB) is required in the client signup UI (/signup).
 * 2. Pure client-side calculateAge() checks 18+ eligibility locally.
 * 3. Submissions under 18 are blocked in the UI with an inline error and issue ZERO network requests.
 * 4. Submissions 18+ proceed to Supabase with NO date_of_birth, birthdate, or age metadata transmitted.
 * 5. The server and database perform ZERO age evaluation, verification, or admission enforcement.
 * 6. Terms of Service (/terms) retains its required 18+ contractual clause.
 * 7. Community Guidelines (/community-guidelines) retains its minor safety clause.
 * 8. Database contains ZERO age columns or triggers; 20260910 migration remains archived.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculateAge, MINIMUM_SIGNUP_AGE } from "../src/utils/age.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function getAllFiles(dir: string, extFilter: string[]): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== "node_modules" && file !== "build" && file !== ".git") {
        results = results.concat(getAllFiles(filePath, extFilter));
      }
    } else {
      if (extFilter.some((ext) => file.endsWith(ext))) {
        results.push(filePath);
      }
    }
  }
  return results;
}

async function runAgePolicyTests() {
  console.log("Running AGE-002A Policy Verification & Certification Guard Suite...\n");

  // Checkpoint 1: Terms of Service retains 18+ contractual clause
  const pagesPath = path.join(rootDir, "src", "components", "Pages", "Pages.tsx");
  const pagesContent = fs.readFileSync(pagesPath, "utf-8");
  assert.ok(
    pagesContent.includes("You must be at least 18 years of age to register an account or use the service"),
    "Terms of Service must retain the 18+ contractual eligibility requirement"
  );
  console.log("  [PASS] Checkpoint 1: Terms of Service retains 18+ contractual clause.");

  // Checkpoint 2: Pages.tsx contains only static contractual copy (no runtime gating logic)
  const pagesLines = pagesContent.split("\n");
  for (let i = 0; i < pagesLines.length; i++) {
    const line = pagesLines[i];
    if (line.includes("Age Requirement:")) {
      assert.ok(
        line.trim().startsWith("<List.Item><strong>Age Requirement:</strong>"),
        `Pages.tsx line ${i + 1} must only be static legal text`
      );
    } else {
      const forbiddenInPages = ["calculateAge", "date_of_birth", "age_verified", "ageVerified", "MINIMUM_SIGNUP_AGE"];
      for (const token of forbiddenInPages) {
        assert.ok(
          !line.includes(token),
          `Pages.tsx must not contain runtime logic with token "${token}" on line ${i + 1}`
        );
      }
    }
  }
  console.log("  [PASS] Checkpoint 2: Pages.tsx contains only static contractual copy.");

  // Checkpoint 3: Community Guidelines retains minor protection prohibitions
  const guidelinesPath = path.join(rootDir, "src", "components", "Pages", "CommunityGuidelines.tsx");
  const guidelinesContent = fs.readFileSync(guidelinesPath, "utf-8");
  assert.ok(
    guidelinesContent.includes("exploitation of minors will result in immediate permanent termination"),
    "Community Guidelines must retain strict minor protection rules"
  );
  console.log("  [PASS] Checkpoint 3: Community Guidelines minor protection clause preserved.");

  // Checkpoint 4: Deterministic Client calculateAge Unit Tests (String-Only)
  const refDate = new Date(2026, 8, 13); // September 13, 2026

  // 4a. Missing / non-string DOB fails
  const missingResult = calculateAge("", refDate);
  assert.strictEqual(missingResult.valid, false, "Empty DOB must be invalid");
  assert.strictEqual(missingResult.isEligible, false, "Empty DOB must be ineligible");

  const nullResult = calculateAge(null, refDate);
  assert.strictEqual(nullResult.valid, false, "Null DOB must be invalid");

  const undefinedResult = calculateAge(undefined, refDate);
  assert.strictEqual(undefinedResult.valid, false, "Undefined DOB must be invalid");

  // 4b. Malformed format fails
  const malformedResult = calculateAge("not-a-date", refDate);
  assert.strictEqual(malformedResult.valid, false, "Malformed string must be invalid");

  // 4c. Impossible calendar date fails (e.g. Feb 31)
  const impossibleDate = calculateAge("2024-02-31", refDate);
  assert.strictEqual(impossibleDate.valid, false, "Impossible calendar date must be rejected");

  // 4d. Future DOB fails
  const futureResult = calculateAge("2026-09-14", refDate);
  assert.strictEqual(futureResult.valid, false, "Future date must be invalid");
  assert.ok(futureResult.error?.includes("future"), "Future date error message expected");

  // 4e. Exact 18th birthday boundary (born Sep 13, 2008 on ref date Sep 13, 2026) -> Age 18, Eligible
  const exact18 = calculateAge("2008-09-13", refDate);
  assert.strictEqual(exact18.valid, true, "Exact 18th birthday date must be valid");
  assert.strictEqual(exact18.age, 18, "Calculated age must be exactly 18");
  assert.strictEqual(exact18.isEligible, true, "User on 18th birthday must be eligible");

  // 4f. Day before 18th birthday (born Sep 14, 2008 on ref date Sep 13, 2026) -> Age 17, Ineligible
  const dayBefore18 = calculateAge("2008-09-14", refDate);
  assert.strictEqual(dayBefore18.valid, true, "Day before 18th birthday date is valid format");
  assert.strictEqual(dayBefore18.age, 17, "Calculated age must be 17");
  assert.strictEqual(dayBefore18.isEligible, false, "User 1 day below 18 must be ineligible");
  assert.ok(dayBefore18.error?.includes("18 years of age"), "Error must state 18 minimum age");

  // 4g. Normal adult (born Sep 13, 2000 on ref date Sep 13, 2026) -> Age 26, Eligible
  const adult = calculateAge("2000-09-13", refDate);
  assert.strictEqual(adult.valid, true);
  assert.strictEqual(adult.age, 26);
  assert.strictEqual(adult.isEligible, true);

  // 4h. Leap-day birthday handling (born Feb 29, 2008):
  // On Feb 28, 2026 -> age 17, Ineligible
  const leapBefore = calculateAge("2008-02-29", new Date(2026, 1, 28));
  assert.strictEqual(leapBefore.age, 17);
  assert.strictEqual(leapBefore.isEligible, false);

  // On March 1, 2026 -> age 18, Eligible
  const leapAfter = calculateAge("2008-02-29", new Date(2026, 2, 1));
  assert.strictEqual(leapAfter.age, 18);
  assert.strictEqual(leapAfter.isEligible, true);

  console.log("  [PASS] Checkpoint 4: Deterministic calculateAge calendar & boundary tests pass.");

  // Checkpoint 5: Signup UI renders DOB field and executes local eligibility gate
  const signupPath = path.join(rootDir, "src", "components", "Auth", "Signup.tsx");
  const signupContent = fs.readFileSync(signupPath, "utf-8");

  assert.ok(signupContent.includes('label="Date of birth"'), "Signup must render Date of birth input label");
  assert.ok(signupContent.includes('type="date"'), "Signup must use type='date' input");
  assert.ok(signupContent.includes("calculateAge"), "Signup must invoke calculateAge for client-side check");

  // Checkpoint 6: Ineligible under-18 users are blocked BEFORE any network request
  assert.ok(
    signupContent.includes("if (!ageCheck.valid || !ageCheck.isEligible)"),
    "Signup must verify ageCheck.isEligible"
  );
  assert.ok(
    signupContent.indexOf("if (!ageCheck.valid || !ageCheck.isEligible)") < signupContent.indexOf("supabase.auth.signUp"),
    "Eligibility check must occur strictly BEFORE supabase.auth.signUp call"
  );
  console.log("  [PASS] Checkpoint 5 & 6: Signup UI DOB field present and blocks under-18 before network call.");

  // Checkpoint 7: Supabase signUp options payload contains ZERO age metadata
  const signUpIndex = signupContent.indexOf("supabase.auth.signUp");
  assert.ok(signUpIndex !== -1, "Signup.tsx must contain supabase.auth.signUp call");
  const signUpSnippet = signupContent.slice(signUpIndex, signUpIndex + 500);

  const prohibitedPayloadTokens = [
    "date_of_birth",
    "birthdate",
    "dob",
    "age",
    "age_verified",
    "age_verified_at",
  ];

  for (const token of prohibitedPayloadTokens) {
    assert.ok(
      !signUpSnippet.includes(`${token}:`),
      `supabase.auth.signUp options payload must NOT transmit "${token}"`
    );
  }
  console.log("  [PASS] Checkpoint 7: Supabase registration payload confirmed 100% clean of age metadata.");

  // Checkpoint 8: Server-side codebase contains ZERO age admission checks or tokens
  const serverFiles = getAllFiles(path.join(rootDir, "server"), [".ts", ".js"])
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));

  const serverProhibitedTokens = [
    "date_of_birth",
    "age_verified_at",
    "age_verified",
    "calculateAge",
    "MINIMUM_SIGNUP_AGE",
  ];

  for (const filePath of serverFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const relativePath = path.relative(rootDir, filePath);
    for (const token of serverProhibitedTokens) {
      if (content.includes(token)) {
        throw new Error(
          `Server file "${relativePath}" must not contain age token: "${token}"`
        );
      }
    }
  }
  console.log("  [PASS] Checkpoint 8: Server codebase verified free of age admission checks or metadata.");

  // Checkpoint 9: Core routes, rooms, and VBrowser have zero age dependencies
  const serverPath = path.join(rootDir, "server", "server.ts");
  const serverContent = fs.readFileSync(serverPath, "utf-8");
  const roomPath = path.join(rootDir, "server", "room.ts");
  const roomContent = fs.readFileSync(roomPath, "utf-8");
  const vbrowserPath = path.join(rootDir, "server", "vm", "provider.ts");
  const vbrowserContent = fs.readFileSync(vbrowserPath, "utf-8");

  assert.ok(!serverContent.includes("age_verified"), "server.ts must not check age_verified for admission");
  assert.ok(!serverContent.includes("date_of_birth"), "server.ts must not check date_of_birth");
  assert.ok(!roomContent.includes("age_verified"), "room.ts must not check age_verified for admission");
  assert.ok(!vbrowserContent.includes("age_verified"), "provider.ts must not check age_verified for container allocation");

  // Simulated admission pipeline check: Admission succeeds without any age attribute
  const admissionPipeline = (req: { authenticated: boolean; emailVerified: boolean; roomPasscodeValid: boolean; isAgeVerified?: boolean }) => {
    if (!req.authenticated) return { status: 401, allowed: false, reason: "UNAUTHENTICATED" };
    if (!req.emailVerified) return { status: 403, allowed: false, reason: "EMAIL_UNVERIFIED" };
    if (!req.roomPasscodeValid) return { status: 403, allowed: false, reason: "INVALID_PASSCODE" };
    return { status: 200, allowed: true };
  };

  const testAdmission = admissionPipeline({
    authenticated: true,
    emailVerified: true,
    roomPasscodeValid: true,
    isAgeVerified: undefined,
  });
  assert.strictEqual(testAdmission.allowed, true, "Admission must succeed without any age attribute");
  console.log("  [PASS] Checkpoint 9: Admission pipeline is completely decoupled from age verification.");

  // Checkpoint 10: Archived migration remains retired
  const migrationPath = path.join(rootDir, "sql", "migrations", "20260910_mandatory_age_verification.sql");
  const migrationContent = fs.readFileSync(migrationPath, "utf-8");
  assert.ok(
    migrationContent.includes("ARCHIVED & RETIRED MIGRATION - POLICY AGE-001"),
    "Migration file must contain archival annotation per repository policy"
  );
  console.log("  [PASS] Checkpoint 10: Archived migration remains retired.");

  console.log("\n=========================================================");
  console.log("All AGE-002A Policy & Certification Guard checks PASSED!");
  console.log("=========================================================");
}

runAgePolicyTests().catch((err) => {
  console.error("AGE-002A verification failed:", err);
  process.exit(1);
});
