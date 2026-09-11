import { isBottomNavVisible, isRouteActive } from "../components/Navigation/navigationPolicy";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("Testing isBottomNavVisible...");

// Hidden routes
assert(!isBottomNavVisible("/watch/test-room"), "Should hide on /watch/test-room");
assert(!isBottomNavVisible("/watch/abc-123/sub"), "Should hide on /watch nested");
assert(!isBottomNavVisible("/login"), "Should hide on /login");
assert(!isBottomNavVisible("/signup"), "Should hide on /signup");
assert(!isBottomNavVisible("/forgot-password"), "Should hide on /forgot-password");
assert(!isBottomNavVisible("/reset-password"), "Should hide on /reset-password");
assert(!isBottomNavVisible("/verify-email"), "Should hide on /verify-email");

// Visible routes
assert(isBottomNavVisible("/"), "Should show on /");
assert(isBottomNavVisible("/myrooms"), "Should show on /myrooms");
assert(isBottomNavVisible("/rooms/my-room-123"), "Should show on /rooms/:roomId");
assert(isBottomNavVisible("/create"), "Should show on /create");
assert(isBottomNavVisible("/profile"), "Should show on /profile");
assert(isBottomNavVisible("/account/profile"), "Should show on /account/profile");
assert(isBottomNavVisible("/account/preferences"), "Should show on /account/preferences");
assert(isBottomNavVisible("/account/security"), "Should show on /account/security");
assert(isBottomNavVisible("/terms"), "Should show on /terms");
assert(isBottomNavVisible("/privacy"), "Should show on /privacy");
assert(isBottomNavVisible("/faq"), "Should show on /faq");

console.log("Testing isRouteActive...");

assert(isRouteActive("/", "/"), "Root path should be active on /");
assert(!isRouteActive("/myrooms", "/"), "Root should not be active on /myrooms");
assert(isRouteActive("/myrooms", "/myrooms"), "/myrooms should be active on /myrooms");
assert(!isRouteActive("/rooms/detail-123", "/myrooms"), "/myrooms should NOT be active on /rooms/:roomId");
assert(isRouteActive("/create", "/create"), "/create should be active on /create");
assert(isRouteActive("/account/profile", "/account/profile"), "/account/profile should be active on /account/profile");
assert(isRouteActive("/faq", "/faq"), "/faq should be active on /faq");

console.log("All navigationPolicy tests passed successfully!");
