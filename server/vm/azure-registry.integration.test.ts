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
import { Azure } from "./azure.ts";
import type { AzureArmClient } from "./azure-arm-client.ts";
import type { AssignedVM, VMManager } from "./base.ts";

/**
 * Complete integration seam test for Azure:
 *   DB provider/pool ('azure' / 'AzureUS')
 *   -> policy allocation (VBrowserPolicyService.allocate)
 *   -> registry resolution (ProviderRegistry.resolve("AzureUS"))
 *   -> Azure VMManager.assignVM()
 *   -> successful reservation confirmation
 *   -> release via persisted poolId
 */
async function runAzureIntegrationSuite() {
  console.log("Starting Azure ProviderRegistry seam integration test...");

  const origSupabaseUrl = config.SUPABASE_URL;
  const origVBrowserEnabled = config.VIRTUAL_BROWSER_ENABLED;
  const origSessionSeconds = config.VBROWSER_SESSION_SECONDS;
  const origSessionSecondsLarge = config.VBROWSER_SESSION_SECONDS_LARGE;
  const origGateway = config.AZURE_GATEWAY;

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
    config.AZURE_GATEWAY = "https://gw-azure.cowatch.tv";

    if (supabaseAdmin?.auth?.admin) {
      supabaseAdmin.auth.admin.getUserById = async (uid: string) => {
        return {
          data: {
            user: {
              id: uid,
              email: "azure-tester@example.com",
              app_metadata: { provider: "email" },
              email_confirmed_at: "2026-01-01T00:00:00Z",
            } as any,
          },
          error: null,
        };
      };
    }

    // =============================================================
    // Scenario 1: Complete Azure Happy Path (Allocate -> Assign -> Release)
    // =============================================================
    console.log("Scenario 1: Complete Azure path: DB resolution -> registry -> assignVM -> release...");

    providerRegistry.clear();

    let assignVMCallCount = 0;
    let resetVMCallCount = 0;
    let assignedRoomId = "";
    let assignedUid = "";
    let resetVmId = "";

    // Create Azure manager with mocked ARM client
    const mockArmClient: Partial<AzureArmClient> = {
      createPublicIp: async (name, loc, tags) => ({ id: "pip-id" }),
      createNic: async (name, loc, sub, pip, tags) => ({ id: "nic-id" }),
      createVm: async (p) => ({ id: p.name }),
      deleteVmWithDependencies: async (name) => {},
      restartVm: async (name) => {},
      getVmNetworking: async (name) => ({
        id: name,
        ip: "20.60.120.240",
        rawVm: { name },
      }),
    };

    const azurePoolConfig = {
      provider: "Azure",
      isLarge: false,
      region: "US" as const,
      limitSize: 10,
      minSize: 0,
      hostname: undefined,
    };

    const azureManager = new Azure(azurePoolConfig, mockArmClient as AzureArmClient);

    // Override assignVM and resetVM on instance to track policy invocation
    azureManager.assignVM = async (roomId: string, uid: string): Promise<AssignedVM> => {
      assignVMCallCount++;
      assignedRoomId = roomId;
      assignedUid = uid;
      return {
        id: "azure-vm-prod-001",
        host: "https://gw-azure.cowatch.tv/?ip=20.60.120.240",
        pass: "azure-secret-pass",
        provider: "Azure",
        large: false,
        region: "US",
        assignTime: Date.now(),
      };
    };

    azureManager.resetVM = async (vmId: string, roomId?: string): Promise<void> => {
      resetVMCallCount++;
      resetVmId = vmId;
    };

    // Register under canonical key "AzureUS" matching manager.getPoolName() and DB vbrowser_pools.id
    providerRegistry.register(azureManager.getPoolName(), azureManager);
    assert.strictEqual(azureManager.getPoolName(), "AzureUS");

    const executedQueries: Array<{ sql: string; params?: any[] }> = [];

    postgres.query = (async (sql: string | any, params?: any[]) => {
      const sqlText = typeof sql === "string" ? sql : sql.text;
      executedQueries.push({ sql: sqlText, params });

      // DB resolution query for Azure
      if (sqlText.includes("FROM vbrowser_providers p") && sqlText.includes("JOIN vbrowser_pools q")) {
        return {
          rows: [
            {
              provider_id: "azure",
              p_enabled: true,
              p_lifecycle: "ENABLED",
              p_max_concurrent: 10,
              p_max_user: 2,
              p_max_room: 1,
              p_max_large: 2,
              p_max_dur: 10800,
              p_max_large_dur: 86400,
              pool_id: "AzureUS",
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

      if (sqlText.includes("reserve_vbrowser_capacity")) {
        return {
          rows: [{ id: "res-azure-777" }],
        };
      }

      if (sqlText.includes("UPDATE vbrowser_reservations")) {
        return { rows: [] };
      }

      return { rows: [] };
    }) as any;

    // Execute policy allocation
    const allocateResult = await vBrowserPolicyService.allocate({
      roomId: "room-azure-session",
      uid: "user-azure-subscriber",
      isLarge: false,
      region: "US",
    });

    // Verify allocation result
    assert.strictEqual(allocateResult.reservationId, "res-azure-777");
    assert.strictEqual(allocateResult.providerId, "azure");
    assert.strictEqual(allocateResult.poolId, "AzureUS");
    assert.strictEqual(allocateResult.duration, 10800);
    assert.strictEqual(allocateResult.assignment.id, "azure-vm-prod-001");
    assert.strictEqual(allocateResult.assignment.provider, "Azure");

    // Verify Azure assignVM invocation
    assert.strictEqual(assignVMCallCount, 1);
    assert.strictEqual(assignedRoomId, "room-azure-session");
    assert.strictEqual(assignedUid, "user-azure-subscriber");

    // Verify reservation was confirmed in DB to ALLOCATED
    const allocQuery = executedQueries.find((q) =>
      q.sql.includes("SET status = 'ALLOCATED'")
    );
    assert.ok(allocQuery, "Must confirm reservation as ALLOCATED in DB");
    assert.deepStrictEqual(allocQuery?.params, ["res-azure-777"]);

    // Simulate release via persisted poolId ("AzureUS") as done by Room.stopVBrowserInternal
    const resolvedManager = providerRegistry.resolve(allocateResult.poolId);
    assert.strictEqual(
      resolvedManager,
      azureManager,
      "Registry must resolve the concrete Azure manager using persisted poolId"
    );

    await resolvedManager.resetVM(allocateResult.assignment.id, "room-azure-session");
    assert.strictEqual(resetVMCallCount, 1);
    assert.strictEqual(resetVmId, "azure-vm-prod-001");

    await vBrowserPolicyService.release(allocateResult.reservationId, "RELEASED");

    const releaseQuery = executedQueries.find(
      (q) =>
        q.sql.includes("UPDATE vbrowser_reservations") &&
        q.params?.[0] === "RELEASED" &&
        q.params?.[2] === "res-azure-777"
    );
    assert.ok(releaseQuery, "Must update reservation status to RELEASED in DB");

    // =============================================================
    // Scenario 2: Rollback on Azure VM assignment failure
    // =============================================================
    console.log("Scenario 2: Rollback on Azure VM assignment failure...");

    providerRegistry.clear();
    executedQueries.length = 0;

    const failingAzure = new Azure(azurePoolConfig, mockArmClient as AzureArmClient);
    failingAzure.assignVM = async () => {
      throw new Error("Azure compute quota exceeded for standard B2s in eastus");
    };

    providerRegistry.register("AzureUS", failingAzure);

    await assert.rejects(
      async () => {
        await vBrowserPolicyService.allocate({
          roomId: "room-azure-failing",
          uid: "user-azure-subscriber",
          isLarge: false,
          region: "US",
        });
      },
      (err: any) => {
        return err instanceof VBrowserPolicyError && err.code === "VBROWSER_UNAVAILABLE";
      },
      "Must throw VBROWSER_UNAVAILABLE on Azure adapter failure"
    );

    // Verify reservation rollback was executed with failure_reason = ADAPTER_FAILURE
    const rollbackQuery = executedQueries.find(
      (q) =>
        q.sql.includes("UPDATE vbrowser_reservations") &&
        q.params?.[0] === "FAILED" &&
        q.params?.[1] === "ADAPTER_FAILURE"
    );
    assert.ok(rollbackQuery, "Must mark DB reservation as FAILED with ADAPTER_FAILURE on assignment error");

    console.log("All Azure ProviderRegistry seam integration tests passed successfully!");
  } finally {
    config.SUPABASE_URL = origSupabaseUrl;
    config.VIRTUAL_BROWSER_ENABLED = origVBrowserEnabled;
    config.VBROWSER_SESSION_SECONDS = origSessionSeconds;
    config.VBROWSER_SESSION_SECONDS_LARGE = origSessionSecondsLarge;
    config.AZURE_GATEWAY = origGateway;

    postgres.query = origPostgresQuery;
    if (supabaseAdmin?.auth?.admin && origGetUserById) {
      supabaseAdmin.auth.admin.getUserById = origGetUserById;
    }
    providerRegistry.clear();
  }
}

runAzureIntegrationSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Azure integration suite failed:", err);
    process.exit(1);
  });
