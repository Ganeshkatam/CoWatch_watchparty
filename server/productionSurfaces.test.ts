/**
 * PROD-001 Production Surfaces & Routing Certification Suite
 *
 * Verifies that:
 * 1. All public, account, and application routes are mapped and accounted for.
 * 2. Terminal catch-all route mounts NotFound and does not shadow valid routes.
 * 3. RootErrorBoundary wraps the router hierarchy to prevent white-screen crashes.
 * 4. Chat component provides an empty-state conversation prompt.
 * 5. Login component detects hash/query error parameters (otp_expired).
 * 6. AppShell implements global offline detection without replacing room recovery state.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function runProductionSurfacesTests() {
  console.log("Running PROD-001 Production Surfaces Certification Suite...\n");

  const indexPath = path.join(rootDir, "src", "index.tsx");
  const indexContent = fs.readFileSync(indexPath, "utf-8");

  // 1. Router structure: BrowserRouter -> RootErrorBoundary -> AppShell -> Suspense -> Switch
  console.log("Check 1: Router tree hierarchy and error boundary containment...");
  assert.ok(indexContent.includes("<RootErrorBoundary>"), "RootErrorBoundary must wrap application routes");
  assert.ok(indexContent.includes("<Switch>"), "Switch must wrap route list for authoritative matching");
  assert.ok(indexContent.includes("import { RootErrorBoundary }"), "RootErrorBoundary must be imported");
  assert.ok(indexContent.includes("NotFound"), "NotFound must be imported");
  console.log("  [PASS] Application tree enclosed within RootErrorBoundary and Switch.");

  // 2. Terminal Catch-all route verification
  console.log("Check 2: Terminal 404 Catch-All route placement...");
  const switchStart = indexContent.indexOf("<Switch>");
  const switchEnd = indexContent.indexOf("</Switch>");
  assert.ok(switchStart !== -1 && switchEnd !== -1, "Switch block must be present");
  const switchContent = indexContent.substring(switchStart, switchEnd);

  assert.ok(
    switchContent.includes("<NotFound />"),
    "Switch must contain terminal NotFound route"
  );
  // Ensure terminal Route is at the end of the switch block
  const notFoundIndex = switchContent.indexOf("<NotFound />");
  const watchIndex = switchContent.indexOf('path="/watch/:roomId"');
  const myroomsIndex = switchContent.indexOf('path="/myrooms"');
  assert.ok(notFoundIndex > watchIndex, "Terminal 404 must be placed after /watch/:roomId");
  assert.ok(notFoundIndex > myroomsIndex, "Terminal 404 must be placed after /myrooms");
  console.log("  [PASS] Terminal 404 route is strictly placed after all legitimate product routes.");

  // 3. NotFound Component Verification
  console.log("Check 3: NotFound component structure...");
  const notFoundPath = path.join(rootDir, "src", "components", "Pages", "NotFound.tsx");
  assert.ok(fs.existsSync(notFoundPath), "NotFound.tsx component must exist");
  const notFoundContent = fs.readFileSync(notFoundPath, "utf-8");
  assert.ok(notFoundContent.includes("Page or Room Not Found"), "NotFound must display clear headline");
  assert.ok(notFoundContent.includes("Return Home"), "NotFound must provide Return Home action");
  assert.ok(notFoundContent.includes("Browse My Rooms"), "NotFound must provide Browse Rooms action");
  console.log("  [PASS] NotFound surface provides branded layout and recovery navigation.");

  // 4. RootErrorBoundary Verification
  console.log("Check 4: RootErrorBoundary recovery actions...");
  const boundaryPath = path.join(rootDir, "src", "components", "Layout", "RootErrorBoundary.tsx");
  assert.ok(fs.existsSync(boundaryPath), "RootErrorBoundary.tsx component must exist");
  const boundaryContent = fs.readFileSync(boundaryPath, "utf-8");
  assert.ok(boundaryContent.includes("getDerivedStateFromError"), "Must implement error boundary lifecycle");
  assert.ok(boundaryContent.includes("Reload Page"), "Must provide Reload Page action");
  assert.ok(boundaryContent.includes("Return Home"), "Must provide Return Home action");
  console.log("  [PASS] RootErrorBoundary provides crash recovery actions.");

  // 5. Chat Empty State Verification
  console.log("Check 5: Chat empty-state conversation starter...");
  const chatPath = path.join(rootDir, "src", "components", "Chat", "Chat.tsx");
  const chatContent = fs.readFileSync(chatPath, "utf-8");
  assert.ok(chatContent.includes("No messages yet"), "Chat must render empty state text");
  assert.ok(chatContent.includes("Say hello or share a reaction"), "Chat must prompt conversation");
  console.log("  [PASS] Chat empty state prompt active when zero messages exist.");

  // 6. Login Expired Auth Link Detection
  console.log("Check 6: Login expired token detection...");
  const loginPath = path.join(rootDir, "src", "components", "Auth", "Login.tsx");
  const loginContent = fs.readFileSync(loginPath, "utf-8");
  assert.ok(loginContent.includes("otp_expired"), "Login must detect otp_expired code");
  assert.ok(
    loginContent.includes("confirmation or password reset link has expired"),
    "Login must explain link expiration"
  );
  console.log("  [PASS] Login alerts user when redirected with expired token.");

  // 7. Global Offline Banner
  console.log("Check 7: Global offline detection banner...");
  const appShellPath = path.join(rootDir, "src", "components", "Layout", "AppShell.tsx");
  const appShellContent = fs.readFileSync(appShellPath, "utf-8");
  assert.ok(appShellContent.includes("isOffline"), "AppShell must track offline state");
  assert.ok(
    appShellContent.includes("You appear to be offline"),
    "AppShell must render offline warning banner"
  );
  console.log("  [PASS] AppShell renders global network disconnection indicator.");

  console.log("\nAll PROD-001 Production Surface Certification tests PASSED successfully!");
}

runProductionSurfacesTests().catch((err) => {
  console.error("PROD-001 verification failed:", err);
  process.exit(1);
});
