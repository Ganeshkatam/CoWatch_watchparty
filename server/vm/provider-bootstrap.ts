import config from "../config.ts";
import { providerRegistry } from "./provider-registry.ts";
import { getVMManagerConfig } from "./utils.ts";
import { createVMManager } from "./utils.ts";

/**
 * DB provider_id → adapter class name mapping.
 *
 * The DB stores lowercase canonical IDs. The adapter classes use their own
 * identifiers (e.g., "Hetzner", "Docker"). This mapping makes the
 * translation explicit rather than relying on string coincidence.
 *
 * Keys must match vbrowser_providers.id values.
 * Values must match what createVMManager() expects in PoolConfig.provider.
 */
const PROVIDER_CLASS_MAP: Record<string, string> = {
  "hetzner": "Hetzner",
  "docker": "Docker",
  "digitalocean": "DO",
  "scaleway": "Scaleway",
  "azure": "Azure",
};

/**
 * Constructs the pool name that BaseVMManager.getPoolName() will return.
 * This is the canonical key for both the registry and the vbrowser table.
 *
 * Convention: adapterId + (isLarge ? "Large" : "") + region
 */
function buildPoolName(adapterId: string, isLarge: boolean, region: string): string {
  return adapterId + (isLarge ? "Large" : "") + region;
}

/**
 * Populates the provider registry from VM_MANAGER_CONFIG.
 *
 * Called once at application startup. Reads the env-based pool configuration,
 * creates VMManager instances, and registers them under pool names that match
 * what assignVM/resetVM use internally.
 *
 * The registry is NOT populated again until the next process restart.
 */
export function bootstrapProviderRegistry(): void {
  const poolConfigs = getVMManagerConfig();

  for (const poolConfig of poolConfigs) {
    const adapterClassName = PROVIDER_CLASS_MAP[poolConfig.provider];
    if (!adapterClassName) {
      console.warn(
        `[PROVIDER-REGISTRY] Unknown provider "${poolConfig.provider}" in VM_MANAGER_CONFIG, skipping`
      );
      continue;
    }

    try {
      const manager = createVMManager(poolConfig);
      const poolName = buildPoolName(
        adapterClassName,
        poolConfig.isLarge,
        poolConfig.region
      );

      providerRegistry.register(poolName, manager);
      console.log(
        `[PROVIDER-REGISTRY] Registered pool: ${poolName} (provider=${poolConfig.provider}, adapter=${adapterClassName})`
      );
    } catch (e: any) {
      console.warn(
        `[PROVIDER-REGISTRY] Failed to create manager for "${poolConfig.provider}":`,
        e.message || e
      );
    }
  }

  const pools = providerRegistry.getRegisteredPools();
  if (pools.length === 0) {
    console.warn("[PROVIDER-REGISTRY] No provider pools registered. VBrowser allocation will fail closed.");
  } else {
    console.log(`[PROVIDER-REGISTRY] ${pools.length} pool(s) registered: ${pools.join(", ")}`);
  }
}
