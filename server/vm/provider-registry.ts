import type { VMManager } from "./base.ts";

/**
 * Bridges DB provider identity to concrete BaseVMManager instances.
 *
 * The DB `vbrowser_providers.id` is the canonical provider identity.
 * BaseVMManager subclasses carry infrastructure-specific lifecycle logic.
 * This registry maps one to the other without coupling policy to infrastructure.
 *
 * Invariants:
 * - No allocation logic.
 * - No DB reads.
 * - No adapter construction.
 * - Unknown provider → deterministic failure.
 */
export class ProviderRegistry {
  private managers = new Map<string, VMManager>();

  /**
   * Register a VMManager for a given DB provider_id.
   * The poolName is derived from (providerId, isLarge, region).
   * Throws on duplicate registration for the same pool.
   */
  register(providerId: string, manager: VMManager): void {
    const poolName = this.buildPoolName(providerId, manager.getIsLarge(), manager.getRegion());
    if (this.managers.has(poolName)) {
      throw new Error(`Provider pool already registered: ${poolName}`);
    }
    this.managers.set(poolName, manager);
  }

  /**
   * Resolve a VMManager by DB provider_id, size, and region.
   * Returns undefined for unknown/unregistered providers.
   */
  resolve(providerId: string, isLarge: boolean, region: string): VMManager | undefined {
    const poolName = this.buildPoolName(providerId, isLarge, region);
    return this.managers.get(poolName);
  }

  /**
   * Check whether a provider pool is registered.
   */
  isRegistered(providerId: string, isLarge: boolean, region: string): boolean {
    const poolName = this.buildPoolName(providerId, isLarge, region);
    return this.managers.has(poolName);
  }

  /**
   * Returns all registered pool names (for diagnostics).
   */
  getRegisteredPools(): string[] {
    return Array.from(this.managers.keys());
  }

  /**
   * Builds the pool key from DB identity components.
   * Matches the BaseVMManager.getPoolName() convention:
   *   providerId + (isLarge ? "Large" : "") + region
   */
  private buildPoolName(providerId: string, isLarge: boolean, region: string): string {
    return providerId + (isLarge ? "Large" : "") + region;
  }
}

export const providerRegistry = new ProviderRegistry();
