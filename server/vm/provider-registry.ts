import type { VMManager } from "./base.ts";

/**
 * Bridges DB pool identity to concrete BaseVMManager instances.
 *
 * The canonical key is the pool name that BaseVMManager.getPoolName() produces:
 *   managerId + (isLarge ? "Large" : "") + region
 *
 * This is the same key used by assignVM/resetVM to query the vbrowser table.
 * The bootstrap layer constructs this key from explicit DB→adapter mapping
 * so there is no implicit assumption that DB provider_id === manager.id.
 *
 * Invariants:
 * - No allocation logic.
 * - No DB reads.
 * - No adapter construction.
 * - Unknown pool → deterministic failure.
 */
export class ProviderRegistry {
  private managers = new Map<string, VMManager>();

  /**
   * Register a VMManager under an explicit pool name.
   * The poolName MUST match what manager.getPoolName() returns.
   * Throws on duplicate registration.
   */
  register(poolName: string, manager: VMManager): void {
    if (this.managers.has(poolName)) {
      throw new Error(`Provider pool already registered: ${poolName}`);
    }
    this.managers.set(poolName, manager);
  }

  /**
   * Resolve a VMManager by pool name.
   * Returns undefined for unknown/unregistered pools.
   */
  resolve(poolName: string): VMManager | undefined {
    return this.managers.get(poolName);
  }

  /**
   * Check whether a pool is registered.
   */
  isRegistered(poolName: string): boolean {
    return this.managers.has(poolName);
  }

  /**
   * Returns all registered pool names (for diagnostics).
   */
  getRegisteredPools(): string[] {
    return Array.from(this.managers.keys());
  }

  /**
   * Clears all registered managers (useful for test resets).
   */
  clear(): void {
    this.managers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();
