import {
  getRoomUrl,
  getInviteMessage,
  addAndSavePasscode,
  getSavedPasscodes,
  removeSavedPasscode,
} from "./utils";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Mock window.location and window.localStorage for node testing
const store: Record<string, string> = {};
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {
    location: {
      origin: "https://cowatch.example.com",
    },
    localStorage: {
      getItem: (k: string) => store[k] || null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
}

console.log("Testing getRoomUrl without stored passcodes...");

const urlNoPasscode = getRoomUrl("test-room-1");
assert(
  urlNoPasscode === "https://cowatch.example.com/join/test-room-1",
  `Expected url without passcode, got ${urlNoPasscode}`
);

const urlWithCleanId = getRoomUrl("/test-room-2");
assert(
  urlWithCleanId === "https://cowatch.example.com/join/test-room-2",
  `Expected normalized url without leading slash, got ${urlWithCleanId}`
);

console.log("Testing getInviteMessage...");

const msgNoPass = getInviteMessage("test-room-1");
assert(!msgNoPass.includes("Passcode:"), "Message without passcode must not include Passcode field");
assert(msgNoPass.includes("Room ID: test-room-1"), "Message must include room ID");
assert(msgNoPass.includes("https://cowatch.example.com/join/test-room-1"), "Message must include clean join link");

const msgWithPass = getInviteMessage("test-room-1", "secret123");
assert(msgWithPass.includes("Passcode: secret123"), "Message must include passcode as separate line");
assert(msgWithPass.includes("Room ID: test-room-1"), "Message must include room ID");
assert(
  msgWithPass.includes("https://cowatch.example.com/join/test-room-1"),
  "Message must include clean join link"
);
assert(
  !msgWithPass.includes("?passcode="),
  "Message link must NEVER contain passcode query parameter"
);

console.log("Testing local storage verification (must NEVER store passcodes)...");

addAndSavePasscode("test-room-1", "secret123");
assert(
  store["cowatch-passcodes"] === undefined,
  "localStorage must NOT contain cowatch-passcodes after addAndSavePasscode"
);

const saved = getSavedPasscodes();
assert(
  Object.keys(saved).length === 0,
  "getSavedPasscodes must always return empty object"
);

// If cowatch-passcodes is somehow pre-existing in localStorage, verify it is purged
store["cowatch-passcodes"] = JSON.stringify({ old: "stale" });
removeSavedPasscode("old");
assert(
  store["cowatch-passcodes"] === undefined,
  "removeSavedPasscode must purge cowatch-passcodes from localStorage"
);

console.log("All invite & passcode storage tests passed successfully!");
