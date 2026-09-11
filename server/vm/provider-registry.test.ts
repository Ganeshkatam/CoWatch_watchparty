import assert from "node:assert/strict";
import { ProviderRegistry } from "./provider-registry.ts";
import type { VMManager } from "./base.ts";
import type { VM } from "./base.ts";

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
  const hetznerUS = createMockManager("hetzner", false, "US");
  const hetznerEULarge = createMockManager("hetzner", true, "EU");

  registry.register("hetzner", hetznerUS);
  registry.register("hetzner", hetznerEULarge);

  assert.strictEqual(registry.resolve("hetzner", false, "US"), hetznerUS);
  assert.strictEqual(registry.resolve("hetzner", true, "EU"), hetznerEULarge);

  // 2. Unknown provider returns undefined
  console.log("Test 2: Unknown provider...");
  assert.strictEqual(registry.resolve("azure", false, "US"), undefined);
  assert.strictEqual(registry.resolve("hetzner", false, "EU"), undefined);

  // 3. isRegistered
  console.log("Test 3: isRegistered...");
  assert.strictEqual(registry.isRegistered("hetzner", false, "US"), true);
  assert.strictEqual(registry.isRegistered("hetzner", true, "EU"), true);
  assert.strictEqual(registry.isRegistered("hetzner", false, "EU"), false);
  assert.strictEqual(registry.isRegistered("azure", false, "US"), false);

  // 4. Duplicate registration throws
  console.log("Test 4: Duplicate registration...");
  assert.throws(
    () => registry.register("hetzner", hetznerUS),
    /already registered/,
    "Duplicate registration must throw"
  );

  // 5. getRegisteredPools
  console.log("Test 5: getRegisteredPools...");
  const pools = registry.getRegisteredPools();
  assert.strictEqual(pools.length, 2);
  assert.ok(pools.includes("hetznerUS"));
  assert.ok(pools.includes("hetznerLargeEU"));

  // 6. Empty registry
  console.log("Test 6: Empty registry...");
  const emptyRegistry = new ProviderRegistry();
  assert.strictEqual(emptyRegistry.resolve("anything", false, "US"), undefined);
  assert.strictEqual(emptyRegistry.isRegistered("anything", false, "US"), false);
  assert.strictEqual(emptyRegistry.getRegisteredPools().length, 0);

  // 7. Multiple providers
  console.log("Test 7: Multiple providers...");
  const multiRegistry = new ProviderRegistry();
  const docker = createMockManager("docker", false, "US");
  const hetzner = createMockManager("hetzner", false, "US");
  const scaleway = createMockManager("scaleway", false, "EU");

  multiRegistry.register("docker", docker);
  multiRegistry.register("hetzner", hetzner);
  multiRegistry.register("scaleway", scaleway);

  assert.strictEqual(multiRegistry.resolve("docker", false, "US"), docker);
  assert.strictEqual(multiRegistry.resolve("hetzner", false, "US"), hetzner);
  assert.strictEqual(multiRegistry.resolve("scaleway", false, "EU"), scaleway);
  assert.strictEqual(multiRegistry.getRegisteredPools().length, 3);

  // 8. Pool name convention matches BaseVMManager
  console.log("Test 8: Pool name convention...");
  const azure = createMockManager("azure", true, "US");
  multiRegistry.register("azure", azure);
  // Pool name should be: azureLargeUS
  assert.strictEqual(multiRegistry.resolve("azure", true, "US"), azure);
  assert.ok(multiRegistry.getRegisteredPools().includes("azureLargeUS"));

  console.log("All ProviderRegistry tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
