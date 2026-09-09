import config from "../config.ts";
import type { AssignedVM } from "./base.ts";
import { Docker } from "./docker.ts";
import { Hetzner } from "./hetzner.ts";
import axios from "axios";
import crypto from "node:crypto";

export class VBrowserDisabledError extends Error {
  constructor(message = "Virtual Browser is disabled on this server.") {
    super(message);
    this.name = "VBrowserDisabledError";
  }
}

export type VBrowserProviderType = "auto" | "local" | "hetzner" | "pooled";

export interface IVBrowserProvider {
  readonly id: string;
  readonly isEnabled: boolean;

  assign(options: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
  }): Promise<AssignedVM | null>;

  release(options: {
    id: string;
    provider?: string;
    isLarge?: boolean;
    region?: string;
    roomId?: string;
  }): Promise<void>;
}

export class NullProvider implements IVBrowserProvider {
  readonly id = "none";
  readonly isEnabled = false;

  async assign(_options: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
  }): Promise<AssignedVM | null> {
    throw new VBrowserDisabledError();
  }

  async release(_options: {
    id: string;
    provider?: string;
    isLarge?: boolean;
    region?: string;
    roomId?: string;
  }): Promise<void> {
    return;
  }
}

export class LocalDockerProvider implements IVBrowserProvider {
  readonly id = "local";
  readonly isEnabled = true;

  private docker: Docker;

  constructor() {
    this.docker = new Docker({
      provider: "Docker",
      isLarge: false,
      region: "US",
      limitSize: 0,
      minSize: 0,
      hostname: config.DOCKER_VM_HOST,
    });
  }

  async assign(options: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
  }): Promise<AssignedVM | null> {
    const pass = crypto.randomUUID();
    const id = await this.docker.startVM(pass);
    const vm = await this.docker.getVM(id);
    return {
      ...vm,
      pass,
      assignTime: Date.now(),
    };
  }

  async release(options: {
    id: string;
    provider?: string;
    isLarge?: boolean;
    region?: string;
    roomId?: string;
  }): Promise<void> {
    if (options.id) {
      await this.docker.terminateVM(options.id);
    }
  }
}

export class HetznerProvider implements IVBrowserProvider {
  readonly id = "hetzner";
  readonly isEnabled = true;

  private hetzner: Hetzner;

  constructor() {
    this.hetzner = new Hetzner({
      provider: "Hetzner",
      isLarge: false,
      region: "US",
      limitSize: 0,
      minSize: 0,
      hostname: undefined,
    });
  }

  async assign(options: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
  }): Promise<AssignedVM | null> {
    const pass = crypto.randomUUID();
    const id = await this.hetzner.startVM(pass);
    const vm = await this.hetzner.getVM(id);
    return {
      ...vm,
      pass,
      assignTime: Date.now(),
    };
  }

  async release(options: {
    id: string;
    provider?: string;
    isLarge?: boolean;
    region?: string;
    roomId?: string;
  }): Promise<void> {
    if (options.id) {
      await this.hetzner.terminateVM(options.id);
    }
  }
}

export class PooledVMProvider implements IVBrowserProvider {
  readonly id = "pooled";
  readonly isEnabled = true;

  async assign(options: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
  }): Promise<AssignedVM | null> {
    const { data } = await axios.post<AssignedVM>(
      `http://localhost:${config.VMWORKER_PORT}/assignVM`,
      options
    );
    return data || null;
  }

  async release(options: {
    id: string;
    provider?: string;
    isLarge?: boolean;
    region?: string;
    roomId?: string;
  }): Promise<void> {
    await axios.post(
      `http://localhost:${config.VMWORKER_PORT}/releaseVM`,
      options
    );
  }
}

/**
 * Routes release requests using the actual provider recorded on the AssignedVM,
 * ensuring clean teardown across heterogeneous and changing configurations.
 */
export class ProviderReleaseRouter implements IVBrowserProvider {
  private delegate: IVBrowserProvider;

  constructor(delegate: IVBrowserProvider) {
    this.delegate = delegate;
  }

  get id(): string {
    return this.delegate.id;
  }

  get isEnabled(): boolean {
    return this.delegate.isEnabled;
  }

  async assign(options: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
  }): Promise<AssignedVM | null> {
    return this.delegate.assign(options);
  }

  async release(options: {
    id: string;
    provider?: string;
    isLarge?: boolean;
    region?: string;
    roomId?: string;
  }): Promise<void> {
    // If the assigned VM explicitly records its infrastructure provider,
    // dispatch to that infrastructure manager directly.
    if (options.provider === "Docker") {
      const localDocker = new LocalDockerProvider();
      await localDocker.release(options);
      return;
    }

    if (options.provider === "Hetzner" && !config.VM_MANAGER_CONFIG) {
      const hetzner = new HetznerProvider();
      await hetzner.release(options);
      return;
    }

    if (config.VM_MANAGER_CONFIG) {
      try {
        await axios.post(
          `http://localhost:${config.VMWORKER_PORT}/releaseVM`,
          options
        );
        return;
      } catch (e) {
        console.warn("Pooled release failed, attempting direct provider release:", e);
      }
    }

    // Default to current active delegate provider
    await this.delegate.release(options);
  }
}

export function resolveVBrowserProvider(): "none" | "local" | "hetzner" | "pooled" {
  if (!config.VIRTUAL_BROWSER_ENABLED) {
    return "none";
  }

  const explicit = (config.VIRTUAL_BROWSER_PROVIDER || "auto").toLowerCase();
  if (explicit === "local" || explicit === "docker") {
    return "local";
  }
  if (explicit === "hetzner") {
    return "hetzner";
  }
  if (explicit === "pooled") {
    return "pooled";
  }

  // "auto" resolution:
  if (config.VM_MANAGER_CONFIG) {
    return "pooled";
  }
  if (config.HETZNER_TOKEN && config.HETZNER_IMAGE && config.HETZNER_GATEWAY) {
    return "hetzner";
  }
  return "local";
}

let providerInstance: IVBrowserProvider | null = null;

export function getVBrowserProvider(): IVBrowserProvider {
  if (!providerInstance) {
    const resolved = resolveVBrowserProvider();
    let baseProvider: IVBrowserProvider;
    switch (resolved) {
      case "local":
        baseProvider = new LocalDockerProvider();
        break;
      case "hetzner":
        baseProvider = new HetznerProvider();
        break;
      case "pooled":
        baseProvider = new PooledVMProvider();
        break;
      case "none":
      default:
        baseProvider = new NullProvider();
        break;
    }
    providerInstance = new ProviderReleaseRouter(baseProvider);
  }
  return providerInstance;
}

export function resetVBrowserProviderInstance(): void {
  providerInstance = null;
}
