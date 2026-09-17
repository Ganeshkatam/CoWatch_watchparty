import {
  getRoomUrl,
  getInviteMessage,
  addAndSavePasscode,
  getSavedPasscodes,
  removeSavedPasscode,
} from "./utils";
import { formatInvitationMessage } from "./notificationAction";

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
assert(
  msgNoPass.includes("Passcode: [Passcode Required - Ask Host]"),
  "Message without passcode must still include Passcode requirement line"
);
assert(msgNoPass.includes("`test-room-1`"), "Message must include individually copyable room ID block");
assert(msgNoPass.includes("https://cowatch.example.com/join/test-room-1"), "Message must include clean join link");

const msgWithPass = getInviteMessage("test-room-1", "secret123");
assert(msgWithPass.includes("`secret123`"), "Message must include individually copyable passcode block");
assert(msgWithPass.includes("`test-room-1`"), "Message must include individually copyable room ID block");
assert(
  msgWithPass.includes("https://cowatch.example.com/join/test-room-1"),
  "Message must include clean join link"
);
assert(
  !msgWithPass.includes("?passcode="),
  "Message link must NEVER contain passcode query parameter"
);

console.log("Testing formatInvitationMessage canonical output...");
const canonicalMsg = formatInvitationMessage({
  roomId: "room-abc",
  roomTitle: "Cyberpunk 2077 Night",
  passcode: "pass8888",
  invitationUrl: "https://cowatch.example.com/invite/token123",
  inviterName: "Alice",
});
assert(canonicalMsg.includes("You're invited to a CoWatch watch party!"), "Must contain header");
assert(canonicalMsg.includes('"Cyberpunk 2077 Night"'), "Must contain room title");
assert(canonicalMsg.includes("Alice invited you to join."), "Must contain inviter");
assert(canonicalMsg.includes("Join: https://cowatch.example.com/invite/token123"), "Must contain invitation URL");
assert(canonicalMsg.includes("Room ID: room-abc"), "Must contain Room ID fallback");
assert(canonicalMsg.includes("Passcode: pass8888"), "Must contain Passcode fallback");
assert(canonicalMsg.includes("See you there!"), "Must contain closing");
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
assert(!emojiRegex.test(canonicalMsg), "Canonical invitation message must contain ZERO emojis");

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
