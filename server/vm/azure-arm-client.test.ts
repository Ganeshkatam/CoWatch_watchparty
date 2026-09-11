import assert from "node:assert/strict";
import { AzureArmClient } from "./azure-arm-client.ts";

async function runArmClientTests() {
  console.log("Running AzureArmClient unit tests...");

  const mockConfig = {
    clientId: "mock-client-id",
    clientSecret: "mock-client-secret",
    tenantId: "mock-tenant-id",
    subscriptionId: "11111111-2222-3333-4444-555555555555",
    resourceGroup: "cowatch-rg",
    location: "eastus",
  };

  // -------------------------------------------------------------
  // Test 1: OAuth2 token acquisition & caching with /.default scope
  // -------------------------------------------------------------
  console.log("Test 1: OAuth2 token acquisition and caching...");
  let tokenPostCalls = 0;
  let tokenPostUrl = "";
  let tokenPostBody = "";

  const mockHttpToken: any = (config: any) => {
    return Promise.resolve({ status: 200, data: {} });
  };
  mockHttpToken.post = async (url: string, data: any) => {
    tokenPostCalls++;
    tokenPostUrl = url;
    tokenPostBody = data;
    return {
      status: 200,
      data: {
        access_token: "mock-bearer-token-xyz",
        expires_in: 3600,
      },
    };
  };

  const client1 = new AzureArmClient(mockConfig, mockHttpToken);

  const token1 = await client1.getAccessToken();
  assert.strictEqual(token1, "mock-bearer-token-xyz");
  assert.strictEqual(tokenPostCalls, 1);
  assert.ok(tokenPostUrl.includes("mock-tenant-id/oauth2/v2.0/token"));
  assert.ok(tokenPostBody.includes("scope=https%3A%2F%2Fmanagement.azure.com%2F.default"));
  assert.ok(tokenPostBody.includes("grant_type=client_credentials"));
  assert.ok(tokenPostBody.includes("client_id=mock-client-id"));

  // Second call should return cached token without calling post again
  const token2 = await client1.getAccessToken();
  assert.strictEqual(token2, "mock-bearer-token-xyz");
  assert.strictEqual(tokenPostCalls, 1, "Must return cached token without redundant HTTP call");

  // -------------------------------------------------------------
  // Test 2: Bounded Async Operation Polling (202 Accepted)
  // -------------------------------------------------------------
  console.log("Test 2: Bounded async operation polling...");

  let asyncPollCount = 0;
  const mockHttpAsync: any = async (req: any) => {
    if (req.url === "https://management.azure.com/async-ops/op-123") {
      asyncPollCount++;
      if (asyncPollCount === 1) {
        return { status: 200, data: { status: "InProgress" } };
      }
      return { status: 200, data: { status: "Succeeded" } };
    }
    return { status: 200, data: {} };
  };
  mockHttpAsync.post = mockHttpToken.post;

  const client2 = new AzureArmClient(mockConfig, mockHttpAsync);
  const mock202Response: any = {
    status: 202,
    headers: {
      "azure-asyncoperation": "https://management.azure.com/async-ops/op-123",
    },
  };

  await client2.pollAsyncOperation(mock202Response, 5000, 10);
  assert.strictEqual(asyncPollCount, 2, "Must poll until terminal status 'Succeeded'");

  // Test failure status rejection
  const mockHttpAsyncFail: any = async (req: any) => {
    if (req.url === "https://management.azure.com/async-ops/failing-op") {
      return {
        status: 200,
        data: { status: "Failed", error: { message: "Quota exceeded for B-series VMs" } },
      };
    }
    return { status: 200, data: {} };
  };
  mockHttpAsyncFail.post = mockHttpToken.post;

  const client2Fail = new AzureArmClient(mockConfig, mockHttpAsyncFail);
  const mockFailing202: any = {
    status: 202,
    headers: {
      "azure-asyncoperation": "https://management.azure.com/async-ops/failing-op",
    },
  };

  await assert.rejects(
    async () => {
      await client2Fail.pollAsyncOperation(mockFailing202, 5000, 10);
    },
    /Azure async operation failed with status "Failed": Quota exceeded for B-series VMs/,
    "Must reject with structured error on async failure"
  );

  // -------------------------------------------------------------
  // Test 3: Managed Image Resource ID validation
  // -------------------------------------------------------------
  console.log("Test 3: Managed Image Resource ID validation...");

  const validManagedImage =
    "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/cowatch-rg/providers/Microsoft.Compute/images/vbrowser-base-image";
  const invalidGalleryImage =
    "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/cowatch-rg/providers/Microsoft.Compute/galleries/myGallery/images/myImage/versions/1.0.0";
  const genericName = "vbrowser-ubuntu-22.04";

  let createdVmPayload: any = null;
  const mockHttpVm: any = async (config: any) => {
    if (config.method === "PUT" && config.url?.includes("/virtualMachines/")) {
      createdVmPayload = config.data;
      return { status: 200, data: { id: "vm-created" } };
    }
    return { status: 200, data: {} };
  };
  mockHttpVm.post = mockHttpToken.post;

  const client3 = new AzureArmClient(mockConfig, mockHttpVm);

  // Generic name must throw
  await assert.rejects(
    async () => {
      await client3.createVm({
        name: "test-vm",
        location: "eastus",
        vmSize: "Standard_B2s",
        imageId: genericName,
        adminUsername: "azureuser",
        sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2E...",
        nicId: "/subscriptions/.../networkInterfaces/test-vm-nic",
        tags: { vbrowser: "1" },
      });
    },
    /Invalid AZURE_IMAGE_ID/,
    "Must reject non-managed image identifier format"
  );

  // Gallery reference must throw in v1
  await assert.rejects(
    async () => {
      await client3.createVm({
        name: "test-vm",
        location: "eastus",
        vmSize: "Standard_B2s",
        imageId: invalidGalleryImage,
        adminUsername: "azureuser",
        sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2E...",
        nicId: "/subscriptions/.../networkInterfaces/test-vm-nic",
        tags: { vbrowser: "1" },
      });
    },
    /Invalid AZURE_IMAGE_ID/,
    "Must reject Azure Compute Gallery reference in v1"
  );

  // Valid Managed Image ID succeeds
  await client3.createVm({
    name: "test-vm",
    location: "eastus",
    vmSize: "Standard_B2s",
    imageId: validManagedImage,
    adminUsername: "azureuser",
    sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2E...",
    nicId: "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/cowatch-rg/providers/Microsoft.Network/networkInterfaces/test-vm-nic",
    tags: { vbrowser: "1" },
  });

  assert.ok(createdVmPayload, "createVm must succeed with valid Managed Image ID");
  assert.strictEqual(
    createdVmPayload.properties.storageProfile.imageReference.id,
    validManagedImage
  );
  assert.strictEqual(
    createdVmPayload.properties.storageProfile.osDisk.deleteOption,
    "Delete"
  );
  assert.strictEqual(
    createdVmPayload.properties.networkProfile.networkInterfaces[0].properties.deleteOption,
    "Delete"
  );

  // -------------------------------------------------------------
  // Test 4: Standard Static Public IP Creation
  // -------------------------------------------------------------
  console.log("Test 4: Standard Static Public IP creation...");
  let pipPayload: any = null;
  const mockHttpPip: any = async (config: any) => {
    if (config.method === "PUT" && config.url?.includes("/publicIPAddresses/")) {
      pipPayload = config.data;
      return { status: 200, data: { id: "mock-pip-id" } };
    }
    return { status: 200, data: {} };
  };
  mockHttpPip.post = mockHttpToken.post;

  const client4 = new AzureArmClient(mockConfig, mockHttpPip);
  const pipResult = await client4.createPublicIp("test-vm", "eastus", { vbrowser: "1" });
  assert.strictEqual(pipResult.id, "mock-pip-id");
  assert.strictEqual(pipPayload.sku.name, "Standard");
  assert.strictEqual(pipPayload.properties.publicIPAllocationMethod, "Static");

  // -------------------------------------------------------------
  // Test 5: Sequential Resource Deletion with 404 Resilience
  // -------------------------------------------------------------
  console.log("Test 5: Sequential resource deletion with 404 resilience...");
  const deletedUrls: string[] = [];

  const mockHttpDelete: any = async (config: any) => {
    if (config.method === "DELETE") {
      deletedUrls.push(config.url);
      // Simulate 404 on the NIC to verify 404 idempotency
      if (config.url?.includes("/networkInterfaces/")) {
        const err: any = new Error("Not Found");
        err.response = { status: 404 };
        throw err;
      }
      return { status: 200, data: {} };
    }
    return { status: 200, data: {} };
  };
  mockHttpDelete.post = mockHttpToken.post;

  const client5 = new AzureArmClient(mockConfig, mockHttpDelete);
  await client5.deleteVmWithDependencies("cleanup-vm");

  assert.strictEqual(deletedUrls.length, 4, "Must attempt sequential deletion of VM, NIC, PIP, and Disk");
  assert.ok(deletedUrls[0].includes("/virtualMachines/cleanup-vm"));
  assert.ok(deletedUrls[1].includes("/networkInterfaces/cleanup-vm-nic"));
  assert.ok(deletedUrls[2].includes("/publicIPAddresses/cleanup-vm-pip"));
  assert.ok(deletedUrls[3].includes("/disks/cleanup-vm-osdisk"));

  // -------------------------------------------------------------
  // Test 6: Network IP Lookup Chain (VM -> NIC -> Public IP)
  // -------------------------------------------------------------
  console.log("Test 6: Network IP lookup chain...");

  const mockHttpNet: any = async (config: any) => {
    if (config.url?.includes("/virtualMachines/lookup-vm")) {
      return {
        status: 200,
        data: {
          name: "lookup-vm",
          properties: {
            networkProfile: {
              networkInterfaces: [
                { id: "/subscriptions/111/resourceGroups/rg/providers/Microsoft.Network/networkInterfaces/lookup-vm-nic" },
              ],
            },
          },
        },
      };
    }
    if (config.url?.includes("/networkInterfaces/lookup-vm-nic")) {
      return {
        status: 200,
        data: {
          properties: {
            ipConfigurations: [
              {
                properties: {
                  publicIPAddress: { id: "/subscriptions/111/resourceGroups/rg/providers/Microsoft.Network/publicIPAddresses/lookup-vm-pip" },
                },
              },
            ],
          },
        },
      };
    }
    if (config.url?.includes("/publicIPAddresses/lookup-vm-pip")) {
      return {
        status: 200,
        data: {
          properties: {
            ipAddress: "20.50.100.200",
          },
        },
      };
    }
    return { status: 200, data: {} };
  };
  mockHttpNet.post = mockHttpToken.post;

  const client6 = new AzureArmClient(mockConfig, mockHttpNet);
  const netResult = await client6.getVmNetworking("lookup-vm");
  assert.strictEqual(netResult.id, "lookup-vm");
  assert.strictEqual(netResult.ip, "20.50.100.200");

  console.log("All AzureArmClient unit tests passed successfully!");
}

runArmClientTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("AzureArmClient unit test failed:", err);
    process.exit(1);
  });
