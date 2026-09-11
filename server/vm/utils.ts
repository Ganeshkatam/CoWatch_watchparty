import { type AssignedVM, VMManager } from "./base.ts";
import config from "../config.ts";
import { Scaleway } from "./scaleway.ts";
import { Hetzner } from "./hetzner.ts";
import { DigitalOcean } from "./digitalocean.ts";
import { Docker } from "./docker.ts";
import { Azure } from "./azure.ts";

// Chromium on ARM: ghcr.io/howardchung/vbrowser/arm-chromium
export const imageName = "howardc93/vbrowser";

export type PoolRegion = "US" | "USW" | "EU";
export type PoolConfig = {
  provider: string;
  isLarge: boolean;
  region: PoolRegion;
  limitSize: number | undefined;
  minSize: number | undefined;
  hostname: string | undefined;
};

export function createVMManager(poolConfig: PoolConfig): VMManager {
  let vmManager: VMManager | null = null;
  if (
    config.SCW_SECRET_KEY &&
    config.SCW_ORGANIZATION_ID &&
    config.SCW_IMAGE &&
    config.SCW_GATEWAY &&
    poolConfig.provider === "Scaleway"
  ) {
    vmManager = new Scaleway(poolConfig);
  } else if (
    config.HETZNER_TOKEN &&
    config.HETZNER_IMAGE &&
    config.HETZNER_GATEWAY &&
    poolConfig.provider === "Hetzner"
  ) {
    vmManager = new Hetzner(poolConfig);
  } else if (
    config.DO_TOKEN &&
    config.DO_IMAGE &&
    config.DO_GATEWAY &&
    poolConfig.provider === "DO"
  ) {
    vmManager = new DigitalOcean(poolConfig);
  } else if (poolConfig.provider === "Docker") {
    vmManager = new Docker(poolConfig);
  } else if (
    config.AZURE_CLIENT_ID &&
    config.AZURE_CLIENT_SECRET &&
    config.AZURE_TENANT_ID &&
    config.AZURE_SUBSCRIPTION_ID &&
    config.AZURE_RESOURCE_GROUP &&
    config.AZURE_IMAGE_ID &&
    config.AZURE_SUBNET_ID &&
    config.AZURE_GATEWAY &&
    poolConfig.provider === "Azure"
  ) {
    vmManager = new Azure(poolConfig);
  }
  if (!vmManager) {
    throw new Error("failed to create vmManager");
  }
  return vmManager;
}

export function getVMManagerConfig(): PoolConfig[] {
  return config.VM_MANAGER_CONFIG.split(",")
    .filter(Boolean)
    .map((c) => {
      const split = c.split(":");
      return {
        provider: split[0],
        isLarge: split[1] === "large",
        region: split[2] as PoolRegion,
        minSize: Number(split[3]),
        limitSize: Number(split[4]),
        hostname: split[5],
      };
    });
}

export function getBgVMManagers(): { [key: string]: VMManager } {
  const result: { [key: string]: VMManager } = {};
  const conf = getVMManagerConfig();
  conf.forEach((c) => {
    const mgr = createVMManager(c);
    if (mgr) {
      result[mgr.getPoolName()] = mgr;
    }
  });
  return result;
}

export function getSessionLimitSeconds(isLarge: boolean) {
  return isLarge
    ? config.VBROWSER_SESSION_SECONDS_LARGE
    : config.VBROWSER_SESSION_SECONDS;
}
