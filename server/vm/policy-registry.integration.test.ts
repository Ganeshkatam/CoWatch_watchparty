import assert from "node:assert/strict";
import config from "../config.ts";
import { postgres } from "../utils/postgres.ts";
import { supabaseAdmin } from "../utils/supabase.ts";
import { providerRegistry } from "./provider-registry.ts";
import {
  VBrowserPolicyService,
  VBrowserPolicyError,
  vBrowserPolicyService,
} from "./policy.ts";
import type { VMManager, AssignedVM } from "./base.ts";

/**
 * Integration test covering the complete seam between:
 *   DB provider/pool
 *   -> policy allocation
 *   -> registry resolution
 *   -> mocked BaseVMManager.assignVM()
 *   -> successful reservation
 *   -> release via persisted poolId
 */
async function runIntegrationTest() {
  console.log("Starting Policy-Registry complete seam integration test...");

  // Backup original environment and dependencies
  const origSupabaseUrl = config.SUPABASE_URL;
  const origVBrowserEnabled = config.VIRTUAL_BROWSER_ENABLED;
  const origSessionSeconds = config.VBROWSER_SESSION_SECONDS;
  const origSessionSecondsLarge = config.VBROWSER_SESSION_SECONDS_LARGE;

  if (!postgres) {
    throw new Error("postgres pool instance is required for integration test");
  }

  const origPostgresQuery = postgres.query.bind(postgres);
  const origGetUserById = supabaseAdmin?.auth?.admin?.getUserById?.bind(
    supabaseAdmin.auth.admin
  );

  try {
    // -------------------------------------------------------------
    // Global test mocks setup
    // -------------------------------------------------------------
    config.SUPABASE_URL = "https://mock.supabase.co";
    config.VIRTUAL_BROWSER_ENABLED = true;
    config.VBROWSER_SESSION_SECONDS = 10800;
    config.VBROWSER_SESSION_SECONDS_LARGE = 86400;

    // Mock Supabase Auth to return a valid, verified user
    if (supabaseAdmin?.auth?.admin) {
      supabaseAdmin.auth.admin.getUserById = async (uid: string) => {
        return {
          data: {
            user: {
              id: uid,
              email: "tester@example.com",
              app_metadata: { provider: "email" },
              email_confirmed_at: "2026-01-01T00:00:00Z",
            } as any,
          },
          error: null,
        };
      };
    }

    // =============================================================
    // Scenario 1: Complete Happy Path (Allocate -> Assign -> Release)
    // =============================================================
    console.log("Scenario 1: Complete happy path: DB resolution -> registry -> assignVM -> release...");

    providerRegistry.clear();

    let assignVMCalls = 0;
    let resetVMCalls = 0;
    let assignedRoomId = "";
    let assignedUid = "";
    let resetVmId = "";
    let resetRoomId = "";

    const mockHetznerUS: VMManager = {
      id: "Hetzner",
      getIsLarge: () => false,
      getRegion: () => "US",
      getPoolName: () => "HetznerUS",
      assignVM: async (roomId: string, uid?: string): Promise<AssignedVM> => {
        assignVMCalls++;
        assignedRoomId = roomId;
        assignedUid = uid || "";
        return {
          id: "vm-hetzner-101",
          host: "10.0.0.1:5100",
          pass: "secretpass",
          provider: "Hetzner",
          large: false,
          region: "US",
          assignTime: Date.now(),
        };
      },
      resetVM: async (vmId: string, roomId?: string): Promise<void> => {
        resetVMCalls++;
        resetVmId = vmId;
        resetRoomId = roomId || "";
      },
    } as unknown as VMManager;

    // Register under canonical pool name matching manager.getPoolName() and DB vbrowser_pools.id
    providerRegistry.register("HetznerUS", mockHetznerUS);

    const executedQueries: Array<{ sql: string; params?: any[] }> = [];

    postgres.query = (async (sql: string | any, params?: any[]) => {
      const sqlText = typeof sql === "string" ? sql : sql.text;
      executedQueries.push({ sql: sqlText, params });

      // Query 1: DB provider & pool lookup
      if (sqlText.includes("FROM vbrowser_providers p") && sqlText.includes("JOIN vbrowser_pools q")) {
        return {
          rows: [
            {
              provider_id: "hetzner",
              p_enabled: true,
              p_lifecycle: "ENABLED",
              p_max_concurrent: 10,
              p_max_user: 2,
              p_max_room: 1,
              p_max_large: 2,
              p_max_dur: 10800,
              p_max_large_dur: 86400,
              pool_id: "HetznerUS",
              q_enabled: true,
              q_lifecycle: "ENABLED",
              q_limit_size: 10,
              q_max_user: 2,
              q_max_room: 1,
              q_max_large: 2,
              q_max_dur: 10800,
              q_max_large_dur: 86400,
            },
          ],
        };
      }

      // Query 2: Atomic reservation
      if (sqlText.includes("reserve_vbrowser_capacity")) {
        return {
          rows: [{ id: "res-hetzner-999" }],
        };
      }

      // Query 3 & 4: Updates to vbrowser_reservations (ALLOCATED, RELEASED, FAILED)
      if (sqlText.includes("UPDATE vbrowser_reservations")) {
        return { rows: [] };
      }

      return { rows: [] };
    }) as any;

    // Execute policy allocation
    const allocateResult = await vBrowserPolicyService.allocate({
      roomId: "room-happy-path",
      uid: "user-happy-path",
      isLarge: false,
      region: "US",
    });

    // 1. Verify allocation result structure
    assert.strictEqual(allocateResult.reservationId, "res-hetzner-999");
    assert.strictEqual(allocateResult.providerId, "hetzner");
    assert.strictEqual(allocateResult.poolId, "HetznerUS");
    assert.strictEqual(allocateResult.duration, 10800);
    assert.strictEqual(allocateResult.assignment.id, "vm-hetzner-101");
    assert.strictEqual(allocateResult.assignment.provider, "Hetzner");

    // 2. Verify mocked manager assignVM was invoked with correct arguments
    assert.strictEqual(assignVMCalls, 1);
    assert.strictEqual(assignedRoomId, "room-happy-path");
    assert.strictEqual(assignedUid, "user-happy-path");

    // 3. Verify DB reservation was confirmed to ALLOCATED status
    const allocatedQuery = executedQueries.find((q) =>
      q.sql.includes("SET status = 'ALLOCATED'")
    );
    assert.ok(allocatedQuery, "Must update reservation status to ALLOCATED in DB");
    assert.deepStrictEqual(allocatedQuery?.params, ["res-hetzner-999"]);

    // 4. Verify release follows the persisted poolId (simulating Room.stopVBrowserInternal)
    const releaseManager = providerRegistry.resolve(allocateResult.poolId);
    assert.strictEqual(
      releaseManager,
      mockHetznerUS,
      "ProviderRegistry.resolve(poolId) must resolve the exact manager from persisted poolId"
    );

    // Release via adapter
    await releaseManager.resetVM(allocateResult.assignment.id, "room-happy-path");
    assert.strictEqual(resetVMCalls, 1);
    assert.strictEqual(resetVmId, "vm-hetzner-101");
    assert.strictEqual(resetRoomId, "room-happy-path");

    // Release via policy service
    await vBrowserPolicyService.release(allocateResult.reservationId, "RELEASED");

    const releasedQuery = executedQueries.find(
      (q) =>
        q.sql.includes("UPDATE vbrowser_reservations") &&
        q.params?.[0] === "RELEASED" &&
        q.params?.[2] === "res-hetzner-999"
    );
    assert.ok(releasedQuery, "Must update reservation status to RELEASED in DB");

    // =============================================================
    // Scenario 2: Fail-Closed when DB Pool is Unregistered
    // =============================================================
    console.log("Scenario 2: Fail-closed on unregistered pool (Blocker 1 seam defense)...");

    providerRegistry.clear(); // Empty registry
    executedQueries.length = 0;

    await assert.rejects(
      async () => {
        await vBrowserPolicyService.allocate({
          roomId: "room-unregistered-pool",
          uid: "user-happy-path",
          isLarge: false,
          region: "US",
        });
      },
      (err: any) => {
        return err instanceof VBrowserPolicyError && err.code === "VBROWSER_UNAVAILABLE";
      },
      "Allocation must reject with VBROWSER_UNAVAILABLE if pool is not registered"
    );

    // Verify reservation was NEVER attempted in DB
    const reserveAttempt = executedQueries.find((q) =>
      q.sql.includes("reserve_vbrowser_capacity")
    );
    assert.strictEqual(reserveAttempt, undefined, "Must not reserve capacity when adapter is unresolved");

    // =============================================================
    // Scenario 3: Adapter Failure Rollback (Cleans up reservation)
    // =============================================================
    console.log("Scenario 3: Adapter assignVM failure rolls back DB reservation...");

    providerRegistry.clear();
    executedQueries.length = 0;

    const failingManager: VMManager = {
      id: "Hetzner",
      getIsLarge: () => false,
      getRegion: () => "US",
      getPoolName: () => "HetznerUS",
      assignVM: async () => {
        throw new Error("Underlying infrastructure spawn failed");
      },
      resetVM: async () => {},
    } as unknown as VMManager;

    providerRegistry.register("HetznerUS", failingManager);

    await assert.rejects(
      async () => {
        await vBrowserPolicyService.allocate({
          roomId: "room-adapter-failure",
          uid: "user-happy-path",
          isLarge: false,
          region: "US",
        });
      },
      (err: any) => {
        return err instanceof VBrowserPolicyError && err.code === "VBROWSER_UNAVAILABLE";
      },
      "Must throw VBROWSER_UNAVAILABLE upon adapter failure"
    );

    // Verify rollback query was executed with ADAPTER_FAILURE
    const rollbackQuery = executedQueries.find(
      (q) =>
        q.sql.includes("UPDATE vbrowser_reservations") &&
        q.params?.[0] === "FAILED" &&
        q.params?.[1] === "ADAPTER_FAILURE"
    );
    assert.ok(rollbackQuery, "Must mark reservation as FAILED with ADAPTER_FAILURE on assignVM error");

    // =============================================================
    // Scenario 4: Release by Room ID
    // =============================================================
    console.log("Scenario 4: Room-level reservation cleanup (releaseByRoom)...");

    executedQueries.length = 0;
    await vBrowserPolicyService.releaseByRoom("room-cleanup-target");

    const releaseByRoomQuery = executedQueries.find(
      (q) =>
        q.sql.includes("UPDATE vbrowser_reservations") &&
        q.sql.includes("room_id = $1") &&
        q.params?.[0] === "room-cleanup-target"
    );
    assert.ok(releaseByRoomQuery, "Must release all room reservations by room_id");

    console.log("All Policy-Registry complete seam integration tests passed successfully!");
  } finally {
    // Restore original configuration and dependencies
    config.SUPABASE_URL = origSupabaseUrl;
    config.VIRTUAL_BROWSER_ENABLED = origVBrowserEnabled;
    config.VBROWSER_SESSION_SECONDS = origSessionSeconds;
    config.VBROWSER_SESSION_SECONDS_LARGE = origSessionSecondsLarge;

    postgres.query = origPostgresQuery;
    if (supabaseAdmin?.auth?.admin && origGetUserById) {
      supabaseAdmin.auth.admin.getUserById = origGetUserById;
    }
    providerRegistry.clear();
  }
}

runIntegrationTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Integration test failed:", err);
    process.exit(1);
  });
