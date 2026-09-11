import assert from "node:assert/strict";
import { ProviderRegistry } from "./provider-registry.ts";
import type { VMManager } from "./base.ts";

function createMockManager(id: string, isLarge: boolean, region: string): VMManager {
  return {
    id,
    getIsLarge: () => isLarge,
    getRegion: () => region,
    getPoolName: () => id + (isLarge ? "Large" : "") + region,
    assignVM: async () => undefined,
    resetVM: async () => {},
  } as unknown as VMManager;
}

async function runTests() {
  console.log("Running ProviderRegistry tests...");

  // 1. Register and resolve
  console.log("Test 1: Register and resolve...");
  const registry = new ProviderRegistry();
  const hetznerUS = createMockManager("Hetzner", false, "US");
  const hetznerEULarge = createMockManager("Hetzner", true, "EU");

  registry.register("HetznerUS", hetznerUS);
  registry.register("HetznerLargeEU", hetznerEULarge);

  assert.strictEqual(registry.resolve("HetznerUS"), hetznerUS);
  assert.strictEqual(registry.resolve("HetznerLargeEU"), hetznerEULarge);

  // 2. Unknown pool returns undefined
  console.log("Test 2: Unknown pool...");
  assert.strictEqual(registry.resolve("AzureUS"), undefined);
  assert.strictEqual(registry.resolve("HetznerLargeUS"), undefined);

  // 3. isRegistered
  console.log("Test 3: isRegistered...");
  assert.strictEqual(registry.isRegistered("HetznerUS"), true);
  assert.strictEqual(registry.isRegistered("HetznerLargeEU"), true);
  assert.strictEqual(registry.isRegistered("HetznerLargeUS"), false);
  assert.strictEqual(registry.isRegistered("AzureUS"), false);

  // 4. Duplicate registration throws
  console.log("Test 4: Duplicate registration...");
  assert.throws(
    () => registry.register("HetznerUS", hetznerUS),
    /already registered/,
    "Duplicate registration must throw"
  );

  // 5. getRegisteredPools
  console.log("Test 5: getRegisteredPools...");
  const pools = registry.getRegisteredPools();
  assert.strictEqual(pools.length, 2);
  assert.ok(pools.includes("HetznerUS"));
  assert.ok(pools.includes("HetznerLargeEU"));

  // 6. Empty registry
  console.log("Test 6: Empty registry...");
  const emptyRegistry = new ProviderRegistry();
  assert.strictEqual(emptyRegistry.resolve("anything"), undefined);
  assert.strictEqual(emptyRegistry.isRegistered("anything"), false);
  assert.strictEqual(emptyRegistry.getRegisteredPools().length, 0);

  // 7. Multiple providers
  console.log("Test 7: Multiple providers...");
  const multiRegistry = new ProviderRegistry();
  const docker = createMockManager("Docker", false, "US");
  const hetzner = createMockManager("Hetzner", false, "US");
  const scaleway = createMockManager("Scaleway", false, "EU");

  multiRegistry.register("DockerUS", docker);
  multiRegistry.register("HetznerUS", hetzner);
  multiRegistry.register("ScalewayEU", scaleway);

  assert.strictEqual(multiRegistry.resolve("DockerUS"), docker);
  assert.strictEqual(multiRegistry.resolve("HetznerUS"), hetzner);
  assert.strictEqual(multiRegistry.resolve("ScalewayEU"), scaleway);
  assert.strictEqual(multiRegistry.getRegisteredPools().length, 3);

  // 8. Pool name convention matches BaseVMManager
  console.log("Test 8: Pool name convention...");
  const azure = createMockManager("Azure", true, "US");
  multiRegistry.register("AzureLargeUS", azure);
  assert.strictEqual(multiRegistry.resolve("AzureLargeUS"), azure);
  assert.ok(multiRegistry.getRegisteredPools().includes("AzureLargeUS"));

  // 9. Pool name must match getPoolName()
  console.log("Test 9: Key matches getPoolName()...");
  const freshRegistry = new ProviderRegistry();
  const manager = createMockManager("Hetzner", true, "EU");
  const expectedKey = manager.getPoolName(); // "HetznerLargeEU"
  freshRegistry.register(expectedKey, manager);
  assert.strictEqual(freshRegistry.resolve(expectedKey), manager);

  // 10. clear() empties all registrations
  console.log("Test 10: clear()...");
  freshRegistry.clear();
  assert.strictEqual(freshRegistry.resolve(expectedKey), undefined);
  assert.strictEqual(freshRegistry.getRegisteredPools().length, 0);

  console.log("All ProviderRegistry tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
