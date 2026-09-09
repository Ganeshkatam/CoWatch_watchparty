import assert from "node:assert/strict";
import config from "../config.ts";
import {
  NullProvider,
  VBrowserDisabledError,
  resolveVBrowserProvider,
  getVBrowserProvider,
  resetVBrowserProviderInstance,
  ProviderReleaseRouter,
  type IVBrowserProvider,
} from "./provider.ts";
import type { AssignedVM } from "./base.ts";

async function runTests() {
  console.log("Running VBrowser Provider tests...");

  // 1. Test NullProvider behavior
  const nullProvider = new NullProvider();
  assert.equal(nullProvider.isEnabled, false);
  assert.equal(nullProvider.id, "none");
  await assert.rejects(
    async () => {
      await nullProvider.assign({
        roomId: "test-room",
        uid: "test-user",
        isLarge: false,
      });
    },
    VBrowserDisabledError,
    "NullProvider.assign() must reject with VBrowserDisabledError"
  );
  // release should safely no-op
  await nullProvider.release({ id: "non-existent" });

  // 2. Test resolveVBrowserProvider when disabled
  config.VIRTUAL_BROWSER_ENABLED = false;
  resetVBrowserProviderInstance();
  assert.equal(resolveVBrowserProvider(), "none");
  const defaultProvider = getVBrowserProvider();
  assert.equal(defaultProvider.isEnabled, false);

  // 3. Test resolveVBrowserProvider with explicit config
  config.VIRTUAL_BROWSER_ENABLED = true;

  config.VIRTUAL_BROWSER_PROVIDER = "local";
  assert.equal(resolveVBrowserProvider(), "local");

  config.VIRTUAL_BROWSER_PROVIDER = "hetzner";
  assert.equal(resolveVBrowserProvider(), "hetzner");

  config.VIRTUAL_BROWSER_PROVIDER = "pooled";
  assert.equal(resolveVBrowserProvider(), "pooled");

  // 4. Test "auto" resolution logic
  config.VIRTUAL_BROWSER_PROVIDER = "auto";
  const savedVmConfig = config.VM_MANAGER_CONFIG;
  const savedHetznerToken = config.HETZNER_TOKEN;
  const savedHetznerImage = config.HETZNER_IMAGE;
  const savedHetznerGateway = config.HETZNER_GATEWAY;

  // Auto with VM_MANAGER_CONFIG -> pooled
  config.VM_MANAGER_CONFIG = "dummy-config";
  assert.equal(resolveVBrowserProvider(), "pooled");

  // Auto with Hetzner credentials -> hetzner
  config.VM_MANAGER_CONFIG = "";
  config.HETZNER_TOKEN = "token";
  config.HETZNER_IMAGE = "image";
  config.HETZNER_GATEWAY = "gw";
  assert.equal(resolveVBrowserProvider(), "hetzner");

  // Auto with neither -> local
  config.HETZNER_TOKEN = "";
  assert.equal(resolveVBrowserProvider(), "local");

  // 5. Test ProviderReleaseRouter provider preservation
  let releasedWith: any = null;
  class MockDelegate implements IVBrowserProvider {
    readonly id = "mock-delegate";
    readonly isEnabled = true;
    async assign(): Promise<AssignedVM | null> {
      return null;
    }
    async release(options: any): Promise<void> {
      releasedWith = options;
    }
  }

  const mockDelegate = new MockDelegate();
  const router = new ProviderReleaseRouter(mockDelegate);
  assert.equal(router.isEnabled, true);
  assert.equal(router.id, "mock-delegate");

  // Call release with provider: "unknown_custom" -> falls back to delegate
  await router.release({ id: "vm-123", provider: "unknown_custom" });
  assert.deepEqual(releasedWith, { id: "vm-123", provider: "unknown_custom" });

  // 6. Test Singleton behavior of getVBrowserProvider
  resetVBrowserProviderInstance();
  config.VIRTUAL_BROWSER_ENABLED = false;
  const instance1 = getVBrowserProvider();
  const instance2 = getVBrowserProvider();
  assert.strictEqual(instance1, instance2, "getVBrowserProvider() must return the same singleton instance");

  // Restore config state
  config.VIRTUAL_BROWSER_ENABLED = false;
  config.VIRTUAL_BROWSER_PROVIDER = "auto";
  config.VM_MANAGER_CONFIG = savedVmConfig;
  config.HETZNER_TOKEN = savedHetznerToken;
  config.HETZNER_IMAGE = savedHetznerImage;
  config.HETZNER_GATEWAY = savedHetznerGateway;
  resetVBrowserProviderInstance();

  console.log("All VBrowser Provider unit tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
