import config from "../config.ts";
import { VMManager, type VM } from "./base.ts";
import { AzureArmClient } from "./azure-arm-client.ts";
import type { PoolConfig } from "./utils.ts";

export class Azure extends VMManager {
  size = "Standard_B2s";
  largeSize = "Standard_B4ms";
  minRetries = 5;
  reuseVMs = Boolean(config.AZURE_REUSE_VMS);
  id = "Azure";
  imageId = config.AZURE_IMAGE_ID;

  private client: AzureArmClient;
  private location = config.AZURE_LOCATION || "eastus";
  private gateway = config.AZURE_GATEWAY;

  constructor(poolConfig: PoolConfig, client?: AzureArmClient) {
    super(poolConfig);
    this.client =
      client ||
      new AzureArmClient({
        clientId: config.AZURE_CLIENT_ID,
        clientSecret: config.AZURE_CLIENT_SECRET,
        tenantId: config.AZURE_TENANT_ID,
        subscriptionId: config.AZURE_SUBSCRIPTION_ID,
        resourceGroup: config.AZURE_RESOURCE_GROUP,
        location: this.location,
      });
  }

  /**
   * Orchestrates the creation of Static Public IP, NIC, and Virtual Machine.
   */
  startVM = async (name: string): Promise<string> => {
    const tags = {
      [this.getTag()]: "1",
    };

    try {
      // 1. Create Standard Static Public IP
      const publicIp = await this.client.createPublicIp(name, this.location, tags);

      // 2. Create Network Interface Card attached to subnet and Public IP
      const nic = await this.client.createNic(
        name,
        this.location,
        config.AZURE_SUBNET_ID,
        publicIp.id,
        tags
      );

      // 3. Create Virtual Machine using validated Managed Image
      const vmSize = this.isLarge ? this.largeSize : this.size;
      await this.client.createVm({
        name,
        location: this.location,
        vmSize,
        imageId: this.imageId,
        adminUsername: config.AZURE_ADMIN_USERNAME || "azureuser",
        sshPublicKey: config.AZURE_SSH_KEY,
        nicId: nic.id,
        tags,
      });

      return name;
    } catch (err) {
      console.warn(
        `[AZURE] Provisioning failed for ${name}, rolling back partially created resources:`,
        (err as any)?.message || err
      );
      try {
        await this.client.deleteVmWithDependencies(name);
      } catch (cleanupErr) {
        console.warn(
          `[AZURE] Partial provisioning cleanup failed for ${name}:`,
          (cleanupErr as any)?.message || cleanupErr
        );
      }
      throw err;
    }
  };

  /**
   * Deletes the Virtual Machine, NIC, Public IP, and OS Disk.
   */
  terminateVM = async (id: string): Promise<void> => {
    await this.client.deleteVmWithDependencies(id);
  };

  /**
   * Restarts the Virtual Machine via Azure Compute REST API.
   */
  rebootVM = async (id: string): Promise<void> => {
    await this.client.restartVm(id);
  };

  /**
   * Reimaging is explicitly unsupported in v1 to prevent silent fallback or disk inconsistency.
   */
  reimageVM = async (_id: string): Promise<void> => {
    throw new Error(
      "Azure provider does not support automated OS disk reimaging in v1. Deploy a fresh instance via startVM or configure AZURE_REUSE_VMS=false."
    );
  };

  /**
   * Fetches the VM networking chain and maps it to the standard VM representation.
   */
  getVM = async (id: string): Promise<VM> => {
    const { ip, rawVm } = await this.client.getVmNetworking(id);
    return this.mapServerObject({ ...rawVm, ip, name: id });
  };

  /**
   * Lists Virtual Machines matching the pool tag.
   */
  listVMs = async (filter: string): Promise<VM[]> => {
    const rawVms = await this.client.listVms(filter);
    return rawVms.map((vm) => this.mapServerObject(vm));
  };

  /**
   * Powers on a stopped/deallocated Virtual Machine.
   */
  powerOn = async (id: string): Promise<void> => {
    await this.client.startVm(id);
  };

  /**
   * Networking is configured at NIC creation time.
   */
  attachToNetwork = async (_id: string): Promise<void> => {};

  /**
   * Snapshot creation from running Azure VMs is unsupported via this worker.
   * Throws an explicit typed error rather than returning a silent empty string.
   */
  updateSnapshot = async (): Promise<string> => {
    throw new Error(
      "Azure provider does not support automated snapshot updates. Use immutable managed image configuration via AZURE_IMAGE_ID."
    );
  };

  /**
   * Maps an Azure VM resource payload to the CoWatch VM interface.
   */
  mapServerObject = (server: any): VM => {
    const ip = server.ip || "";
    const name = server.name || server.id?.split("/").pop() || "";
    return {
      id: name,
      host: ip && this.gateway ? `${this.gateway}/?ip=${ip}` : "",
      provider: this.id,
      large: this.isLarge,
      region: this.region,
    };
  };
}
