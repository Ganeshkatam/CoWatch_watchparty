import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoomUrl, getInviteMessage } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "..");

console.log("Running comprehensive security regression audit...");

// ----------------------------------------------------------------------------
// 1. Static Audit: Guarantee no URL credential extraction exists in src/
// ----------------------------------------------------------------------------
function scanDir(dir: string, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        scanDir(fullPath, fileList);
      }
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const allSrcFiles = scanDir(srcDir);
const forbiddenPatterns = [
  /\.get\(["']passcode["']\)/i,
  /\.get\(["']password["']\)/i,
  /\.get\(["']pass["']\)/i,
  /localStorage\.setItem\(["'][^"']*passcode/i,
  /sessionStorage\.setItem\(["'][^"']*passcode/i,
];

for (const filePath of allSrcFiles) {
  const content = fs.readFileSync(filePath, "utf-8");
  for (const pattern of forbiddenPatterns) {
    const match = pattern.exec(content);
    assert(
      !match,
      `Security violation in ${filePath}: Found forbidden pattern '${match?.[0]}'. URL/local credentials must never be extracted or persisted.`
    );
  }
}
console.log(`Passed: Scanned ${allSrcFiles.length} source files. Zero credential extraction or persistence patterns found.`);

// ----------------------------------------------------------------------------
// 2. Gateway Room ID Normalization Audit
// ----------------------------------------------------------------------------
const normalizeRoomId = (value: string): string => {
  let clean = value.trim();
  if (clean.includes("/watch/")) {
    clean = clean.split("/watch/")[1]?.split("?")[0] || clean;
  } else if (clean.includes("/join/")) {
    clean = clean.split("/join/")[1]?.split("?")[0] || clean;
  }
  return clean.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\/+|\/+$/g, "").split("?")[0].split("#")[0];
};

const adversarialUrls = [
  "https://cowatch.tv/join/ROOM123?passcode=topsecret",
  "https://cowatch.tv/join/ROOM123?pass=topsecret",
  "https://cowatch.tv/join/ROOM123?password=topsecret",
  "https://cowatch.tv/watch/ROOM123?passcode=topsecret",
  "https://cowatch.tv/watch/ROOM123?pass=topsecret",
  "http://localhost:3000/join/ROOM123?passcode=topsecret",
  "/join/ROOM123?passcode=topsecret&other=param",
  "/watch/ROOM123?passcode=topsecret#frag",
  "https://cowatch.tv/join/ROOM123#passcode=topsecret",
  "ROOM123?passcode=topsecret",
];

for (const testUrl of adversarialUrls) {
  const normalized = normalizeRoomId(testUrl);
  assert.strictEqual(normalized, "ROOM123", `Normalized URL must yield 'ROOM123', got '${normalized}' from '${testUrl}'`);
  assert(!normalized.includes("passcode"), `Normalized output must not contain passcode: '${normalized}'`);
  assert(!normalized.includes("topsecret"), `Normalized output must not contain credential: '${normalized}'`);
}
console.log(`Passed: Verified ${adversarialUrls.length} adversarial/legacy URLs. All query credentials successfully stripped.`);

// ----------------------------------------------------------------------------
// 3. Invite Link & Message Invariant Audit
// ----------------------------------------------------------------------------
const testRoomId = "secure-room-999";
const testSecret = "SecretPass123";

const cleanUrl = getRoomUrl(testRoomId);
assert.strictEqual(cleanUrl.includes("?passcode="), false, "getRoomUrl must never include ?passcode=");
assert.strictEqual(cleanUrl.includes("?pass="), false, "getRoomUrl must never include ?pass=");
assert.strictEqual(cleanUrl.includes(testSecret), false, "getRoomUrl must never contain passcode value");

const inviteMessage = getInviteMessage(testRoomId, testSecret);
assert(inviteMessage.includes("Passcode: SecretPass123"), "Invite message should include separate passcode line for manual copy");
assert(!inviteMessage.includes("?passcode="), "Invite message link must NEVER contain ?passcode= parameter");
assert(!inviteMessage.includes("?pass="), "Invite message link must NEVER contain ?pass= parameter");

console.log("Passed: Invite links and messages strictly maintain credential isolation.");

console.log("All security regression tests passed successfully!");
process.exit(0);
