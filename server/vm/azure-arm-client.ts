import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

export interface AzureArmConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  subscriptionId: string;
  resourceGroup: string;
  location: string;
}

export interface CreateVmParams {
  name: string;
  location: string;
  vmSize: string;
  imageId: string;
  adminUsername: string;
  sshPublicKey: string;
  nicId: string;
  tags: Record<string, string>;
}

export class AzureArmClient {
  public static readonly COMPUTE_API_VERSION = "2024-07-01";
  public static readonly NETWORK_API_VERSION = "2024-05-01";

  private armConfig: AzureArmConfig;
  private http: any;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(armConfig: AzureArmConfig, http: any = axios) {
    this.armConfig = armConfig;
    this.http = http;
  }

  /**
   * Acquire or return a cached OAuth2 access token for Azure Resource Manager.
   * Targets the /.default scope as required for client-credentials flow.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt) {
      return this.token;
    }

    const { tenantId, clientId, clientSecret } = this.armConfig;
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    });

    const response = await this.http.post(tokenUrl, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = response.data;
    if (!data?.access_token) {
      throw new Error("Failed to acquire Azure access token: missing access_token in response");
    }

    this.token = data.access_token;
    // Buffer expiration by 300 seconds (5 minutes)
    const expiresIn = Number(data.expires_in) || 3600;
    this.tokenExpiresAt = now + Math.max(expiresIn - 300, 60) * 1000;

    return this.token!;
  }

  /**
   * Clears the in-memory token cache (useful for tests or auth errors).
   */
  clearTokenCache(): void {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Execute an authenticated ARM request with automatic header injection.
   */
  private async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const token = await this.getAccessToken();
    const headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    return this.http({
      ...config,
      headers,
    });
  }

  /**
   * Polls an Azure asynchronous operation until terminal state (Succeeded/Failed/Canceled).
   * Bounded with a timeout ceiling to prevent hanging processes.
   */
  async pollAsyncOperation(
    initialResponse: AxiosResponse,
    timeoutMs = 90000,
    pollIntervalMs = 2000
  ): Promise<void> {
    if (initialResponse.status !== 202) {
      return;
    }

    const asyncOpUrl =
      initialResponse.headers["azure-asyncoperation"] ||
      initialResponse.headers["location"];

    if (!asyncOpUrl) {
      // 202 Accepted without tracking header; consider accepted
      return;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const check = await this.request({
          method: "GET",
          url: asyncOpUrl,
        });

        const status = check.data?.status || check.data?.properties?.provisioningState;
        if (status === "Succeeded") {
          return;
        }
        if (status === "Failed" || status === "Canceled") {
          const detail =
            check.data?.error?.message || JSON.stringify(check.data) || "Unknown ARM failure";
          throw new Error(`Azure async operation failed with status "${status}": ${detail}`);
        }
      } catch (e: any) {
        if (e.response?.status === 404) {
          // If the async tracking URL returns 404 after initial acceptance, it might have completed
          return;
        }
        throw e;
      }
    }

