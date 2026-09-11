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
  console.log("\nCleaning up stress test rooms...");
  const cleanupRooms = await pool.query('SELECT "roomId" FROM public.rooms WHERE owner_id = $1', [accountId]);
  for (const r of cleanupRooms.rows) {
    await pool.query("SELECT public.delete_room_authoritative($1, $2)", [accountId, r.roomId]).catch(() => {});
  }
  const finalUsage = await pool.query(
    "SELECT total_rooms FROM public.account_room_usage WHERE account_id = $1",
    [accountId]
  );
  console.log(`Cleaned up. Final account_room_usage: total=${finalUsage.rows[0].total_rooms}`);

  await pool.end();
  console.log("\nALL CONCURRENCY TESTS COMPLETED SUCCESSFULLY.");
}

runConcurrencyStressTest().catch(err => {
  console.error("Stress test failed:", err);
  process.exit(1);
});

