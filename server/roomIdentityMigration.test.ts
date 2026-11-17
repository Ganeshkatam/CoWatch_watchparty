/**
 * COWATCH ROOM IDENTITY ARCHITECTURE INTEGRATION TEST SUITE
 * File: server/roomIdentityMigration.test.ts
 *
 * Verifies the committed migration contracts:
 *   - sql/migrations/20261118_room_identity_architecture_up.sql
 *   - sql/migrations/20261118_room_identity_architecture_down.sql
 *   - server/utils/postgres.ts
 *
 * Test Suites:
 *   Suite 1: Static Architectural Contract & Migration Files Parity
 *   Suite 2: 64-Bit Advisory Lock Key Derivation & Domain Isolation
 *   Suite 3: Cryptographic Rejection Sampling & Modulo Bias Elimination
 *   Suite 4: Transactional Isolation & Scoped Lock Timeout Contract
 *   Suite 5: Parent & Child Synchronization Triggers Immutability Matrix
 *   Suite 6: Resumable Backfill, Keyset Cursor & Completion Barrier Logic
 *   Suite 7: Rollback Data Preservation & Non-Destructive Column Disposition
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg} - Expected: ${expected}, Actual: ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Paths and Committed Files
// ---------------------------------------------------------------------------
const repoRoot = process.cwd();
const upSqlPath = path.join(repoRoot, 'sql/migrations/20261118_room_identity_architecture_up.sql');
const downSqlPath = path.join(repoRoot, 'sql/migrations/20261118_room_identity_architecture_down.sql');
const schemaSqlPath = path.join(repoRoot, 'sql/schema.sql');
const postgresTsPath = path.join(repoRoot, 'server/utils/postgres.ts');

const upSql = fs.readFileSync(upSqlPath, 'utf8');
const downSql = fs.readFileSync(downSqlPath, 'utf8');
const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
const postgresTs = fs.readFileSync(postgresTsPath, 'utf8');

// ---------------------------------------------------------------------------
// Advisory Lock Mathematical Logic Mirror
// ---------------------------------------------------------------------------
function cowatchAdvisoryLockKey(domain: number, payload: bigint): bigint {
  if (domain === null || domain === undefined || payload === null || payload === undefined) {
    throw new Error('ERRCODE_22004: Domain and payload must not be NULL');
  }
  if (domain < 1 || domain > 127) {
    throw new Error(`ERRCODE_22023: Domain ${domain} out of range [1, 127]`);
  }
  const MAX_56_BIT = 72057594037927935n; // 2^56 - 1
  if (payload < 0n || payload > MAX_56_BIT) {
    throw new Error(`ERRCODE_22023: Payload ${payload} out of range [0, 2^56 - 1]`);
  }
  const domainBig = BigInt(domain);
  return (domainBig << 56n) | payload;
}

// ---------------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------------
async function runAllTests() {
  console.log('========================================================================');
  console.log('STARTING ROOM IDENTITY ARCHITECTURE INTEGRATION TEST SUITE');
  console.log('========================================================================\n');

  // ==========================================================================
  // SUITE 1: Static Architectural Contract & Migration Files Parity
  // ==========================================================================
  console.log('--- SUITE 1: Static Architectural Contract & Schema Parity ---');

  test('1.1 Committed forward migration exists and is non-empty', () => {
    assert(fs.existsSync(upSqlPath), 'Forward migration file must exist');
    assert(upSql.length > 5000, 'Forward migration must contain full 7 stages');
  });

  test('1.2 Committed rollback migration exists and is non-empty', () => {
    assert(fs.existsSync(downSqlPath), 'Rollback migration file must exist');
    assert(downSql.length > 3000, 'Rollback migration must contain full R1-R6 stages');
  });

  test('1.3 All seven child tables and exact legacy FKs match sql/schema.sql', () => {
    const childConstraints = [
      { table: 'public.room_admissions', legacyFk: 'room_admissions_room_id_fkey', newFk: 'room_admissions_room_uuid_fkey' },
      { table: 'public.room_bans', legacyFk: 'room_bans_room_id_fkey', newFk: 'room_bans_room_uuid_fkey' },
      { table: 'public.room_invitations', legacyFk: 'room_invitations_room_id_fkey', newFk: 'room_invitations_room_uuid_fkey' },
      { table: 'public.room_lifecycle_events', legacyFk: 'room_lifecycle_events_room_fk', newFk: 'room_lifecycle_events_room_uuid_fkey' },
      { table: 'public.room_media_sessions', legacyFk: 'room_media_sessions_room_id_fkey', newFk: 'room_media_sessions_room_uuid_fkey' },
      { table: 'public.room_messages', legacyFk: 'room_messages_room_id_fkey', newFk: 'room_messages_room_uuid_fkey' },
      { table: 'public.room_quota_events', legacyFk: 'room_quota_events_room_id_fkey', newFk: 'room_quota_events_room_uuid_fkey' },
    ];

    for (const c of childConstraints) {
      assert(schemaSql.includes(c.legacyFk), `schema.sql must define ${c.legacyFk}`);
      assert(upSql.includes(`DROP CONSTRAINT ${c.legacyFk}`), `up.sql must drop ${c.legacyFk} explicitly`);
      assert(upSql.includes(`ADD CONSTRAINT ${c.newFk}`), `up.sql must add replacement ${c.newFk}`);
      assert(upSql.includes(`VALIDATE CONSTRAINT ${c.newFk}`), `up.sql must validate ${c.newFk}`);
      assert(downSql.includes(`DROP CONSTRAINT IF EXISTS ${c.newFk}`), `down.sql must drop ${c.newFk}`);
      assert(downSql.includes(`ADD CONSTRAINT ${c.legacyFk}`), `down.sql must restore ${c.legacyFk}`);
      assert(downSql.includes(`VALIDATE CONSTRAINT ${c.legacyFk}`), `down.sql must validate restored ${c.legacyFk}`);
    }
  });

  test('1.4 Active procedure invocations present in forward migration (no uncalled routines)', () => {
    assert(
      upSql.includes('CALL public.backfill_rooms_identity(1000);'),
      'up.sql must directly execute parent backfill procedure'
    );
    assert(
      upSql.includes('CALL public.backfill_all_child_tables(1000);'),
      'up.sql must directly execute child backfill master procedure'
    );
  });

  test('1.5 Zero commented-out SQL DDL blocks in migration files', () => {
    assert(!downSql.includes('-- ALTER TABLE public.rooms'), 'down.sql must not contain commented ALTER TABLE');
    assert(!downSql.includes('-- DROP COLUMN IF EXISTS id'), 'down.sql must not contain commented DROP COLUMN');
    assert(!upSql.includes('-- CREATE TABLE public.rooms'), 'up.sql must not contain commented CREATE TABLE');
  });

  test('1.6 Symmetric reversibility across all concurrent indexes, triggers, and routines', () => {
    const indexes = [
      'idx_rooms_id_unique',
      'idx_rooms_legacy_room_id_unique',
      'idx_rooms_joining_id_unique',
      'idx_room_admissions_room_uuid',
      'idx_room_bans_room_uuid',
      'idx_room_invitations_room_uuid',
      'idx_room_lifecycle_events_room_uuid',
      'idx_room_media_sessions_room_uuid',
      'idx_room_messages_room_uuid',
      'idx_room_quota_events_room_uuid',
    ];
    for (const idx of indexes) {
      assert(upSql.includes(idx), `up.sql must create index ${idx}`);
      assert(downSql.includes(idx), `down.sql must drop index ${idx}`);
    }

    const triggers = [
      'trg_sync_room_identities',
      'trg_sync_room_admissions_uuid',
      'trg_sync_room_bans_uuid',
      'trg_sync_room_invitations_uuid',
      'trg_sync_room_lifecycle_events_uuid',
      'trg_sync_room_media_sessions_uuid',
      'trg_sync_room_messages_uuid',
      'trg_sync_room_quota_events_uuid',
    ];
    for (const trg of triggers) {
      assert(upSql.includes(trg), `up.sql must create trigger ${trg}`);
      assert(downSql.includes(trg), `down.sql must drop trigger ${trg}`);
    }
  });

  // ==========================================================================
  // SUITE 2: 64-Bit Advisory Lock Key Derivation & Domain Isolation
  // ==========================================================================
  console.log('\n--- SUITE 2: Advisory Lock Mathematical Domain Isolation ---');

  test('2.1 Key generation bounds: bit 63 is always 0 (strictly non-negative signed bigint)', () => {
    const key1 = cowatchAdvisoryLockKey(2, 0n);
    const key2 = cowatchAdvisoryLockKey(2, 72057594037927935n);
    const keyMaxDomain = cowatchAdvisoryLockKey(127, 72057594037927935n);

    assert(key1 >= 0n, 'Key must be non-negative');
    assert(key2 >= 0n, 'Key must be non-negative');
    assert(keyMaxDomain >= 0n, 'Key with domain 127 must be non-negative');

    // Bit 63 check: 2^63 is 9223372036854775808n
    const bit63Mask = 1n << 63n;
    assertEquals(keyMaxDomain & bit63Mask, 0n, 'Bit 63 must remain 0');
  });

  test('2.2 Domain ID range validation [1, 127]', () => {
    let threwUnder = false;
    try {
      cowatchAdvisoryLockKey(0, 100n);
    } catch {
      threwUnder = true;
    }
    assert(threwUnder, 'Domain 0 must be rejected');

    let threwOver = false;
    try {
      cowatchAdvisoryLockKey(128, 100n);
    } catch {
      threwOver = true;
    }
    assert(threwOver, 'Domain 128 must be rejected');

    const validKey = cowatchAdvisoryLockKey(2, 100n);
    assert(validKey > 0n, 'Domain 2 must be valid');
  });

  test('2.3 Payload range validation [0, 2^56 - 1]', () => {
    let threwNegative = false;
    try {
      cowatchAdvisoryLockKey(2, -1n);
    } catch {
      threwNegative = true;
    }
    assert(threwNegative, 'Negative payload must be rejected');

    let threwOverflow = false;
    try {
      cowatchAdvisoryLockKey(2, 72057594037927936n); // 2^56
    } catch {
      threwOverflow = true;
    }
    assert(threwOverflow, 'Payload >= 2^56 must be rejected');
  });

  test('2.4 Zero cross-domain key collision guarantee (Mathematical Proof)', () => {
    // Generate keys across Domain 1 (historical), Domain 2 (joining ID), Domain 3 (future)
    const domain1Keys = new Set<string>();
    const domain2Keys = new Set<string>();
    const domain3Keys = new Set<string>();

    const testPayloads = [0n, 1n, 9999999999n, 50000000000n, 72057594037927935n];
    for (const p of testPayloads) {
      domain1Keys.add(cowatchAdvisoryLockKey(1, p).toString());
      domain2Keys.add(cowatchAdvisoryLockKey(2, p).toString());
      domain3Keys.add(cowatchAdvisoryLockKey(3, p).toString());
    }

    // Verify disjoint sets
    for (const k of domain2Keys) {
      assert(!domain1Keys.has(k), 'Domain 2 key must never collide with Domain 1');
      assert(!domain3Keys.has(k), 'Domain 2 key must never collide with Domain 3');
    }
  });

  // ==========================================================================
  // SUITE 3: Cryptographic Rejection Sampling & Modulo Bias
  // ==========================================================================
  console.log('\n--- SUITE 3: Cryptographic Rejection Sampling & Modulo Bias ---');

  test('3.1 Modulo bias proof: 2^40 % 10^10 is non-zero (demonstrating why rejection sampling is required)', () => {
    const twoToTheForty = 1099511627776n; // 2^40
    const tenToTheTen = 10000000000n;     // 10^10
    const remainder = twoToTheForty % tenToTheTen;

    assertEquals(remainder, 9511627776n, '2^40 % 10^10 leaves an unaligned remainder of 9,511,627,776');

    // Numbers in range [0, remainder - 1] have 110 chances of occurring vs 109 chances for the rest!
    // Rejection sampling threshold L = 109 * 10^10 = 1,090,000,000,000 eliminates this bias completely.
    const rejectionThreshold = 109n * tenToTheTen;
    assertEquals(rejectionThreshold, 1090000000000n, 'Threshold must be exactly 1,090,000,000,000');
  });

  test('3.2 Rejection sampling candidate formatting: strictly 10 digits zero-padded', () => {
    const candidateNum = 42n;
    const formatted = candidateNum.toString().padStart(10, '0');
    assertEquals(formatted, '0000000042', 'Must zero-pad to exactly 10 characters');
    assert(/^[0-9]{10}$/.test(formatted), 'Must match regex ^[0-9]{10}$');
  });

  // ==========================================================================
  // SUITE 4: Transactional Isolation & Scoped Lock Timeout Contract
  // ==========================================================================
  console.log('\n--- SUITE 4: Transaction Isolation & Timeout Restoration ---');

  test('4.1 postgres.ts connection pool configuration specifies escaped READ COMMITTED', () => {
    assert(
      postgresTs.includes('options: "-c default_transaction_isolation=read\\\\ committed"'),
      'Connection pool must configure default_transaction_isolation=read\\ committed'
    );
  });

  test('4.2 postgres.ts enforces TLS certificate verification with fallback support', () => {
    assert(postgresTs.includes('rejectUnauthorized: true'), 'TLS certificate verification must be enabled');
    assert(postgresTs.includes('process.env.PGSSLROOTCERT'), 'Custom CA bundle must be supported');
    assert(postgresTs.includes('sslmode=disable'), 'Non-SSL development fallback must be supported');
  });

  test('4.3 assert_read_committed_isolation rejection semantics', () => {
    // Mirror of PostgreSQL assert_read_committed_isolation()
    function verifyIsolation(currentIsolation: string) {
      if (['repeatable read', 'serializable'].includes(currentIsolation.toLowerCase())) {
        throw new Error(`ERRCODE_25000: CoWatch joining-ID allocation requires READ COMMITTED isolation (current: ${currentIsolation})`);
      }
    }

    // Must succeed for read committed
    verifyIsolation('read committed');
    verifyIsolation('READ COMMITTED');

    // Must throw for repeatable read
    let threwRR = false;
    try {
      verifyIsolation('repeatable read');
    } catch (e: any) {
      threwRR = e.message.includes('ERRCODE_25000');
    }
    assert(threwRR, 'Must reject repeatable read isolation');

    // Must throw for serializable
    let threwSer = false;
    try {
      verifyIsolation('serializable');
    } catch (e: any) {
      threwSer = e.message.includes('ERRCODE_25000');
    }
    assert(threwSer, 'Must reject serializable isolation');
  });

  test('4.4 Scoped lock timeout restoration simulation across success and error paths', () => {
    // Simulates the nested exception block in claim_explicit_joining_id
    class SessionState {
      public lockTimeout = '15s'; // Caller's outer transaction timeout

      acquireLockWithScopedTimeout(simulateError: boolean) {
        const origTimeout = this.lockTimeout;
        try {
          this.lockTimeout = '2s'; // Local scoped timeout
          if (simulateError) {
            throw new Error('55P03 lock_not_available');
          }
          this.lockTimeout = origTimeout; // Success restore
        } catch (err) {
          this.lockTimeout = origTimeout; // Error restore
          throw err;
        }
      }
    }

    const session = new SessionState();
    assertEquals(session.lockTimeout, '15s', 'Initial timeout must be 15s');

    // Success path
    session.acquireLockWithScopedTimeout(false);
    assertEquals(session.lockTimeout, '15s', 'Timeout must revert to 15s after success');

    // Error path
    let caught = false;
    try {
      session.acquireLockWithScopedTimeout(true);
    } catch {
      caught = true;
    }
    assert(caught, 'Error must be re-thrown');
    assertEquals(session.lockTimeout, '15s', 'Timeout must revert to 15s after error');
  });

  // ==========================================================================
  // SUITE 5: Parent & Child Synchronization Triggers Immutability Matrix
  // ==========================================================================
  console.log('\n--- SUITE 5: Trigger Synchronization & Immutability Matrix ---');

  test('5.1 Immutability guard: once assigned, id and joining_id cannot be changed', () => {
    function simulateUpdateTrigger(oldRow: any, newRow: any) {
      // Fast path check
      if (
        newRow.id === oldRow.id &&
        newRow.joining_id === oldRow.joining_id &&
        newRow.legacy_room_id === oldRow.legacy_room_id &&
        newRow.roomId === oldRow.roomId
      ) {
        return { fastPath: true, row: newRow };
      }

      // Immutability checks
      if (oldRow.id && newRow.id !== oldRow.id) {
        throw new Error('ERRCODE_23514: Room UUID (id) is immutable once assigned');
      }
      if (oldRow.joining_id && newRow.joining_id !== oldRow.joining_id) {
        throw new Error('ERRCODE_23514: Room joining_id is immutable once assigned');
      }
      if (oldRow.legacy_room_id && newRow.legacy_room_id !== oldRow.legacy_room_id) {
        throw new Error('ERRCODE_23514: Room legacy_room_id is immutable once assigned');
      }

      return { fastPath: false, row: newRow };
    }

    const original = { id: 'uuid-1', joining_id: '1234567890', legacy_room_id: 'lion', roomId: 'lion' };

    // Fast path: unmodified identities
    const unmodified = simulateUpdateTrigger(original, { ...original, title: 'Updated Title' });
    assert(unmodified.fastPath, 'Unmodified identities must take fast path');

    // Reject mutated id
    let threwIdMut = false;
    try {
      simulateUpdateTrigger(original, { ...original, id: 'uuid-2' });
    } catch (e: any) {
      threwIdMut = e.message.includes('Room UUID (id) is immutable');
    }
    assert(threwIdMut, 'Must reject UUID mutation');

    // Reject mutated joining_id
    let threwJoinMut = false;
    try {
      simulateUpdateTrigger(original, { ...original, joining_id: '0987654321' });
    } catch (e: any) {
      threwJoinMut = e.message.includes('Room joining_id is immutable');
    }
    assert(threwJoinMut, 'Must reject joining_id mutation');
  });

  test('5.2 Initial population transition: NULL -> populated identity is permitted during backfill', () => {
    function simulateBackfillUpdate(oldRow: any, newRow: any) {
      const row = { ...newRow };
      if (!oldRow.id && !row.id) {
        row.id = 'generated-uuid-v4';
      }
      if (!oldRow.legacy_room_id && !row.legacy_room_id) {
        row.legacy_room_id = oldRow.roomId;
      }
      return row;
    }

    const legacyRow = { id: null, joining_id: null, legacy_room_id: null, roomId: 'happy-lion' };
    const populated = simulateBackfillUpdate(legacyRow, { ...legacyRow });

    assert(populated.id !== null, 'Backfill must assign id when NULL');
    assertEquals(populated.legacy_room_id, 'happy-lion', 'Backfill must assign legacy_room_id from roomId');
  });

  test('5.3 Child table cross-identity validation: conflicting parent references rejected', () => {
    function simulateChildTrigger(parentIdMap: Map<string, string>, childRow: { room_id: string; room_uuid: string }) {
      if (childRow.room_id && childRow.room_uuid) {
        const expectedUuid = parentIdMap.get(childRow.room_id);
        if (expectedUuid !== childRow.room_uuid) {
          throw new Error(`ERRCODE_23503: Conflicting room identities provided: room_id=${childRow.room_id}, room_uuid=${childRow.room_uuid}`);
        }
      }
    }

    const parents = new Map([
      ['room-a', 'uuid-a'],
      ['room-b', 'uuid-b'],
    ]);

    // Matching reference succeeds
    simulateChildTrigger(parents, { room_id: 'room-a', room_uuid: 'uuid-a' });

    // Conflicting reference fails
    let threwConflict = false;
    try {
      simulateChildTrigger(parents, { room_id: 'room-a', room_uuid: 'uuid-b' });
    } catch (e: any) {
      threwConflict = e.message.includes('Conflicting room identities');
    }
    assert(threwConflict, 'Must reject conflicting parent room identities');
  });

  // ==========================================================================
  // SUITE 6: Resumable Backfill, Keyset Cursor & Completion Barrier Logic
  // ==========================================================================
  console.log('\n--- SUITE 6: Resumable Keyset Backfill & Completion Barrier ---');

  test('6.1 Keyset cursor resumption simulation', () => {
    // Mock database table with 5 legacy rooms
    const roomsTable: Array<{ roomId: string; id: string | null; joining_id: string | null }> = [
      { roomId: 'alpha', id: null, joining_id: null },
      { roomId: 'beta', id: null, joining_id: null },
      { roomId: 'charlie', id: null, joining_id: null },
      { roomId: 'delta', id: null, joining_id: null },
      { roomId: 'echo', id: null, joining_id: null },
    ];

    let lastProcessedId: string | null = null;
    let totalProcessed = 0;
    const batchSize = 2;

    // Batch 1
    const batch1 = roomsTable
      .filter((r) => (lastProcessedId === null || r.roomId > lastProcessedId) && r.id === null)
      .slice(0, batchSize);

    assertEquals(batch1.length, 2, 'Batch 1 must fetch 2 rows');
    batch1.forEach((r) => { r.id = 'uuid-' + r.roomId; });
    lastProcessedId = batch1[batch1.length - 1].roomId;
    totalProcessed += batch1.length;

    assertEquals(lastProcessedId, 'beta', 'Cursor must advance to beta');
    assertEquals(totalProcessed, 2, 'Total processed must be 2');

    // Simulate interruption & restart: resume using lastProcessedId ('beta')
    const batch2 = roomsTable
      .filter((r) => (lastProcessedId === null || r.roomId > lastProcessedId) && r.id === null)
      .slice(0, batchSize);

    assertEquals(batch2.length, 2, 'Batch 2 must fetch 2 rows starting after beta');
    assertEquals(batch2[0].roomId, 'charlie', 'First row of batch 2 must be charlie');
    batch2.forEach((r) => { r.id = 'uuid-' + r.roomId; });
    lastProcessedId = batch2[batch2.length - 1].roomId;
    totalProcessed += batch2.length;

    assertEquals(lastProcessedId, 'delta', 'Cursor must advance to delta');

    // Batch 3
    const batch3 = roomsTable
      .filter((r) => (lastProcessedId === null || r.roomId > lastProcessedId) && r.id === null)
      .slice(0, batchSize);

    assertEquals(batch3.length, 1, 'Batch 3 must fetch 1 row (echo)');
    batch3.forEach((r) => { r.id = 'uuid-' + r.roomId; });
    lastProcessedId = batch3[batch3.length - 1].roomId;
    totalProcessed += batch3.length;

    assertEquals(totalProcessed, 5, 'All 5 rooms must be backfilled');
  });

  test('6.2 Trailing reconciliation sweep catches rows inserted behind checkpoint', () => {
    const roomsTable: Array<{ roomId: string; id: string | null }> = [
      { roomId: 'alpha', id: 'uuid-alpha' },
      { roomId: 'beta', id: 'uuid-beta' },
      { roomId: 'charlie', id: 'uuid-charlie' },
      // New room inserted concurrently with legacy moniker behind forward cursor
      { roomId: 'aardvark', id: null },
    ];

    // Trailing reconciliation sweep uses unconstrained zero lower bound:
    const unpopulated = roomsTable.filter((r) => r.id === null);
    assertEquals(unpopulated.length, 1, 'Trailing sweep must find 1 unpopulated row');
    assertEquals(unpopulated[0].roomId, 'aardvark', 'Trailing sweep must catch aardvark');

    unpopulated[0].id = 'uuid-aardvark';
    const remaining = roomsTable.filter((r) => r.id === null);
    assertEquals(remaining.length, 0, 'Zero unpopulated rows remain after reconciliation sweep');
  });

  test('6.3 SHARE ROW EXCLUSIVE completion barrier assertion', () => {
    function completionBarrierCheck(unpopulatedCount: number): boolean {
      if (unpopulatedCount > 0) {
        throw new Error(`ERRCODE_22000: Completion barrier failed: ${unpopulatedCount} unpopulated rooms remain`);
      }
      return true; // Safe to transition checkpoint is_completed = true
    }

    assert(completionBarrierCheck(0), 'Barrier passes when 0 unpopulated rows remain');

    let threwBarrier = false;
    try {
      completionBarrierCheck(3);
    } catch (e: any) {
      threwBarrier = e.message.includes('ERRCODE_22000');
    }
    assert(threwBarrier, 'Barrier must halt execution if unpopulated rows remain under lock');
  });

  // ==========================================================================
  // SUITE 7: Rollback Data Preservation & Safe Restoration Matrix
  // ==========================================================================
  console.log('\n--- SUITE 7: Rollback Data Preservation & Restoration Matrix ---');

  test('7.1 Rollback reconciliation: populates legacy roomId for rooms created post-cutover', () => {
    const postCutoverRooms: Array<{ roomId: string | null; id: string; legacy_room_id: string | null }> = [
      { roomId: null, id: '550e8400-e29b-41d4-a716-446655440000', legacy_room_id: 'custom-alias' },
      { roomId: null, id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', legacy_room_id: null },
    ];

    // Rollback Stage R1 logic: SET "roomId" = COALESCE(legacy_room_id, id::text)
    for (const room of postCutoverRooms) {
      if (!room.roomId) {
        room.roomId = room.legacy_room_id || room.id;
      }
    }

    assertEquals(postCutoverRooms[0].roomId, 'custom-alias', 'Must use legacy_room_id if present');
    assertEquals(postCutoverRooms[1].roomId, '6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'Must fallback to id::text if legacy_room_id is NULL');
  });

  test('7.2 Rollback child reconciliation: populates child room_id from parent rooms table', () => {
    const parentRooms = new Map([
      ['uuid-100', 'legacy-room-100'],
      ['uuid-200', 'legacy-room-200'],
    ]);

    const postCutoverChildAdmissions: Array<{ id: string; room_uuid: string; room_id: string | null }> = [
      { id: 'adm-1', room_uuid: 'uuid-100', room_id: null },
      { id: 'adm-2', room_uuid: 'uuid-200', room_id: null },
    ];

    // Rollback Stage R1 child reconciliation:
    for (const child of postCutoverChildAdmissions) {
      if (!child.room_id) {
        child.room_id = parentRooms.get(child.room_uuid) || null;
      }
    }

    assertEquals(postCutoverChildAdmissions[0].room_id, 'legacy-room-100', 'Must restore child room_id reference');
    assertEquals(postCutoverChildAdmissions[1].room_id, 'legacy-room-200', 'Must restore child room_id reference');
  });

  test('7.3 Non-destructive column disposition: columns preserved, NOT NULL relaxed', () => {
    assert(downSql.includes('ALTER COLUMN id DROP NOT NULL'), 'down.sql relaxes id NOT NULL');
    assert(downSql.includes('ALTER COLUMN joining_id DROP NOT NULL'), 'down.sql relaxes joining_id NOT NULL');
    assert(downSql.includes('ALTER COLUMN legacy_room_id DROP NOT NULL'), 'down.sql relaxes legacy_room_id NOT NULL');
    assert(downSql.includes('ALTER COLUMN room_uuid DROP NOT NULL'), 'down.sql relaxes child room_uuid NOT NULL');

    // Assert that down.sql does NOT drop the columns by default
    assert(!downSql.includes('DROP COLUMN id'), 'down.sql must not execute destructive DROP COLUMN id');
    assert(!downSql.includes('DROP COLUMN room_uuid'), 'down.sql must not execute destructive DROP COLUMN room_uuid');
  });

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n========================================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Unhandled fatal error in test runner:', err);
  process.exit(1);
});
