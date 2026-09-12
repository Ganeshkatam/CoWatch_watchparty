/**
 * NOTIFY-002 Provider Leakage & Boundary Enforcement Test
 *
 * Ensures that core business logic and worker modules have zero direct imports
 * of specific email provider adapters or transport libraries.
 */

import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[BoundaryLeakageAssertion] ${message}`);
  }
}

const FORBIDDEN_IMPORTS = [
  'nodemailer',
  '@resend',
  'BrevoEmailProvider',
  'ResendEmailProvider',
  'SMTPEmailProvider',
  'ResendProvider',
];

const PROTECTED_CORE_FILES = [
  'server/notifications/notificationService.ts',
  'server/notifications/emailWorker.ts',
  'server/notifications/notificationRepository.ts',
  'server/notifications/notificationPolicy.ts',
  'server/notifications/deliveryStateService.ts',
];

async function runProviderLeakageTest(): Promise<void> {
  console.log('=== NOTIFY-002 Provider Leakage & Architectural Boundary Test ===\n');

  for (const relativePath of PROTECTED_CORE_FILES) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Protected file does not exist: ${relativePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    for (const forbidden of FORBIDDEN_IMPORTS) {
      // Exclude comments that merely mention the name
      const importRegex = new RegExp(`import.*['"].*${forbidden}.*['"]`, 'i');
      const hasLeak = importRegex.test(content);

      assert(
        !hasLeak,
        `Architectural violation in ${relativePath}: direct import of "${forbidden}" is forbidden in core domain/worker modules.`,
      );
    }

    console.log(`  PASS: ${relativePath} has zero provider adapter leaks`);
  }

  console.log('\nAll architectural boundary and leakage checks passed successfully!\n');
}

runProviderLeakageTest().catch((err) => {
  console.error('Provider leakage test failure:', err);
  process.exit(1);
});
