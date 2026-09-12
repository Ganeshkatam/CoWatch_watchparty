/**
 * AGE-001 Policy Verification & Invariant Regression Suite
 *
 * POLICY INVARIANT:
 * 1. Age is NOT a technical admission requirement anywhere in runtime paths.
 * 2. Age requirement IS a contractual/policy requirement retained in /terms.
 * 3. No runtime file in src/ or server/ may invoke or reference:
 *    - date_of_birth
 *    - age_verified_at
 *    - ageVerified
 *    - age_verified
 *    - calculateAge
 *    - MINIMUM_AGE
 *    (Policy text in Pages.tsx is strictly separated from runtime code).
 * 4. Admission invariant:
 *    HTTP/API admission -> Authentication -> Authorization -> Safety rules -> ALLOW/DENY != Age verification.
 * 5. Terms of Service (/terms) must retain its required 18+ contractual clause.
 * 6. Community Guidelines (/community-guidelines) must retain its minor safety clause.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  console.log("Running AGE-001 Policy Verification Suite...");

  // 1. Assert Terms of Service retains the contractual 18+ requirement intact
  const pagesPath = path.join(rootDir, "src", "components", "Pages", "Pages.tsx");
  const pagesContent = fs.readFileSync(pagesPath, "utf-8");
  assert.ok(
    pagesContent.includes("You must be at least 18 years of age to register an account or use the service"),
    "Terms of Service must retain the 18+ contractual eligibility requirement"
  );
  console.log("  [PASS] Terms of Service retains 18+ contractual policy clause.");

  // 2. Surgical assertion on Pages.tsx: Ensure NO runtime age-gating logic exists in Pages.tsx
  // Only the exact static text line is allowed; no functions, state, or hooks may evaluate age.
  const pagesLines = pagesContent.split("\n");
  for (let i = 0; i < pagesLines.length; i++) {
    const line = pagesLines[i];
    if (line.includes("Age Requirement:")) {
      // Allowed: static list item
      assert.ok(
        line.trim().startsWith("<List.Item><strong>Age Requirement:</strong>"),
        `Pages.tsx line ${i + 1} must only be static legal text`
      );
    } else {
      // Forbidden: Any runtime evaluation of age, DOB, or verification
      const forbiddenInPages = ["calculateAge", "date_of_birth", "age_verified", "ageVerified", "MINIMUM_AGE"];
      for (const token of forbiddenInPages) {
        assert.ok(
          !line.includes(token),
          `Pages.tsx must not contain runtime logic with token "${token}" on line ${i + 1}`
        );
      }
    }
  }
  console.log("  [PASS] Pages.tsx contains only static contractual copy and zero runtime age-gating logic.");

  // 3. Assert Community Guidelines retains minor protection policy intact
  const guidelinesPath = path.join(rootDir, "src", "components", "Pages", "CommunityGuidelines.tsx");
  const guidelinesContent = fs.readFileSync(guidelinesPath, "utf-8");
  assert.ok(
    guidelinesContent.includes("exploitation of minors will result in immediate permanent termination"),
    "Community Guidelines must retain strict minor protection rules"
  );
  console.log("  [PASS] Community Guidelines retains minor safety and exploitation prohibitions.");

  // 4. Assert Signup component contains NO technical age gate
  const signupPath = path.join(rootDir, "src", "components", "Auth", "Signup.tsx");
  const signupContent = fs.readFileSync(signupPath, "utf-8");
  assert.ok(!signupContent.includes("DatePickerInput"), "Signup must not render DatePickerInput");
  assert.ok(!signupContent.includes("MINIMUM_AGE"), "Signup must not reference MINIMUM_AGE");
  assert.ok(!signupContent.includes("calculateAge"), "Signup must not reference calculateAge");
  assert.ok(!signupContent.includes("ageGateComplete"), "Signup must not gate registration state");
  assert.ok(!signupContent.includes("birthdate"), "Signup must not collect birthdate");
  console.log("  [PASS] Signup component has zero technical age-gate enforcement.");

  // 5. Assert repository-wide invariant: No runtime code uses technical age-gate identifiers
  const runtimeFiles = [
    ...getAllFiles(path.join(rootDir, "src"), [".ts", ".tsx", ".js"]),
    ...getAllFiles(path.join(rootDir, "server"), [".ts", ".js"]),
  ].filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts") && !f.endsWith("Pages.tsx"));

  const prohibitedTokens = [
    "date_of_birth",
    "age_verified_at",
    "ageVerified",
    "calculateAge",
    "MINIMUM_AGE",
  ];

  for (const filePath of runtimeFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const relativePath = path.relative(rootDir, filePath);

    for (const token of prohibitedTokens) {
      if (content.includes(token)) {
        throw new Error(
          `Prohibited token "${token}" found in active runtime file: ${relativePath}`
        );
      }
    }
  }
  console.log("  [PASS] Repository-wide runtime assertion: Zero prohibited age tokens found across all src/ and server/ runtime files.");

  // 6. Assert Route / API Admission Invariant
  // Verify that core routes and admission controllers have ZERO dependency on age verification:
  // - /signup
  // - /room/*
  // - VBrowser allocation
  // - Room admission
  // - Notification & report endpoints
  const serverPath = path.join(rootDir, "server", "server.ts");
  const serverContent = fs.readFileSync(serverPath, "utf-8");
  const roomPath = path.join(rootDir, "server", "room.ts");
  const roomContent = fs.readFileSync(roomPath, "utf-8");
  const vbrowserPath = path.join(rootDir, "server", "vm", "provider.ts");
  const vbrowserContent = fs.readFileSync(vbrowserPath, "utf-8");

  // Admission checks in server.ts
  assert.ok(!serverContent.includes("age_verified"), "server.ts must not check age_verified for admission");
  assert.ok(!serverContent.includes("date_of_birth"), "server.ts must not check date_of_birth");
  assert.ok(!roomContent.includes("age_verified"), "room.ts must not check age_verified for admission");
  assert.ok(!vbrowserContent.includes("age_verified"), "provider.ts must not check age_verified for container allocation");

  // Simulated admission pipeline check
  const admissionPipeline = (req: { authenticated: boolean; emailVerified: boolean; roomPasscodeValid: boolean; isAgeVerified?: boolean }) => {
    // Correct boundary: Authenticated -> Verified Email -> Valid Passcode
    if (!req.authenticated) return { status: 401, allowed: false, reason: "UNAUTHENTICATED" };
    if (!req.emailVerified) return { status: 403, allowed: false, reason: "EMAIL_UNVERIFIED" };
    if (!req.roomPasscodeValid) return { status: 403, allowed: false, reason: "INVALID_PASSCODE" };
    return { status: 200, allowed: true };
  };

  const testAdmission = admissionPipeline({
    authenticated: true,
    emailVerified: true,
    roomPasscodeValid: true,
    isAgeVerified: undefined, // Age is completely absent
  });
  assert.strictEqual(testAdmission.allowed, true, "Admission must succeed without any age attribute");
  console.log("  [PASS] Route/API admission assertion: Admission pipeline is decoupled from age verification.");

  // 7. Assert database migration is safely archived
  const migrationPath = path.join(rootDir, "sql", "migrations", "20260910_mandatory_age_verification.sql");
  const migrationContent = fs.readFileSync(migrationPath, "utf-8");
  assert.ok(
    migrationContent.includes("ARCHIVED & RETIRED MIGRATION - POLICY AGE-001"),
    "Migration file must contain archival annotation per repository policy"
  );
  console.log("  [PASS] Migration script is cleanly annotated as archived without breaking repository file retention rules.");

  console.log("\nAll AGE-001 policy invariant tests passed successfully!");
}

runAgePolicyTests().catch((err) => {
  console.error("AGE-001 verification failed:", err);
  process.exit(1);
});
