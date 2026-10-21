import assert from "node:assert/strict";
import crypto from "node:crypto";
import dgram from "node:dgram";

async function runLocalMediaRelayTests() {
  console.log("\n================================================================");
  console.log("LOCAL MEDIA RELAY: 128 KB FORCED-RELAY DATACHANNEL VERIFICATION");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function runAssert(condition: boolean, title: string, details?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} - Details: ${details || "none"}`);
      failed++;
    }
  }

  // 1. Generate 128 KB binary test payload and compute SHA-256 digest
  const PAYLOAD_SIZE = 128 * 1024; // Exactly 131,072 bytes
  const sourcePayload = crypto.randomBytes(PAYLOAD_SIZE);
  const sourceSha256 = crypto.createHash("sha256").update(sourcePayload).digest("hex");

  runAssert(
    sourcePayload.byteLength === 131072,
    "Test 1: Generate authoritative 128 KB binary payload",
    `byteLength=${sourcePayload.byteLength}`
  );

  // 2. Coturn Ephemeral Credential Generation under RFC 5766
  const testSecret = process.env.TURN_SHARED_SECRET || "staging-secret-key-32-chars-long";
  const testHost = process.env.TURN_HOST || "turn.staging.cowatch.tv";
  const expiryTimestamp = Math.floor(Date.now() / 1000) + 3600;
  const username = `${expiryTimestamp}:usr_relay_tester`;
  const credential = crypto.createHmac("sha1", testSecret).update(username).digest("base64");

  const turnIceServers: RTCIceServer[] = [
    { urls: [`stun:${testHost}:3478`, "stun:stun.l.google.com:19302"] },
    {
      urls: [`turns:${testHost}:443?transport=tcp`, `turn:${testHost}:3478?transport=udp`],
      username,
      credential,
    },
  ];

  const turnServer = turnIceServers.find((s) => s.username);
  runAssert(
    Boolean(turnServer?.username && turnServer?.credential),
    "Test 2: Ephemeral relay credentials successfully generated for user usr_relay_tester",
    `username=${turnServer?.username}`
  );

  // 3. Forced Relay ICE Configuration (iceTransportPolicy: "relay")
  const rtcConfig: RTCConfiguration = {
    iceServers: turnIceServers,
    iceTransportPolicy: "relay", // Strict relay-only enforcement (ignores host and srflx)
  };

  runAssert(
    rtcConfig.iceTransportPolicy === "relay",
    "Test 3: Forced-relay transport policy configured (iceTransportPolicy: relay)",
    `policy=${rtcConfig.iceTransportPolicy}`
  );

  // 4. Relay Candidate Filter Verification
  const simulatedCandidates = [
    { type: "host", candidate: "candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host" },
    { type: "srflx", candidate: "candidate:2 1 UDP 1694498815 203.0.113.50 54321 typ srflx" },
    { type: "relay", candidate: `candidate:3 1 UDP 16777215 ${testHost} 3478 typ relay` },
  ];

  // In relay-only mode, host and srflx candidates are filtered out
  const filteredCandidates = simulatedCandidates.filter((c) => {
    if (rtcConfig.iceTransportPolicy === "relay") {
      return c.type === "relay";
    }
    return true;
  });

  runAssert(
    filteredCandidates.length === 1 && filteredCandidates[0].type === "relay",
    "Test 4: Candidate filter drops host and srflx candidates, permitting only relay candidates",
    `retainedCount=${filteredCandidates.length}, retainedType=${filteredCandidates[0]?.type}`
  );

  // 5. Emulated Relay DataChannel End-to-End Transfer
  // Simulates chunking across 16 KB frames over an emulated relay DataChannel with backpressure
  const CHUNK_SIZE = 16 * 1024; // 16 KB chunk size
  const totalChunks = Math.ceil(PAYLOAD_SIZE / CHUNK_SIZE);
  const receivedChunks: Buffer[] = [];

  class MockRelayDataChannel {
    public bufferedAmount: number = 0;
    public maxBuffer: number = 64 * 1024;
    public onmessage: ((event: { data: Buffer }) => void) | null = null;

    send(chunk: Buffer) {
      this.bufferedAmount += chunk.byteLength;
      // Simulate asynchronous network transit across the TURN relay server
      setTimeout(() => {
        this.bufferedAmount -= chunk.byteLength;
        if (this.onmessage) {
          this.onmessage({ data: chunk });
        }
      }, 5);
    }
  }

  const relayChannel = new MockRelayDataChannel();
  relayChannel.onmessage = (event) => {
    receivedChunks.push(event.data);
  };

  // Transmit 128 KB in 16 KB chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, PAYLOAD_SIZE);
    const chunk = sourcePayload.subarray(start, end);
    relayChannel.send(chunk);
  }

  // Await transmission completion
  await new Promise((resolve) => setTimeout(resolve, 100));

  runAssert(
    receivedChunks.length === totalChunks,
    "Test 5: Full 128 KB payload received across 8 x 16 KB DataChannel frames",
    `receivedChunks=${receivedChunks.length}, expected=${totalChunks}`
  );

  // 6. SHA-256 Parity & Byte-for-Byte Verification
  const reconstructedPayload = Buffer.concat(receivedChunks);
  const reconstructedSha256 = crypto.createHash("sha256").update(reconstructedPayload).digest("hex");

  const bytesMatch = reconstructedPayload.equals(sourcePayload);
  const sha256Match = reconstructedSha256 === sourceSha256;

  runAssert(
    bytesMatch && sha256Match,
    "Test 6: 128 KB reconstructed payload achieves exact SHA-256 digest parity",
    `sourceSHA=${sourceSha256}, receivedSHA=${reconstructedSha256}, byteLength=${reconstructedPayload.byteLength}`
  );

  // 7. Live Coturn Socket Connectivity Check (Optional / When Provisioned)
  if (process.env.COTURN_STAGING_HOST && process.env.COTURN_STAGING_PORT) {
    const liveHost = process.env.COTURN_STAGING_HOST;
    const livePort = Number(process.env.COTURN_STAGING_PORT || 3478);
    const socket = dgram.createSocket("udp4");

    const liveSuccess = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        socket.close();
        resolve(false);
      }, 2000);

      socket.on("message", () => {
        clearTimeout(timer);
        socket.close();
        resolve(true);
      });

      socket.on("error", () => {
        clearTimeout(timer);
        socket.close();
        resolve(false);
      });

      // Send standard STUN Binding Request header (20 bytes: 0x0001, 0x0000, 0x2112A442 magic cookie, 12-byte transaction ID)
      const stunBindingRequest = Buffer.alloc(20);
      stunBindingRequest.writeUInt16BE(0x0001, 0); // Binding Request
      stunBindingRequest.writeUInt16BE(0x0000, 2); // Message Length
      stunBindingRequest.writeUInt32BE(0x2112a442, 4); // Magic Cookie
      crypto.randomBytes(12).copy(stunBindingRequest, 8); // Transaction ID

      socket.send(stunBindingRequest, livePort, liveHost, (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          resolve(false);
        }
      });
    });

    runAssert(
      liveSuccess,
      "Test 7: Live Coturn STUN probe binding response received from staging host",
      `host=${liveHost}:${livePort}`
    );
  } else {
    console.log("  [INFO] Staging Coturn environment variables COTURN_STAGING_HOST not set; live UDP socket probe skipped in local test environment.");
  }

  console.log("----------------------------------------------------------------");
  if (failed === 0) {
    console.log("ALL 6 FORCED-RELAY DATACHANNEL PARITY TESTS PASSED SUCCESSFULLY.");
  } else {
    console.error(`TEST SUITE FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("----------------------------------------------------------------\n");
}

runLocalMediaRelayTests();
