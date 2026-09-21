import {
  saveAdmissionSession,
  loadAdmissionSession,
  clearAdmissionSession,
  restoreAdmissionSession,
} from "./roomAdmissionSession";

// Mock sessionStorage in Node / tsx environment
const storageMock: Record<string, string> = {};
(global as any).window = {
  sessionStorage: {
    getItem: (k: string) => storageMock[k] || null,
    setItem: (k: string, v: string) => {
      storageMock[k] = v;
    },
    removeItem: (k: string) => {
      delete storageMock[k];
    },
    clear: () => {
      Object.keys(storageMock).forEach((k) => delete storageMock[k]);
    },
  },
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error("Assertion failed: " + msg);
  }
}

async function runTests() {
  console.log("Starting roomAdmissionSession tests...");

  // Test 1: Save and load admission
  saveAdmissionSession("room-123", "token_abc_xyz", "session_987");
  const loaded = loadAdmissionSession("room-123");
  assert(loaded !== null, "loaded should not be null");
  assert(loaded?.admissionToken === "token_abc_xyz", "admissionToken mismatch");
  assert(loaded?.sessionId === "session_987", "sessionId mismatch");
  console.log("Passed: Save and load admission");

  // Test 2: Room ID mismatch returns null
  const wrongRoom = loadAdmissionSession("room-456");
  assert(wrongRoom === null, "wrong room should return null");
  console.log("Passed: Room ID mismatch rejection");

  // Test 3: Clear admission
  clearAdmissionSession("room-123");
  const afterClear = loadAdmissionSession("room-123");
  assert(afterClear === null, "afterClear should be null");
  console.log("Passed: Clear admission");

  // Test 4: Corruption handling (malformed JSON)
  (global as any).window.sessionStorage.setItem("cowatch_admission_corrupted-room", "{ bad json ");
  const corrupted = loadAdmissionSession("corrupted-room");
  assert(corrupted === null, "corrupted json should return null");
  console.log("Passed: Corruption handling");

  // Test 5: Invalid payload types (empty tokens, missing sessionId)
  (global as any).window.sessionStorage.setItem(
    "cowatch_admission_invalid-room",
    JSON.stringify({
      roomId: "invalid-room",
      admissionToken: "",
      sessionId: "abc",
      createdAt: Date.now(),
    })
  );
  const invalid = loadAdmissionSession("invalid-room");
  assert(invalid === null, "empty token should return null");
  console.log("Passed: Structural validation");

  // Test 6: restoreAdmissionSession single-flight deduplication and successful persistence
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(
      JSON.stringify({
        valid: true,
        admissionToken: "fresh_adm_token_1",
        sessionId: "fresh_session_1",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  try {
    const [p1, p2] = await Promise.all([
      restoreAdmissionSession("room-dedup", "http://localhost:8080", "tok-1", "user-1"),
      restoreAdmissionSession("room-dedup", "http://localhost:8080", "tok-1", "user-1"),
    ]);

    assert(p1.valid === true && p2.valid === true, "Both promises must succeed");
    assert(p1.admissionToken === "fresh_adm_token_1", "Must return correct token");
    assert(fetchCount === 1, `Single-flight must deduplicate concurrent calls, got ${fetchCount} fetches`);

    const stored = loadAdmissionSession("room-dedup");
    assert(stored?.admissionToken === "fresh_adm_token_1", "Restoration must persist valid session");
    console.log("Passed: restoreAdmissionSession single-flight deduplication & persistence");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Test 7: 401/403 clearance removes stale credentials
  saveAdmissionSession("room-401", "stale_token", "stale_session");
  assert(loadAdmissionSession("room-401") !== null, "Initial stale session must be present");

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({ error: "Session expired", code: "AUTH_EXPIRED" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  try {
    const res = await restoreAdmissionSession("room-401", "http://localhost:8080", "expired-tok", "user-1");
    assert(res.valid === false, "Expired session must fail restoration");
    assert(loadAdmissionSession("room-401") === null, "401 must clear stale admission session from storage");
    console.log("Passed: 401 clearance leaves zero stale credentials");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("All roomAdmissionSession tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