    throw new Error(`Azure async operation timed out after ${timeoutMs}ms for URL: ${asyncOpUrl}`);
  }

  /**
   * Base URL for the target resource group.
   */
  private get resourceGroupBaseUrl(): string {
    const { subscriptionId, resourceGroup } = this.armConfig;
    return `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
  }

  /**
   * Creates a Standard SKU Static Public IP address.
   */
  async createPublicIp(
    name: string,
    location: string,
    tags: Record<string, string>
  ): Promise<{ id: string }> {
    const url = `${this.resourceGroupBaseUrl}/providers/Microsoft.Network/publicIPAddresses/${name}-pip?api-version=${AzureArmClient.NETWORK_API_VERSION}`;
    const payload = {
      location,
      sku: { name: "Standard" },
      properties: {
        publicIPAllocationMethod: "Static",
      },
      tags,
    };

    const response = await this.request({
      method: "PUT",
      url,
      data: payload,
    });

    await this.pollAsyncOperation(response);
    return { id: response.data.id || `${this.resourceGroupBaseUrl}/providers/Microsoft.Network/publicIPAddresses/${name}-pip` };
  }

  /**
   * Creates a Network Interface Card (NIC) attached to subnet and Public IP.
   */
  async createNic(
    name: string,
    location: string,
    subnetId: string,
    publicIpId: string,
    tags: Record<string, string>
  ): Promise<{ id: string }> {
    const url = `${this.resourceGroupBaseUrl}/providers/Microsoft.Network/networkInterfaces/${name}-nic?api-version=${AzureArmClient.NETWORK_API_VERSION}`;
    const payload = {
      location,
      properties: {
        ipConfigurations: [
          {
            name: "ipconfig1",
            properties: {
              subnet: { id: subnetId },
              publicIPAddress: { id: publicIpId },
              privateIPAllocationMethod: "Dynamic",
            },
          },
        ],
      },
      tags,
    };

    const response = await this.request({
      method: "PUT",
      url,
      data: payload,
    });

    await this.pollAsyncOperation(response);
    return { id: response.data.id || `${this.resourceGroupBaseUrl}/providers/Microsoft.Network/networkInterfaces/${name}-nic` };
  }

  /**
   * Creates an Azure Virtual Machine referencing a managed custom image.
   * Strictly validates that imageId matches the Managed Image resource format.
   */
  async createVm(params: CreateVmParams): Promise<{ id: string }> {
    // Validate imageId format strictly: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/images/{name}
    const managedImageRegex = /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/images\/[^/]+$/i;
    if (!managedImageRegex.test(params.imageId)) {
      throw new Error(
        `Invalid AZURE_IMAGE_ID: "${params.imageId}". Azure provider v1 strictly supports Managed Image Resource IDs (/subscriptions/.../resourceGroups/.../providers/Microsoft.Compute/images/...).`
      );
    }

    const url = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/virtualMachines/${params.name}?api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    const payload = {
      location: params.location,
      properties: {
        hardwareProfile: {
          vmSize: params.vmSize,
        },
        storageProfile: {
          imageReference: {
            id: params.imageId,
          },
          osDisk: {
            name: `${params.name}-osdisk`,
            caching: "ReadWrite",
            createOption: "FromImage",
            deleteOption: "Delete",
          },
        },
        osProfile: {
          computerName: params.name.slice(0, 15),
          adminUsername: params.adminUsername,
          linuxConfiguration: {
            disablePasswordAuthentication: true,
            ssh: {
              publicKeys: [
                {
                  path: `/home/${params.adminUsername}/.ssh/authorized_keys`,
                  keyData: params.sshPublicKey,
                },
              ],
            },
          },
        },
        networkProfile: {
          networkInterfaces: [
            {
              id: params.nicId,
              properties: {
                primary: true,
                deleteOption: "Delete",
              },
            },
          ],
        },
      },
      tags: params.tags,
    };

    const response = await this.request({
      method: "PUT",
      url,
      data: payload,
    });

    await this.pollAsyncOperation(response);
    return { id: params.name };
  }

  /**
   * Delete VM and all allocated dependent networking resources (NIC, Public IP, OS Disk).
   * Handles 404 (already deleted) idempotently at every step.
   */
  async deleteVmWithDependencies(name: string): Promise<void> {
    const deleteSafe = async (url: string) => {
      try {
        const res = await this.request({
          method: "DELETE",
          url,
        });
        await this.pollAsyncOperation(res);
      } catch (e: any) {
        if (e.response?.status === 404) {
          return; // Idempotent cleanup
        }
        throw e;
      }
    };

    // 1. Delete Virtual Machine
    const vmUrl = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/virtualMachines/${name}?api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    await deleteSafe(vmUrl);

    // 2. Delete Network Interface
    const nicUrl = `${this.resourceGroupBaseUrl}/providers/Microsoft.Network/networkInterfaces/${name}-nic?api-version=${AzureArmClient.NETWORK_API_VERSION}`;
    await deleteSafe(nicUrl);

    // 3. Delete Public IP
    const pipUrl = `${this.resourceGroupBaseUrl}/providers/Microsoft.Network/publicIPAddresses/${name}-pip?api-version=${AzureArmClient.NETWORK_API_VERSION}`;
    await deleteSafe(pipUrl);

    // 4. Delete OS Disk (if retained)
    const diskUrl = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/disks/${name}-osdisk?api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    await deleteSafe(diskUrl);
  }

  /**
   * Restarts a Virtual Machine via ARM Compute API.
   */
  async restartVm(name: string): Promise<void> {
    const url = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/virtualMachines/${name}/restart?api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    const response = await this.request({
      method: "POST",
      url,
    });
    await this.pollAsyncOperation(response);
  }

  /**
   * Starts (powers on) a Virtual Machine.
   */
  async startVm(name: string): Promise<void> {
    const url = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/virtualMachines/${name}/start?api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    const response = await this.request({
      method: "POST",
      url,
    });
    await this.pollAsyncOperation(response);
  }

  /**
   * Resolves a VM's IP address through the VM -> NIC -> Public IP lookup chain.
   */
  async getVmNetworking(name: string): Promise<{ id: string; ip: string; rawVm: any }> {
    const vmUrl = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/virtualMachines/${name}?$expand=instanceView&api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    const vmRes = await this.request({ method: "GET", url: vmUrl });
    const vm = vmRes.data;

    const nicId = vm?.properties?.networkProfile?.networkInterfaces?.[0]?.id;
    if (!nicId) {
      return { id: name, ip: "", rawVm: vm };
    }

    const nicRes = await this.request({
      method: "GET",
      url: `https://management.azure.com${nicId}?api-version=${AzureArmClient.NETWORK_API_VERSION}`,
    });
    const nic = nicRes.data;

    const ipConfig = nic?.properties?.ipConfigurations?.[0];
    const publicIpId = ipConfig?.properties?.publicIPAddress?.id;
    let ip = "";

    if (publicIpId) {
      try {
        const pipRes = await this.request({
          method: "GET",
          url: `https://management.azure.com${publicIpId}?api-version=${AzureArmClient.NETWORK_API_VERSION}`,
        });
        ip = pipRes.data?.properties?.ipAddress || "";
      } catch (e) {
        // Fall back to private IP if public IP query fails
        ip = ipConfig?.properties?.privateIPAddress || "";
      }
    } else {
      ip = ipConfig?.properties?.privateIPAddress || "";
    }

    return { id: name, ip, rawVm: vm };
  }

  /**
   * Lists Virtual Machines in the configured resource group, optionally filtered by tag.
   */
  async listVms(tagFilter?: string): Promise<any[]> {
    const url = `${this.resourceGroupBaseUrl}/providers/Microsoft.Compute/virtualMachines?api-version=${AzureArmClient.COMPUTE_API_VERSION}`;
    const response = await this.request({ method: "GET", url });
    const vms: any[] = response.data?.value || [];

    if (!tagFilter) {
      return vms;
    }

    return vms.filter((vm) => vm.tags && vm.tags[tagFilter] !== undefined);
  }
}
