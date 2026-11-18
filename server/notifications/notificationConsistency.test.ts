/**
 * NOTIFY-001 Consistency CI Test
 *
 * Verifies the mandatory invariants:
 *   1. DB Canonical types == Server TS types == Template registry
 *   2. EMAIL_ELIGIBLE_TYPES strictly matches registered email templates
 *   3. Notification delivery policy obeys registry eligibility and user preferences
 *   4. All email templates render non-empty HTML, text, and subject
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  NOTIFICATION_TYPES,
  EMAIL_ELIGIBLE_TYPES,
  type NotificationType,
  type EmailEligibleType,
} from './notificationTypes.ts';
import {
  EMAIL_TEMPLATES,
  REGISTERED_TEMPLATE_KEYS,
  renderEmailTemplate,
} from './emailTemplates.ts';
import { evaluateDelivery } from './notificationPolicy.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ConsistencyTest] Assertion Failed: ${message}`);
  }
}

async function runConsistencyTests() {
  console.log('=== NOTIFY-001 Consistency CI Test Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Verify SQL migration catalog matches TypeScript types
  // ---------------------------------------------------------------------------
  console.log('Case 1: Parsing SQL migration for canonical types...');
  const migrationPath = path.resolve(
    process.cwd(),
    'sql/migrations/20260912_notify_001_notifications.sql',
  );
  assert(fs.existsSync(migrationPath), `Migration file exists at ${migrationPath}`);

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Extract seeded types from notification_type_registry
  // Pattern: ('TYPE', 'Description', email_eligible, in_app_eligible, 'category')
  const seedRegex = /\('([A-Z_]+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*'([a-z]+)'\)/g;
  const dbTypes = new Map<string, { emailEligible: boolean; category: string }>();

  let match: RegExpExecArray | null;
  while ((match = seedRegex.exec(migrationSql)) !== null) {
    dbTypes.set(match[1], {
      emailEligible: match[3] === 'true',
      category: match[5],
    });
  }

  assert(dbTypes.size > 0, 'Found seeded types in notification_type_registry migration');

  // Verify DB canonical types == TS types
  const tsTypeSet = new Set<string>(NOTIFICATION_TYPES);
  for (const dbType of dbTypes.keys()) {
    assert(tsTypeSet.has(dbType), `DB type "${dbType}" must be defined in TypeScript NOTIFICATION_TYPES`);
  }
  for (const tsType of tsTypeSet) {
    assert(dbTypes.has(tsType), `TypeScript type "${tsType}" must exist in DB notification_type_registry`);
  }
  console.log(`  PASSED: ${dbTypes.size} canonical types match between DB migration and TS enum`);

  // ---------------------------------------------------------------------------
  // 2. Verify Email Eligibility consistency
  // ---------------------------------------------------------------------------
  console.log('Case 2: Checking email-eligibility invariants...');
  const dbEmailEligibleTypes = new Set(
    Array.from(dbTypes.entries())
      .filter(([_, meta]) => meta.emailEligible)
      .map(([type]) => type),
  );

  assert(
    dbEmailEligibleTypes.size === EMAIL_ELIGIBLE_TYPES.size,
    `Email eligible count mismatch: DB has ${dbEmailEligibleTypes.size}, TS has ${EMAIL_ELIGIBLE_TYPES.size}`,
  );

  for (const type of dbEmailEligibleTypes) {
    assert(
      EMAIL_ELIGIBLE_TYPES.has(type as EmailEligibleType),
      `DB email-eligible type "${type}" must be present in EMAIL_ELIGIBLE_TYPES`,
    );
  }
  console.log(`  PASSED: EMAIL_ELIGIBLE_TYPES matches DB migration email_eligible flag`);

  // ---------------------------------------------------------------------------
  // 3. Verify Template Registry completeness
  // ---------------------------------------------------------------------------
  console.log('Case 3: Checking template registry coverage...');
  assert(
    REGISTERED_TEMPLATE_KEYS.size === EMAIL_ELIGIBLE_TYPES.size,
    `Template registry size (${REGISTERED_TEMPLATE_KEYS.size}) must match email eligible types (${EMAIL_ELIGIBLE_TYPES.size})`,
  );

  for (const type of EMAIL_ELIGIBLE_TYPES) {
    assert(
      REGISTERED_TEMPLATE_KEYS.has(type),
      `Template for email-eligible type "${type}" must be registered in EMAIL_TEMPLATES`,
    );
  }
  console.log(`  PASSED: All email-eligible types have registered templates`);

  // ---------------------------------------------------------------------------
  // 4. Verify Policy Evaluation rules
  // ---------------------------------------------------------------------------
  console.log('Case 4: Testing notificationPolicy delivery matrix...');

  // Default preferences: email_enabled=true, room_invitations=true, system_announcements=true
  const defaultPrefs = {
    user_id: 'test-user-id',
    email_enabled: true,
    room_invitations: true,
    room_events: false,
    moderation_events: false,
    system_announcements: true,
    updated_at: new Date().toISOString(),
  };

  // ROOM_INVITATION (email-eligible, room_invitations on) -> both
  const inviteDecision = evaluateDelivery('ROOM_INVITATION', defaultPrefs);
  assert(inviteDecision.sendInApp === true, 'ROOM_INVITATION should send in-app');
  assert(inviteDecision.sendEmail === true, 'ROOM_INVITATION should send email under default prefs');

  // ROOM_STARTED (email-eligible, but room_events is false by default) -> in-app only
  const startedDecision = evaluateDelivery('ROOM_STARTED', defaultPrefs);
  assert(startedDecision.sendInApp === true, 'ROOM_STARTED should send in-app');
  assert(startedDecision.sendEmail === false, 'ROOM_STARTED should not send email when room_events=false');

  // Master email_enabled = false -> no emails ever
  const disabledEmailPrefs = { ...defaultPrefs, email_enabled: false };
  for (const type of NOTIFICATION_TYPES) {
    const decision = evaluateDelivery(type as NotificationType, disabledEmailPrefs);
    assert(decision.sendEmail === false, `Type "${type}" must not send email when email_enabled=false`);
  }

  // Non-email-eligible type never sends email
  const hostTransferDecision = evaluateDelivery('ROOM_HOST_TRANSFER', {
    ...defaultPrefs,
    room_events: true,
  });
  assert(hostTransferDecision.sendInApp === true, 'ROOM_HOST_TRANSFER should send in-app');
  assert(hostTransferDecision.sendEmail === false, 'ROOM_HOST_TRANSFER is not email eligible');
  console.log(`  PASSED: Policy evaluation adheres to registry eligibility and category preferences`);

  // ---------------------------------------------------------------------------
  // 5. Verify Template Rendering with sample payloads
  // ---------------------------------------------------------------------------
  console.log('Case 5: Rendering email templates with test payloads...');

  const payloads: Record<EmailEligibleType, Record<string, unknown>> = {
    ROOM_INVITATION: {
      roomTitle: 'Movie Night',
      inviterName: 'Alice',
      roomUrl: 'https://cowatch.tv/room/test-room',
    },
    ROOM_STARTED: {
      roomTitle: 'Weekend Binge',
      roomUrl: 'https://cowatch.tv/room/test-room',
    },
    SYSTEM_ANNOUNCEMENT: {
      subject: 'Scheduled Maintenance Notice',
      body: 'Servers will undergo maintenance on Sunday.',
      ctaUrl: 'https://cowatch.tv/status',
      ctaLabel: 'System Status',
    },
  };

  for (const rawType of EMAIL_ELIGIBLE_TYPES) {
    const type = rawType as EmailEligibleType;
    const rendered = renderEmailTemplate(type, payloads[type]);
    assert(rendered !== null, `Failed to render template for "${type}"`);
    assert(rendered.subject.length > 0, `Subject for "${type}" must not be empty`);
    assert(rendered.html.includes('<!DOCTYPE html>'), `HTML for "${type}" must be valid document`);
    assert(rendered.text.length > 0, `Text for "${type}" must not be empty`);

    // Test normalized kebab-case key as well
    const kebabKey = type.toLowerCase().replace(/_/g, '-');
    const renderedKebab = renderEmailTemplate(kebabKey, payloads[type]);
    assert(renderedKebab !== null, `Failed to render template using kebab key "${kebabKey}"`);
  }
  console.log(`  PASSED: All templates rendered valid HTML, text, and subject headers`);

  console.log('\nAll NOTIFY-001 Consistency Invariants Verified Successfully!');
}

runConsistencyTests().catch((err) => {
  console.error('\nConsistency test failure:', err);
  process.exit(1);
});
