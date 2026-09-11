import assert from "node:assert/strict";
import config from "../config.ts";
import { Azure } from "./azure.ts";
import type { AzureArmClient } from "./azure-arm-client.ts";
import type { PoolConfig } from "./utils.ts";

async function runAzureAdapterTests() {
  console.log("Running Azure VMManager adapter tests...");

  const origGateway = config.AZURE_GATEWAY;
  const origImageId = config.AZURE_IMAGE_ID;

  config.AZURE_GATEWAY = "https://gw-azure.cowatch.tv";
  config.AZURE_IMAGE_ID =
    "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/cowatch-rg/providers/Microsoft.Compute/images/vbrowser-managed-image";

  try {
    // -------------------------------------------------------------
    // Test 1: Identity, Pool Names & Defaults
    // -------------------------------------------------------------
    console.log("Test 1: Identity and pool names...");
    const standardPool: PoolConfig = {
      provider: "Azure",
      isLarge: false,
      region: "US",
      limitSize: 10,
      minSize: 0,
      hostname: undefined,
    };
    const largePool: PoolConfig = {
      provider: "Azure",
      isLarge: true,
      region: "US",
      limitSize: 5,
      minSize: 0,
      hostname: undefined,
    };

    const azureStd = new Azure(standardPool, {} as any);
    const azureLarge = new Azure(largePool, {} as any);

    assert.strictEqual(azureStd.id, "Azure");
    assert.strictEqual(azureStd.getPoolName(), "AzureUS");
    assert.strictEqual(azureLarge.getPoolName(), "AzureLargeUS");
    assert.strictEqual(azureStd.getIsLarge(), false);
    assert.strictEqual(azureLarge.getIsLarge(), true);

    // -------------------------------------------------------------
    // Test 2: startVM orchestration (Public IP -> NIC -> VM)
    // -------------------------------------------------------------
    console.log("Test 2: startVM orchestration...");
    let pipCreatedWith: any = null;
    let nicCreatedWith: any = null;
    let vmCreatedWith: any = null;

    const mockClient: Partial<AzureArmClient> = {
      createPublicIp: async (name, location, tags) => {
        pipCreatedWith = { name, location, tags };
        return { id: `/subscriptions/111/.../publicIPAddresses/${name}-pip` };
      },
      createNic: async (name, location, subnetId, publicIpId, tags) => {
        nicCreatedWith = { name, location, subnetId, publicIpId, tags };
        return { id: `/subscriptions/111/.../networkInterfaces/${name}-nic` };
      },
      createVm: async (params) => {
        vmCreatedWith = params;
        return { id: params.name };
      },
      deleteVmWithDependencies: async (name) => {},
      restartVm: async (name) => {},
      startVm: async (name) => {},
      getVmNetworking: async (name) => ({
        id: name,
        ip: "20.100.200.50",
        rawVm: { name },
      }),
      listVms: async (filter) => [
        { name: "vm-1", ip: "20.100.200.51", tags: { [filter || ""]: "1" } },
      ],
    };

    const azureManager = new Azure(standardPool, mockClient as AzureArmClient);
    const vmName = await azureManager.startVM("test-azure-vm-1");

    assert.strictEqual(vmName, "test-azure-vm-1");
    assert.strictEqual(pipCreatedWith.name, "test-azure-vm-1");
    assert.strictEqual(nicCreatedWith.name, "test-azure-vm-1");
    assert.strictEqual(vmCreatedWith.name, "test-azure-vm-1");
    assert.strictEqual(vmCreatedWith.vmSize, "Standard_B2s");

    // Large pool should use Standard_B4ms
    const azureLargeManager = new Azure(largePool, mockClient as AzureArmClient);
    await azureLargeManager.startVM("test-azure-vm-large");
    assert.strictEqual(vmCreatedWith.vmSize, "Standard_B4ms");

    // -------------------------------------------------------------
    // Test 3: terminateVM delegates to deleteVmWithDependencies
    // -------------------------------------------------------------
    console.log("Test 3: terminateVM...");
    let deletedVmName = "";
    mockClient.deleteVmWithDependencies = async (name) => {
      deletedVmName = name;
    };

    await azureManager.terminateVM("vm-to-delete");
    assert.strictEqual(deletedVmName, "vm-to-delete");

    // -------------------------------------------------------------
    // Test 4: rebootVM & powerOn
    // -------------------------------------------------------------
    console.log("Test 4: rebootVM & powerOn...");
    let rebootedVmName = "";
    let startedVmName = "";
    mockClient.restartVm = async (name) => {
      rebootedVmName = name;
    };
    mockClient.startVm = async (name) => {
      startedVmName = name;
    };

    await azureManager.rebootVM("vm-to-reboot");
    assert.strictEqual(rebootedVmName, "vm-to-reboot");

    await azureManager.powerOn("vm-to-power-on");
    assert.strictEqual(startedVmName, "vm-to-power-on");

    // -------------------------------------------------------------
    // Test 5: reimageVM throws typed unsupported error in v1
    // -------------------------------------------------------------
    console.log("Test 5: reimageVM throws typed unsupported error...");
    await assert.rejects(
      async () => {
        await azureManager.reimageVM("any-vm");
      },
      /Azure provider does not support automated OS disk reimaging in v1/,
      "reimageVM must throw typed unsupported error"
    );

    // -------------------------------------------------------------
    // Test 6: updateSnapshot throws typed unsupported error
    // -------------------------------------------------------------
    console.log("Test 6: updateSnapshot throws typed unsupported error...");
    await assert.rejects(
      async () => {
        await azureManager.updateSnapshot();
      },
      /Azure provider does not support automated snapshot updates/,
      "updateSnapshot must throw typed unsupported error rather than silent empty string"
    );

    // -------------------------------------------------------------
    // Test 7: getVM & listVMs with gateway mapping
    // -------------------------------------------------------------
    console.log("Test 7: getVM & listVMs gateway URL mapping...");
    const vmObj = await azureManager.getVM("test-azure-vm-1");
    assert.strictEqual(vmObj.id, "test-azure-vm-1");
    assert.strictEqual(vmObj.host, "https://gw-azure.cowatch.tv/?ip=20.100.200.50");
    assert.strictEqual(vmObj.provider, "Azure");
    assert.strictEqual(vmObj.large, false);
    assert.strictEqual(vmObj.region, "US");

    const vmsList = await azureManager.listVMs(azureManager.getTag());
    assert.strictEqual(vmsList.length, 1);
    assert.strictEqual(vmsList[0].id, "vm-1");
    assert.strictEqual(vmsList[0].host, "https://gw-azure.cowatch.tv/?ip=20.100.200.51");

    console.log("All Azure VMManager adapter tests passed successfully!");
  } finally {
    config.AZURE_GATEWAY = origGateway;
    config.AZURE_IMAGE_ID = origImageId;
  }
}

runAzureAdapterTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Azure adapter test failed:", err);
    process.exit(1);
  });
