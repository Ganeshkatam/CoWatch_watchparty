import {
  saveAdmissionSession,
  loadAdmissionSession,
  clearAdmissionSession,
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

console.log("All roomAdmissionSession tests passed successfully!");
