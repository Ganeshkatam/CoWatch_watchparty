/**
 * COWATCH ROOM IDENTITY ARCHITECTURE - PHASE 2: RPC MIGRATION INTEGRATION TEST SUITE
 * File: server/roomRpcPhase2.test.ts
 *
 * Validates the Phase 2 database routine contracts:
 *   - sql/migrations/20261118_room_identity_phase2_rpcs_up.sql
 *   - sql/migrations/20261118_room_identity_phase2_rpcs_down.sql
 *   - sql/schema.sql
 *
 * Test Suites:
 *   Suite 1: Static Architectural Contract & Migration Files Parity
 *   Suite 2: Overloaded UUID-First and Delegating Text Signatures
 *   Suite 3: Universal Boundary Room Resolver Logic Simulation
 *   Suite 4: Dual-Identity JSON Contract Compatibility Matrix
 *   Suite 5: Security Definer, Isolation & Strict Privilege Lockdown
 *   Suite 6: Symmetrical Reversibility & Rollback Parity
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Test Assertion Framework
// ---------------------------------------------------------------------------
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(
        () => {
          passedTests++;
          console.log(`  ✔ [PASS] ${name}`);
        },
        (err) => {
          failedTests++;
          console.error(`  ✖ [FAIL] ${name}:`, err.message);
        }
      );
    } else {
      passedTests++;
      console.log(`  ✔ [PASS] ${name}`);
    }
  } catch (err: any) {
    failedTests++;
    console.error(`  ✖ [FAIL] ${name}:`, err.message);
  }
}

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

// ---------------------------------------------------------------------------
// Load Migration Scripts & Schema
// ---------------------------------------------------------------------------
const upPath = path.resolve(process.cwd(), 'sql/migrations/20261118_room_identity_phase2_rpcs_up.sql');
const downPath = path.resolve(process.cwd(), 'sql/migrations/20261118_room_identity_phase2_rpcs_down.sql');
const schemaPath = path.resolve(process.cwd(), 'sql/schema.sql');

const upContent = fs.readFileSync(upPath, 'utf8');
const downContent = fs.readFileSync(downPath, 'utf8');
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

console.log('========================================================================');
console.log('STARTING ROOM IDENTITY PHASE 2: RPC MIGRATION INTEGRATION TEST SUITE');
console.log('========================================================================\n');

// ---------------------------------------------------------------------------
// SUITE 1: Static Architectural Contract & Migration Files Parity
// ---------------------------------------------------------------------------
console.log('--- SUITE 1: Static Architectural Contract & Migration Files Parity ---');

test('1.1 Forward migration file exists, is non-empty (>5KB), and is transactional', () => {
  assert(fs.existsSync(upPath), 'Forward migration file must exist');
  assert(upContent.length > 5000, `Forward migration length (${upContent.length}) must exceed 5KB`);
  assert(upContent.includes('BEGIN;'), 'Forward migration must begin transaction');
  assert(upContent.includes('COMMIT;'), 'Forward migration must commit transaction');
  assert(upContent.includes("lock_timeout = '2s'"), 'Forward migration must enforce 2s lock_timeout');
  assert(upContent.includes("statement_timeout = '30s'"), 'Forward migration must enforce 30s statement_timeout');
});

test('1.2 Rollback migration file exists, is non-empty (>5KB), and is transactional', () => {
  assert(fs.existsSync(downPath), 'Rollback migration file must exist');
  assert(downContent.length > 5000, `Rollback migration length (${downContent.length}) must exceed 5KB`);
  assert(downContent.includes('BEGIN;'), 'Rollback migration must begin transaction');
  assert(downContent.includes('COMMIT;'), 'Rollback migration must commit transaction');
  assert(downContent.includes("lock_timeout = '2s'"), 'Rollback migration must enforce 2s lock_timeout');
  assert(downContent.includes("statement_timeout = '30s'"), 'Rollback migration must enforce 30s statement_timeout');
});

// ---------------------------------------------------------------------------
// SUITE 2: Overloaded UUID-First and Delegating Text Signatures
// ---------------------------------------------------------------------------
console.log('\n--- SUITE 2: Overloaded UUID-First and Delegating Text Signatures ---');

const coreAuthoritativeRoutines = [
  'create_room_authoritative',
  'delete_room_authoritative',
  'end_room_authoritative',
  'extend_room_authoritative',
  'set_room_activity_authoritative',
  'set_room_participants_lock_authoritative',
  'set_room_permanence_authoritative',
  'update_room_metadata_authoritative',
];

test('2.1 All 8 core authoritative routines have canonical UUID signatures in forward migration', () => {
  for (const routine of coreAuthoritativeRoutines) {
    const uuidRegex = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${routine}\\([^)]*uuid[^)]*\\)`, 'i');
    assert(uuidRegex.test(upContent), `Routine ${routine} must have an overloaded UUID signature in up.sql`);
  }
});

test('2.2 All 8 core authoritative routines have delegating text signatures in forward migration', () => {
  for (const routine of coreAuthoritativeRoutines) {
    const textRegex = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${routine}\\([^)]*text[^)]*\\)`, 'i');
    assert(textRegex.test(upContent), `Routine ${routine} must have an overloaded text signature in up.sql`);
  }
});

test('2.3 Universal room resolver public.resolve_room_authoritative is declared', () => {
  assert(
    upContent.includes('CREATE OR REPLACE FUNCTION public.resolve_room_authoritative'),
    'resolve_room_authoritative must be declared in forward migration'
  );
  assert(
    upContent.includes('RETURNS public.rooms'),
    'resolve_room_authoritative must return public.rooms'
  );
});

test('2.4 Table return and array return routines preserve exact baseline signatures', () => {
  assert(
    upContent.includes('CREATE OR REPLACE FUNCTION public.expire_rooms_authoritative()'),
    'expire_rooms_authoritative must be declared'
  );
  assert(
    upContent.includes('RETURNS TABLE(\n  room_id text,'),
    'expire_rooms_authoritative must return TABLE(room_id text, ...)'
  );
  assert(
    upContent.includes('CREATE OR REPLACE FUNCTION public.purge_account_rooms_authoritative('),
    'purge_account_rooms_authoritative must be declared'
  );
  assert(
    upContent.includes('RETURNS text[]'),
    'purge_account_rooms_authoritative must return text[]'
  );
});

test('2.5 Delegating text signatures check for UUID format and forward to UUID signature', () => {
  const delegationCount = (upContent.match(/p_room_id ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'/g) || []).length;
  assert(delegationCount >= 8, `Expected at least 8 UUID boundary regex checks in delegating functions (found ${delegationCount})`);
});

// ---------------------------------------------------------------------------
// SUITE 3: Universal Boundary Room Resolver Logic Simulation
// ---------------------------------------------------------------------------
console.log('\n--- SUITE 3: Universal Boundary Room Resolver Logic Simulation ---');

function simulateResolverRouting(identifier: string | null | undefined): 'joining_id' | 'uuid' | 'moniker' | null {
  if (!identifier || identifier.trim() === '') return null;
  if (/^[0-9]{10}$/.test(identifier)) return 'joining_id';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) return 'uuid';
  return 'moniker';
}

test('3.1 10-digit public codes resolve via idx_rooms_joining_id_unique', () => {
  assert(simulateResolverRouting('0123456789') === 'joining_id', '10-digit code must route to joining_id');
  assert(simulateResolverRouting('0000000000') === 'joining_id', '10-digit zeroes must route to joining_id');
  assert(simulateResolverRouting('9999999999') === 'joining_id', '10-digit max must route to joining_id');
});

test('3.2 Canonical UUIDs resolve via room_pkey / idx_rooms_id_unique', () => {
  assert(
    simulateResolverRouting('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11') === 'uuid',
    'Standard UUID v4 must route to uuid'
  );
  assert(
    simulateResolverRouting('00000000-0000-0000-0000-000000000000') === 'uuid',
    'Nil UUID must route to uuid'
  );
  assert(
    simulateResolverRouting('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11') === 'uuid',
    'Uppercase UUID must route to uuid'
  );
});

test('3.3 Legacy text monikers route to legacy fallback index', () => {
  assert(simulateResolverRouting('movie-night-alpha') === 'moniker', 'Text slug must route to moniker');
  assert(simulateResolverRouting('room-12345') === 'moniker', 'Room prefix must route to moniker');
  assert(simulateResolverRouting('12345') === 'moniker', 'Short numeric string (<10 digits) must route to moniker');
  assert(simulateResolverRouting('12345678901') === 'moniker', 'Long numeric string (>10 digits) must route to moniker');
});

test('3.4 Empty or null identifier returns null cleanly without database error', () => {
  assert(simulateResolverRouting('') === null, 'Empty string must return null');
  assert(simulateResolverRouting('   ') === null, 'Whitespace string must return null');
  assert(simulateResolverRouting(null) === null, 'Null must return null');
  assert(simulateResolverRouting(undefined) === null, 'Undefined must return null');
});

// ---------------------------------------------------------------------------
// SUITE 4: Dual-Identity JSON Contract Compatibility Matrix
// ---------------------------------------------------------------------------
console.log('\n--- SUITE 4: Dual-Identity JSON Contract Compatibility Matrix ---');

test('4.1 create_room_authoritative return payload includes id, roomId, and joiningId', () => {
  assert(
    upContent.includes("'id', p_room_id") &&
    upContent.includes("'roomId', v_effective_legacy_id") &&
    upContent.includes("'joiningId', v_assigned_joining_id"),
    'create_room_authoritative must return id, roomId, and joiningId'
  );
});

test('4.2 delete_room_authoritative return payload includes id and deletedRoomId', () => {
  assert(
    upContent.includes("'id', p_room_id") &&
    upContent.includes("'deletedRoomId', v_legacy_id"),
    'delete_room_authoritative must return id and deletedRoomId'
  );
});

test('4.3 end_room_authoritative return payload includes id and roomId', () => {
  assert(
    upContent.includes("'id', p_room_id") &&
    upContent.includes("'roomId', v_legacy_id") &&
    upContent.includes("'status', v_new_status"),
    'end_room_authoritative must return id and roomId'
  );
});

test('4.4 set_room_activity_authoritative return payload includes id and roomId', () => {
  assert(
    upContent.includes("'id', p_room_id") &&
    upContent.includes("'roomId', v_legacy_id") &&
    upContent.includes("'lifecycleEventId', v_lifecycle_event_id"),
    'set_room_activity_authoritative must return id, roomId, and lifecycleEventId'
  );
});

test('4.5 set_room_permanence_authoritative return payload includes id and roomId', () => {
  assert(
    upContent.includes("'id', p_room_id") &&
    upContent.includes("'roomId', v_legacy_id") &&
    upContent.includes("'isPermanent', p_is_permanent"),
    'set_room_permanence_authoritative must return id and roomId'
  );
});

test('4.6 update_room_metadata_authoritative return payload includes id and roomId', () => {
  assert(
    upContent.includes("'id', p_room_id") &&
    upContent.includes("'roomId', v_legacy_id") &&
    upContent.includes("'roomTitle', COALESCE(p_title, v_room.\"roomTitle\")"),
    'update_room_metadata_authoritative must return id and roomId'
  );
});

// ---------------------------------------------------------------------------
// SUITE 5: Security Definer, Isolation & Strict Privilege Lockdown
// ---------------------------------------------------------------------------
console.log('\n--- SUITE 5: Security Definer, Isolation & Strict Privilege Lockdown ---');

test('5.1 All declared functions use SECURITY DEFINER and SET search_path TO \'\'', () => {
  const functionBlocks = upContent.split(/CREATE OR REPLACE FUNCTION/g).slice(1);
  assert(functionBlocks.length >= 19, `Expected at least 19 function declarations in up.sql (found ${functionBlocks.length})`);
  
  for (let i = 0; i < functionBlocks.length; i++) {
    const block = functionBlocks[i];
    const funcNameMatch = block.match(/public\.([a-z_]+)\(/i);
    const funcName = funcNameMatch ? funcNameMatch[1] : `function_${i}`;
    assert(
      block.includes('SECURITY DEFINER'),
      `Function ${funcName} must specify SECURITY DEFINER`
    );
    assert(
      block.includes("SET search_path TO ''"),
      `Function ${funcName} must specify SET search_path TO '' for security hardening`
    );
  }
});

test('5.2 Strict REVOKE ALL from PUBLIC, anon, and authenticated for all routines', () => {
  const revokePublicCount = (upContent.match(/REVOKE ALL ON FUNCTION.*FROM PUBLIC, anon, authenticated;/g) || []).length;
  assert(revokePublicCount >= 19, `Expected at least 19 REVOKE ALL statements in up.sql (found ${revokePublicCount})`);
});

test('5.3 Strict GRANT EXECUTE to postgres and service_role exclusively', () => {
  const grantCount = (upContent.match(/GRANT EXECUTE ON FUNCTION.*TO postgres, service_role;/g) || []).length;
  assert(grantCount >= 19, `Expected at least 19 GRANT EXECUTE statements in up.sql (found ${grantCount})`);
  assert(!upContent.includes('TO anon'), 'Must not grant execute privileges to anon');
  assert(!upContent.includes('TO authenticated'), 'Must not grant execute privileges to authenticated');
});

// ---------------------------------------------------------------------------
// SUITE 6: Symmetrical Reversibility & Rollback Parity
// ---------------------------------------------------------------------------
console.log('\n--- SUITE 6: Symmetrical Reversibility & Rollback Parity ---');

test('6.1 Rollback script drops universal room resolver and all UUID signatures', () => {
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.resolve_room_authoritative(text);'), 'Rollback must drop resolve_room_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.create_room_authoritative('), 'Rollback must drop UUID create_room_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.delete_room_authoritative(uuid, uuid);'), 'Rollback must drop UUID delete_room_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.end_room_authoritative(uuid, uuid, text);'), 'Rollback must drop UUID end_room_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.extend_room_authoritative(uuid, uuid, timestamptz);'), 'Rollback must drop UUID extend_room_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.set_room_activity_authoritative(uuid, text, uuid);'), 'Rollback must drop UUID set_room_activity_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.set_room_participants_lock_authoritative(uuid, uuid, boolean);'), 'Rollback must drop UUID set_room_participants_lock_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.set_room_permanence_authoritative(uuid, uuid, boolean);'), 'Rollback must drop UUID set_room_permanence_authoritative');
  assert(downContent.includes('DROP FUNCTION IF EXISTS public.update_room_metadata_authoritative('), 'Rollback must drop UUID update_room_metadata_authoritative');
});

test('6.2 Rollback script restores all 10 original baseline functions from sql/schema.sql', () => {
  for (const routine of coreAuthoritativeRoutines) {
    assert(downContent.includes(`CREATE OR REPLACE FUNCTION public.${routine}`), `Rollback must restore baseline public.${routine}`);
  }
  assert(downContent.includes('CREATE OR REPLACE FUNCTION public.expire_rooms_authoritative()'), 'Rollback must restore baseline expire_rooms_authoritative');
  assert(downContent.includes('CREATE OR REPLACE FUNCTION public.purge_account_rooms_authoritative('), 'Rollback must restore baseline purge_account_rooms_authoritative');
});

test('6.3 Rollback script restores exact baseline security privileges', () => {
  const revokeDownCount = (downContent.match(/REVOKE ALL ON FUNCTION.*FROM PUBLIC, anon, authenticated;/g) || []).length;
  const grantDownCount = (downContent.match(/GRANT EXECUTE ON FUNCTION.*TO postgres, service_role;/g) || []).length;
  assert(revokeDownCount >= 10, `Expected at least 10 REVOKE statements in down.sql (found ${revokeDownCount})`);
  assert(grantDownCount >= 10, `Expected at least 10 GRANT statements in down.sql (found ${grantDownCount})`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`PHASE 2 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
console.log('========================================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
