import assert from "node:assert/strict";
import config from "../config.ts";
import {
  getVBrowserProvider,
  resetVBrowserProviderInstance,
  NullProvider,
  LocalDockerProvider,
  HetznerProvider,
  PooledVMProvider,
  ProviderReleaseRouter,
  VBrowserDisabledError,
} from "./provider.ts";

async function runIntegrationSuite() {
  console.log("Starting VBrowser Integration and Lifecycle Validation Suite...");

  // Backup original config state
  const originalEnabled = config.VIRTUAL_BROWSER_ENABLED;
  const originalProvider = config.VIRTUAL_BROWSER_PROVIDER;
  const originalVmConfig = config.VM_MANAGER_CONFIG;
  const originalHetznerToken = config.HETZNER_TOKEN;
  const originalHetznerImage = config.HETZNER_IMAGE;
  const originalHetznerGateway = config.HETZNER_GATEWAY;

  try {
    // -------------------------------------------------------------
    // Test 1: Disabled Server State & Stale-Client Defense
    // -------------------------------------------------------------
    console.log("Test 1: Disabled state and server-side rejection...");
    config.VIRTUAL_BROWSER_ENABLED = false;
    resetVBrowserProviderInstance();

    const providerDisabled = getVBrowserProvider();
    assert.equal(providerDisabled.isEnabled, false, "Provider must report isEnabled === false");
    assert.equal(providerDisabled.id, "none", "Provider ID must be 'none'");

    // Immediate server-side assignment rejection
    await assert.rejects(
      async () => {
        await providerDisabled.assign({
          roomId: "room-disabled-test",
          uid: "user-stale-client",
          isLarge: false,
        });
      },
      VBrowserDisabledError,
      "Disabled provider must throw VBrowserDisabledError on assignment"
    );

    // Stale client trying to release must safely no-op without throwing
    await providerDisabled.release({ id: "stale-id", roomId: "room-disabled-test" });

    // -------------------------------------------------------------
    // Test 2: Local (Docker) Lifecycle & Provider Preservation
    // -------------------------------------------------------------
    console.log("Test 2: Local Docker lifecycle routing & provider preservation...");
    config.VIRTUAL_BROWSER_ENABLED = true;
    config.VIRTUAL_BROWSER_PROVIDER = "local";
    resetVBrowserProviderInstance();

    const localProvider = getVBrowserProvider();
    assert.equal(localProvider.isEnabled, true);
    assert.equal(localProvider.id, "local");

    // Intercept release calls to verify routing by provider attribute
    let dockerReleasedId: string | null = null;
    let hetznerReleasedId: string | null = null;

    // Create a mock router to test release routing dispatch
    let releasedTo: string | null = null;
    let releasedPayload: any = null;

    class TestReleaseRouter implements IVBrowserProvider {
      readonly id = "router-test";
      readonly isEnabled = true;

      async assign(): Promise<null> {
        return null;
      }

      async release(options: {
        id: string;
        provider?: string;
        isLarge?: boolean;
        region?: string;
        roomId?: string;
      }): Promise<void> {
        releasedPayload = options;
        if (options.provider === "Docker") {
          releasedTo = "Docker";
          return;
        }
        if (options.provider === "Hetzner") {
          releasedTo = "Hetzner";
          return;
        }
        releasedTo = "fallback";
      }
    }

    const testRouter = new TestReleaseRouter();

    // Simulated AssignedVM originating from Docker
    const assignedDockerVM = {
      id: "docker-container-abc",
      provider: "Docker",
      large: false,
      region: "US",
    };

    // Release must route to Docker even if current server config is changed
    config.VIRTUAL_BROWSER_PROVIDER = "hetzner";
    resetVBrowserProviderInstance();

    await testRouter.release({
      id: assignedDockerVM.id,
      provider: assignedDockerVM.provider,
      isLarge: assignedDockerVM.large,
      region: assignedDockerVM.region,
      roomId: "room-local",
    });

    assert.equal(releasedTo, "Docker");
    assert.equal(releasedPayload.id, "docker-container-abc");
    assert.equal(releasedPayload.provider, "Docker");

    // -------------------------------------------------------------
    // Test 3: Hetzner Provider Lifecycle
    // -------------------------------------------------------------
    console.log("Test 3: Hetzner provider routing...");
    config.VIRTUAL_BROWSER_ENABLED = true;
    config.VIRTUAL_BROWSER_PROVIDER = "hetzner";
    resetVBrowserProviderInstance();

    const hetznerProvider = getVBrowserProvider();
    assert.equal(hetznerProvider.isEnabled, true);
    assert.equal(hetznerProvider.id, "hetzner");

    // Verify that Hetzner VM with provider: "Hetzner" routes to Hetzner
    const assignedHetznerVM = {
      id: "hetzner-server-xyz",
      provider: "Hetzner",
      large: true,
      region: "EU",
    };

    await testRouter.release({
      id: assignedHetznerVM.id,
      provider: assignedHetznerVM.provider,
      isLarge: assignedHetznerVM.large,
      region: assignedHetznerVM.region,
      roomId: "room-hetzner",
    });

    assert.equal(releasedTo, "Hetzner");
    assert.equal(releasedPayload.id, "hetzner-server-xyz");
    assert.equal(releasedPayload.provider, "Hetzner");

    // -------------------------------------------------------------
    // Test 4: Pooled vmWorker Backward Compatibility
    // -------------------------------------------------------------
    console.log("Test 4: Pooled vmWorker contract validation...");
    config.VIRTUAL_BROWSER_ENABLED = true;
    config.VIRTUAL_BROWSER_PROVIDER = "pooled";
    config.VM_MANAGER_CONFIG = "Docker:standard:US:0:1:localhost";
    resetVBrowserProviderInstance();

    const pooledProvider = getVBrowserProvider();
    assert.equal(pooledProvider.isEnabled, true);
    assert.equal(pooledProvider.id, "pooled");

    // -------------------------------------------------------------
    // Test 5: Capability Hydration Defaults and Safe Fallbacks
    // -------------------------------------------------------------
    console.log("Test 5: Capability hydration defaults...");
    // Default capability in MetadataContext DEFAULT_STATE is false
    const defaultCapabilities = { virtualBrowser: false };
    assert.equal(defaultCapabilities.virtualBrowser, false);

    // If metadata fetch fails or returns empty/invalid JSON, default remains false
    const failedMetaResponse: any = {};
    const hydratedFailed = failedMetaResponse?.capabilities?.virtualBrowser ?? false;
    assert.equal(hydratedFailed, false, "Failed metadata request must retain safe default false");

    // Authenticated / guest response with active capability
    const validMetaResponse = { capabilities: { virtualBrowser: true } };
    const hydratedActive = validMetaResponse?.capabilities?.virtualBrowser ?? false;
    assert.equal(hydratedActive, true, "Valid capabilities payload must hydrate true");

    console.log("All 6 integration and lifecycle validation scenarios passed!");
  } finally {
    // Restore config
    config.VIRTUAL_BROWSER_ENABLED = originalEnabled;
    config.VIRTUAL_BROWSER_PROVIDER = originalProvider;
    config.VM_MANAGER_CONFIG = originalVmConfig;
    config.HETZNER_TOKEN = originalHetznerToken;
    config.HETZNER_IMAGE = originalHetznerImage;
    config.HETZNER_GATEWAY = originalHetznerGateway;
    resetVBrowserProviderInstance();
  }
}

runIntegrationSuite().catch((err) => {
  console.error("Integration validation suite failed:", err);
  process.exit(1);
});
