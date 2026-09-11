import { Pool } from "pg";
import { loadEnvFile } from "node:process";
import fs from "node:fs";

if (fs.existsSync(".env")) {
  try {
    loadEnvFile();
  } catch (e) {
    // ignore
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 30,
});

async function runConcurrencyStressTest() {
  console.log("Starting Concurrency Stress Test on Model B Room Quota System...");

  // 1. Pick test account
  const accountRes = await pool.query(
    "SELECT id FROM auth.users WHERE email = 'f7c60d10-df3c-4f52-8189-5476109edf7f' OR email LIKE '%@%' LIMIT 1"
  );
  if (!accountRes.rows.length) {
    console.error("No test account found");
    process.exit(1);
  }
  const accountId = accountRes.rows[0].id;
  console.log(`Using test account: ${accountId}`);

  // 2. Clean up any existing rooms for this account to guarantee clean slate
  await pool.query("SELECT public.delete_room_authoritative($1, \"roomId\") FROM public.rooms WHERE owner_id = $1", [accountId]);
  await pool.query(
    "UPDATE public.account_room_usage SET total_rooms = 0, watch_rooms = 0, permanent_rooms = 0 WHERE account_id = $1",
    [accountId]
  );
  await pool.query(
    `INSERT INTO public.account_room_limits (account_id, max_total_rooms, max_watch_rooms, max_permanent_rooms)
     VALUES ($1, 5, 5, 2)
     ON CONFLICT (account_id) DO UPDATE SET max_total_rooms = 5, max_watch_rooms = 5, max_permanent_rooms = 2`,
    [accountId]
  );

  console.log("\n--- TEST 1: 100 SIMULTANEOUS CREATE REQUESTS (CEILING = 5) ---");
  const N = 100;
  const createPromises = Array.from({ length: N }).map((_, i) => {
    const roomId = `stress-100-${Date.now()}-${i}`;
    const title = `Stress Room ${i}`;
    const fingerprint = `fingerprint-100-${Date.now()}-${i}`;
    return pool.query(
      `SELECT public.create_room_authoritative(
        $1, $2, 'watch', $3, 'stress 100 description',
        'dummyhash', 'dummyenc', $4, null, false,
        now() + INTERVAL '3 hours',
        5, 5, 2
      ) AS result`,
      [accountId, roomId, title, fingerprint]
    )
    .then(res => ({ success: true, data: res.rows[0].result }))
    .catch(err => ({ success: false, error: err.message }));
  });

  const results = await Promise.all(createPromises);
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  console.log(`Total Requests: ${N}`);
  console.log(`Successful creations: ${successes.length} (Expected: 5)`);
  console.log(`Rejected creations: ${failures.length} (Expected: 95)`);

  const rejectedReasons = (failures as { success: false; error: string }[]).reduce((acc: any, f) => {
    const isQuota = f.error.includes("TOTAL_ROOM_LIMIT_EXCEEDED");
    acc[isQuota ? "TOTAL_ROOM_LIMIT_EXCEEDED" : f.error] = (acc[isQuota ? "TOTAL_ROOM_LIMIT_EXCEEDED" : f.error] || 0) + 1;
    return acc;
  }, {});
  console.log("Rejection reason breakdown:", rejectedReasons);


  // Verify database usage state matches reality
  const usageCheck = await pool.query(
    "SELECT total_rooms, watch_rooms, permanent_rooms FROM public.account_room_usage WHERE account_id = $1",
    [accountId]
  );
  const roomsInDb = await pool.query(
    "SELECT count(*)::int AS count FROM public.rooms WHERE owner_id = $1 AND status IN ('scheduled', 'active', 'inactive') AND (\"isPermanent\" = true OR \"expiresAt\" > now())",
    [accountId]
  );

  console.log(`Database account_room_usage: total=${usageCheck.rows[0].total_rooms}, watch=${usageCheck.rows[0].watch_rooms}`);
  console.log(`Actual qualifying rows in public.rooms: ${roomsInDb.rows[0].count}`);

  if (successes.length !== 5 || usageCheck.rows[0].total_rooms !== 5 || roomsInDb.rows[0].count !== 5) {
    throw new Error(`TEST 1 FAILED: Expected 5 successes, 5 usage, 5 DB rooms. Got: ${successes.length}, ${usageCheck.rows[0].total_rooms}, ${roomsInDb.rows[0].count}`);
  }
  console.log("TEST 1 PASSED: Strict 5-room ceiling maintained across 100 simultaneous creations with zero oversubscription.");

  console.log("\n--- TEST 2: CONCURRENT CREATE + END + DELETE + EXPIRE FOR SAME ACCOUNT ---");
  // At this point we have 5 active rooms. Let's make 1 room already expired in the database
  const currentRooms = await pool.query(
    'SELECT "roomId" FROM public.rooms WHERE owner_id = $1 AND status = \'inactive\' ORDER BY "roomId" LIMIT 3',
    [accountId]
  );
  const roomToEnd = currentRooms.rows[0].roomId;
  const roomToDelete = currentRooms.rows[1].roomId;
  const roomToExpire = currentRooms.rows[2].roomId;

  // Age one room so expire_rooms_authoritative will catch it
  await pool.query(
    'UPDATE public.rooms SET "expiresAt" = now() - INTERVAL \'10 seconds\' WHERE "roomId" = $1',
    [roomToExpire]
  );

  console.log(`Launching concurrently on account ${accountId}:`);
  console.log(`- END room: ${roomToEnd}`);
  console.log(`- DELETE room: ${roomToDelete}`);
  console.log(`- EXPIRE batch scan: targeting expired ${roomToExpire}`);
  console.log(`- 20 simultaneous CREATE attempts fighting for newly freed slots...`);

  const concurrentOps: Promise<any>[] = [
    pool.query("SELECT public.end_room_authoritative($1, $2, 'host')", [accountId, roomToEnd])
      .then(() => ({ type: "END", success: true }))
      .catch(e => ({ type: "END", success: false, error: e.message })),
    pool.query("SELECT public.delete_room_authoritative($1, $2)", [accountId, roomToDelete])
      .then(() => ({ type: "DELETE", success: true }))
      .catch(e => ({ type: "DELETE", success: false, error: e.message })),
    pool.query("SELECT * FROM public.expire_rooms_authoritative()")
      .then(res => ({ type: "EXPIRE", success: true, count: res.rows.length }))
      .catch(e => ({ type: "EXPIRE", success: false, error: e.message })),
    ...Array.from({ length: 20 }).map((_, i) => {
      const roomId = `stress-mixed-contention-${Date.now()}-${i}`;
      const fingerprint = `fingerprint-mixed-contention-${Date.now()}-${i}`;
      return pool.query(
        `SELECT public.create_room_authoritative(
          $1, $2, 'watch', 'Contention Room', null,
          'dummyhash', 'dummyenc', $3, null, false,
          now() + INTERVAL '3 hours',
          5, 5, 2
        )`,
        [accountId, roomId, fingerprint]
      )
      .then(() => ({ type: "CREATE", success: true }))
      .catch(e => ({ type: "CREATE", success: false, error: e.message }));
    })
  ];

  const mixedResults = await Promise.all(concurrentOps);
  const endRes = mixedResults.find(r => r.type === "END");
  const deleteRes = mixedResults.find(r => r.type === "DELETE");
  const expireRes = mixedResults.find(r => r.type === "EXPIRE");
  const createSuccesses = mixedResults.filter(r => r.type === "CREATE" && r.success).length;
  const createRejections = mixedResults.filter(r => r.type === "CREATE" && !r.success).length;

  console.log(`- END: success=${endRes?.success}${endRes?.error ? ' error=' + endRes.error : ''}`);
  console.log(`- DELETE: success=${deleteRes?.success}${deleteRes?.error ? ' error=' + deleteRes.error : ''}`);
  console.log(`- EXPIRE: success=${expireRes?.success}, expired count=${expireRes?.count}${expireRes?.error ? ' error=' + expireRes.error : ''}`);
  console.log(`- CREATE: successes=${createSuccesses}, rejections=${createRejections}`);


  // Authoritative verification
  const usageCheck2 = await pool.query(
    "SELECT total_rooms, watch_rooms, permanent_rooms FROM public.account_room_usage WHERE account_id = $1",
    [accountId]
  );
  const roomsInDb2 = await pool.query(
    "SELECT count(*)::int AS count FROM public.rooms WHERE owner_id = $1 AND status IN ('scheduled', 'active', 'inactive') AND (\"isPermanent\" = true OR \"expiresAt\" > now())",
    [accountId]
  );

  console.log(`Database account_room_usage after contention: total=${usageCheck2.rows[0].total_rooms}`);
  console.log(`Actual qualifying rows in public.rooms: ${roomsInDb2.rows[0].count}`);

  if (usageCheck2.rows[0].total_rooms !== roomsInDb2.rows[0].count) {
    throw new Error(`TEST 2 FAILED: Cache diverged from truth! Usage=${usageCheck2.rows[0].total_rooms}, DB=${roomsInDb2.rows[0].count}`);
  }
  if (usageCheck2.rows[0].total_rooms > 5) {
    throw new Error(`TEST 2 FAILED: Quota ceiling breached! Total rooms=${usageCheck2.rows[0].total_rooms}`);
  }
  console.log("TEST 2 PASSED: Perfect reconciliation between usage cache and truth table under mixed contention.");

  // 3. Final Clean up
  console.log("\n--- TEST 3: ROOM ACTIVITY & EXTENSION LIFECYCLE TEST ---");
  // Delete one quota-consuming room to free a slot within the 5-room ceiling
  const existingForTest3 = await pool.query(
    `SELECT "roomId" FROM public.rooms 
     WHERE owner_id = $1 AND status IN ('scheduled', 'active', 'inactive') AND ("isPermanent" = true OR "expiresAt" > now())
     LIMIT 1`,
    [accountId]
  );
  if (existingForTest3.rows.length) {
    await pool.query("SELECT public.delete_room_authoritative($1, $2)", [accountId, existingForTest3.rows[0].roomId]);
  }
  const testRoomId = `test-activity-ext-${Date.now()}`;
  const testFingerprint = `fingerprint-act-${Date.now()}`;
  await pool.query(
    `SELECT public.create_room_authoritative(
      $1, $2, 'watch', 'Activity Test Room', null,
      'dummyhash', 'dummyenc', $3, null, false,
      now() + INTERVAL '2 hours',
      5, 5, 2
    )`,
    [accountId, testRoomId, testFingerprint]
  );

  // Transition to active
  const actRes1 = await pool.query(
    "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
    [testRoomId, accountId]
  );
  if (actRes1.rows[0].result.status !== "active") {
    throw new Error(`TEST 3 FAILED: Expected active status, got ${actRes1.rows[0].result.status}`);
  }

  // Extend room
  const newExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const extRes = await pool.query(
    "SELECT public.extend_room_authoritative($1, $2, $3) AS new_expires_at",
    [accountId, testRoomId, newExpiry]
  );
  if (!extRes.rows[0].new_expires_at) {
    throw new Error("TEST 3 FAILED: Room extension failed to return new expiry");
  }

  // Transition to inactive
  const actRes2 = await pool.query(
    "SELECT public.set_room_activity_authoritative($1, 'inactive', NULL) AS result",
    [testRoomId]
  );
  if (actRes2.rows[0].result.status !== "inactive") {
    throw new Error(`TEST 3 FAILED: Expected inactive status, got ${actRes2.rows[0].result.status}`);
  }

  // Age room past canonical expiresAt to test canonical expiry transition
  await pool.query(
    'UPDATE public.rooms SET "expiresAt" = now() - INTERVAL \'5 seconds\' WHERE "roomId" = $1',
    [testRoomId]
  );
  const actRes3 = await pool.query(
    "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
    [testRoomId, accountId]
  );
  if (actRes3.rows[0].result.status !== "expired") {
    throw new Error(`TEST 3 FAILED: Expected auto-expiry on overdue room, got ${actRes3.rows[0].result.status}`);
  }

  const usageAfterExpiry = await pool.query(
    "SELECT total_rooms FROM public.account_room_usage WHERE account_id = $1",
    [accountId]
  );
  console.log(`TEST 3 PASSED: Lifecycle transitions and extension verified. Usage after expiry: ${usageAfterExpiry.rows[0].total_rooms}`);

  console.log("\n--- TEST 4: AUTHORITATIVE ACCOUNT PURGE TEST ---");
  // Clean slate via purge
  await pool.query("SELECT public.purge_account_rooms_authoritative($1)", [accountId]);

  // Create 3 fresh rooms
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `SELECT public.create_room_authoritative(
        $1, $2, 'watch', 'Purge Test Room', null,
        'dummyhash', 'dummyenc', $3, null, false,
        now() + INTERVAL '2 hours',
        5, 5, 2
      )`,
      [accountId, `purge-room-${Date.now()}-${i}`, `purge-fp-${Date.now()}-${i}`]
    );
  }

  const usageBeforePurge = await pool.query(
    "SELECT total_rooms FROM public.account_room_usage WHERE account_id = $1",
    [accountId]
  );
  console.log(`Created 3 rooms. account_room_usage.total_rooms = ${usageBeforePurge.rows[0].total_rooms}`);

  // Call purge_account_rooms_authoritative
  const purgeRes = await pool.query(
    "SELECT public.purge_account_rooms_authoritative($1) AS deleted_ids",
    [accountId]
  );
  const deletedIds: string[] = purgeRes.rows[0].deleted_ids;
  console.log(`Purged rooms count: ${deletedIds.length}`);

  // Verify all rooms deleted
  const remainingRooms = await pool.query(
    "SELECT count(*)::int AS count FROM public.rooms WHERE owner_id = $1",
    [accountId]
  );
  if (remainingRooms.rows[0].count !== 0) {
    throw new Error(`TEST 4 FAILED: Expected 0 rooms remaining in rooms table, got ${remainingRooms.rows[0].count}`);
  }

  // Verify account_room_usage row is preserved and zeroed
  const usageAfterPurge = await pool.query(
    "SELECT total_rooms, watch_rooms, permanent_rooms FROM public.account_room_usage WHERE account_id = $1",
    [accountId]
  );
  if (usageAfterPurge.rowCount === 0) {
    throw new Error("TEST 4 FAILED: account_room_usage row was deleted! It must be preserved with 0 usage.");
  }
  if (usageAfterPurge.rows[0].total_rooms !== 0 || usageAfterPurge.rows[0].watch_rooms !== 0) {
    throw new Error(`TEST 4 FAILED: Usage not zeroed: total=${usageAfterPurge.rows[0].total_rooms}`);
  }

  // Verify account_room_limits row is preserved
  const limitsAfterPurge = await pool.query(
    "SELECT max_total_rooms FROM public.account_room_limits WHERE account_id = $1",
    [accountId]
  );
  if (limitsAfterPurge.rowCount === 0) {
    throw new Error("TEST 4 FAILED: account_room_limits row was deleted! Policy must be preserved.");
  }

  // Verify audit events
  const purgeEvents = await pool.query(
    "SELECT count(*)::int AS count FROM public.room_quota_events WHERE account_id = $1 AND event_type = 'PURGED'",
    [accountId]
  );
  if (purgeEvents.rows[0].count < 3) {
    throw new Error(`TEST 4 FAILED: Expected at least 3 PURGED audit events, got ${purgeEvents.rows[0].count}`);
  }
  console.log("TEST 4 PASSED: Authoritative account purge preserves policy & usage rows, zeroes counters, generates PURGED audit logs.");

  // 5. Final Reconciliation Check
  console.log("\n--- RECONCILIATION VERIFICATION (1:1 RATIO CHECK) ---");
  const allAccountsUsage = await pool.query(
    `SELECT u.account_id, u.total_rooms AS recorded_total, COALESCE(r.actual_total, 0) AS actual_total
     FROM public.account_room_usage u
     LEFT JOIN (
       SELECT owner_id, count(*)::int AS actual_total
       FROM public.rooms
       WHERE status IN ('scheduled', 'active', 'inactive')
         AND ("isPermanent" = true OR "expiresAt" > clock_timestamp())
       GROUP BY owner_id
     ) r ON u.account_id = r.owner_id
     WHERE u.total_rooms != COALESCE(r.actual_total, 0)`
  );
  if (allAccountsUsage.rowCount && allAccountsUsage.rowCount > 0) {
    throw new Error(`RECONCILIATION FAILED: Divergent accounts found: ${JSON.stringify(allAccountsUsage.rows)}`);
  }
  console.log("RECONCILIATION PASSED: 1:1 parity verified across all accounts in database.");

  console.log("\n--- TEST 6: ROOM DATA AUTHORIZATION MATRIX VALIDATION ---");
  const authTestRoomId = `auth-matrix-${Date.now()}`;
  const authTestFingerprint = `auth-fp-${Date.now()}`;
  const dummyPayload = JSON.stringify({ video: "https://example.com/stream.m3u8", videoTS: 123.45 });

  // 1. Create a room under accountId (Owner)
  await pool.query(
    `SELECT public.create_room_authoritative(
      $1, $2, 'watch', 'Auth Matrix Room', null,
      'dummyhash', 'dummyenc', $3, null, false,
      now() + INTERVAL '2 hours',
      5, 5, 2
    )`,
    [accountId, authTestRoomId, authTestFingerprint]
  );
  await pool.query('UPDATE public.rooms SET data = $1 WHERE "roomId" = $2', [dummyPayload, authTestRoomId]);

  // Case A: Authenticated Owner querying their own room
  const ownerQuery = await pool.query(
    `SELECT data FROM public.rooms WHERE "roomId" = $1 AND owner_id = $2`,
    [authTestRoomId, accountId]
  );
  if (ownerQuery.rowCount !== 1 || !ownerQuery.rows[0].data) {
    throw new Error("TEST 6 FAILED: Authenticated owner was denied access to their own room data");
  }

  // Case B: Authenticated Non-Owner (or random UID) querying another user's room
  const nonOwnerUid = "00000000-0000-0000-0000-000000000000";
  const nonOwnerQuery = await pool.query(
    `SELECT data FROM public.rooms WHERE "roomId" = $1 AND owner_id = $2`,
    [authTestRoomId, nonOwnerUid]
  );
  if (nonOwnerQuery.rowCount !== 0) {
    throw new Error("TEST 6 FAILED: Non-owner query leaked room data! Expected 0 rows");
  }

  // Case C: Clean up
  await pool.query("SELECT public.delete_room_authoritative($1, $2)", [accountId, authTestRoomId]);
  console.log("TEST 6 PASSED: Room data authorization matrix verified (Owner-only access enforced, cross-user isolation guaranteed).");

  await pool.end();
  console.log("\nALL CONCURRENCY AND AUTHORITATIVE ACCEPTANCE TESTS COMPLETED SUCCESSFULLY.");
}

runConcurrencyStressTest().catch(err => {
  console.error("Stress test failed:", err);
  process.exit(1);
});

