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

// CLI test runner
const result = runZeroClientDatabaseAudit();

if (!result.passed) {
  console.error("FAIL: Zero Client Database Invariant Violations Detected!");
  for (const v of result.violations) {
    console.error(`  [${v.file}:${v.line}] ${v.rule}`);
    console.error(`    > ${v.content}\n`);
  }
  process.exit(1);
} else {
  console.log("PASS: Zero Client Database Invariant Verified (0 direct DB calls found across src/)");
  process.exit(0);
}
