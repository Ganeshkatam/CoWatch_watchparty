/**
 * Zero Client Database Invariant Enforcement Test (AUD-010 / Phase F)
 *
 * Verifies that the client application (src/) has ZERO direct database access via PostgREST.
 * All data access must pass through authoritative CoWatch server REST / Socket.IO APIs.
 *
 * Architectural Invariant:
 * - Forbidden: supabase.from(...), supabase.rpc(...), supabase.schema(...)
 * - Forbidden: Direct table queries on 'profiles', 'rooms', 'announcements'
 * - Permitted on frontend: supabase.auth (identity/session tokens only)
 * - Permitted on frontend: supabase.storage (binary uploads only)
 */

import fs from "node:fs";
import path from "node:path";

interface Violation {
  file: string;
  line: number;
  content: string;
  rule: string;
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  {
    pattern: /supabase\s*\.\s*from\s*\(/,
    rule: "Direct Supabase database query (supabase.from) is strictly forbidden in client application code.",
  },
  {
    pattern: /supabase\s*\.\s*rpc\s*\(/,
    rule: "Direct Supabase RPC execution (supabase.rpc) is strictly forbidden in client application code.",
  },
  {
    pattern: /supabase\s*\.\s*schema\s*\(/,
    rule: "Direct Supabase schema switching (supabase.schema) is strictly forbidden in client application code.",
  },
  {
    pattern: /\.from\s*\(\s*["'](?:profiles|rooms|announcements|user_roles|subscriptions|audit_logs)["']\s*\)/,
    rule: "Direct database table reference via .from('table') is strictly forbidden in client application code.",
  },
];

function scanDirectory(dir: string, violations: Violation[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      scanDirectory(fullPath, violations);
    } else if (entry.isFile()) {
      // Only scan ts, tsx, js, jsx files in src/
      if (!/\.(tsx?|jsx?)$/.test(entry.name)) {
        continue;
      }
      // Exclude test files from self-scanning
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx") || entry.name.endsWith(".spec.ts")) {
        continue;
      }

      const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, "/");
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i];

        for (const { pattern, rule } of FORBIDDEN_PATTERNS) {
          if (pattern.test(lineContent)) {
            violations.push({
              file: relativePath,
              line: i + 1,
              content: lineContent.trim(),
              rule,
            });
          }
        }
      }
    }
  }
}

export function runZeroClientDatabaseAudit(): { passed: boolean; violations: Violation[] } {
  const srcDir = path.resolve(process.cwd(), "src");
  const violations: Violation[] = [];

  scanDirectory(srcDir, violations);

  return {
    passed: violations.length === 0,
    violations,
  };
}

import { supabase } from "./supabaseClient";
import assert from "node:assert";

// CLI test runner
console.log("=== Zero Client Database Invariant Certification ===");

// 1. Static Scan Verification
const result = runZeroClientDatabaseAudit();

if (!result.passed) {
  console.error("FAIL: Zero Client Database Invariant Violations Detected!");
  for (const v of result.violations) {
    console.error(`  [${v.file}:${v.line}] ${v.rule}`);
    console.error(`    > ${v.content}\n`);
  }
  process.exit(1);
} else {
  console.log("PASS [Static Audit]: Zero PostgREST database calls detected across client source (src/)");
}

// 2. Runtime Proxy Boundary Verification
console.log("\nTesting runtime client database boundary guard...");

// Verify supabase.from throws hard error
let fromThrew = false;
try {
  (supabase as any).from("profiles");
} catch (e: any) {
  if (e.message.includes("CLIENT_DATABASE_ACCESS_FORBIDDEN")) {
    fromThrew = true;
  }
}
assert.strictEqual(fromThrew, true, "supabase.from() must throw CLIENT_DATABASE_ACCESS_FORBIDDEN");
console.log("PASS [Runtime Guard 1]: supabase.from('profiles') strictly blocked by runtime proxy");

// Verify supabase.rpc throws hard error
let rpcThrew = false;
try {
  (supabase as any).rpc("get_user");
} catch (e: any) {
  if (e.message.includes("CLIENT_DATABASE_ACCESS_FORBIDDEN")) {
    rpcThrew = true;
  }
}
assert.strictEqual(rpcThrew, true, "supabase.rpc() must throw CLIENT_DATABASE_ACCESS_FORBIDDEN");
console.log("PASS [Runtime Guard 2]: supabase.rpc(...) strictly blocked by runtime proxy");

// Verify supabase.schema throws hard error
let schemaThrew = false;
try {
  (supabase as any).schema("public");
} catch (e: any) {
  if (e.message.includes("CLIENT_DATABASE_ACCESS_FORBIDDEN")) {
    schemaThrew = true;
  }
}
assert.strictEqual(schemaThrew, true, "supabase.schema() must throw CLIENT_DATABASE_ACCESS_FORBIDDEN");
console.log("PASS [Runtime Guard 3]: supabase.schema(...) strictly blocked by runtime proxy");

// Verify permitted channels are untouched
assert.ok(supabase.auth, "supabase.auth must remain accessible for session tokens");
assert.ok(supabase.storage, "supabase.storage must remain accessible for file uploads");
console.log("PASS [Permitted Channels]: supabase.auth and supabase.storage accessible without DB leakage");

console.log("\nALL ZERO CLIENT DATABASE INVARIANT TESTS PASSED WITH ZERO FAILURES.\n");
process.exit(0);
