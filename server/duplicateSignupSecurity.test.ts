import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendDuplicateSignupSecurityAlert } from "./notifications/securityAlerts.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runDuplicateSignupSecurityTests(): Promise<void> {
  const options = {
    email: "registered-user@gmail.com",
    ipAddress: "203.0.113.42",
    attemptedAt: new Date("2026-09-15T12:00:00Z"),
  };
  let requestedUrl = "";
  let requestedAuthorization = "";
  let requestedBody: Record<string, unknown> = {};

  const result = await sendDuplicateSignupSecurityAlert(options, async (input, init) => {
    requestedUrl = String(input);
    requestedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      accepted: true,
      provider: "brevo",
      providerMessageId: "security-message-1",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, {
    url: "https://email.example.test",
    apiSecret: "t".repeat(40),
  });

  assert.deepEqual(result, {
    accepted: true,
    provider: "brevo:security",
    providerMessageId: "security-message-1",
  });
  assert.equal(requestedUrl, "https://email.example.test/internal/send/duplicate-signup-alert");
  assert.equal(requestedAuthorization, "Bearer test-secret");
  assert.equal(requestedBody.email, options.email);
  assert.equal(requestedBody.ipAddress, options.ipAddress);
  assert.equal(requestedBody.attemptedAt, options.attemptedAt.toISOString());
  assert.equal("userAgent" in requestedBody, false);

  const failed = await sendDuplicateSignupSecurityAlert(options, async () =>
    new Response("unavailable", { status: 503 }), {
      url: "https://email.example.test",
      apiSecret: "test-secret",
    });
  assert.equal(failed, null);

  const signupPath = path.join(rootDir, "src", "components", "Auth", "Signup.tsx");
  const signupContent = fs.readFileSync(signupPath, "utf8");
  assert.ok(signupContent.includes("/api/auth/duplicate-signup-alert"));
  assert.ok(signupContent.includes("We've sent a confirmation link to your email address. Please confirm your email to sign in."));
  assert.ok(signupContent.includes("!isDuplicate &&"));
  assert.ok(signupContent.includes("if (isDuplicate || resendCooldown > 0 || !email) return;"));

  const routerPath = path.join(rootDir, "server", "routes", "authAccountRouter.ts");
  const routerContent = fs.readFileSync(routerPath, "utf8");
  assert.ok(routerContent.includes('router.post("/api/auth/duplicate-signup-alert"'));
  assert.ok(routerContent.includes("checkRateLimit"));
  assert.ok(routerContent.includes("getUserByEmail"));

  console.log("Duplicate signup anti-enumeration and remote email service tests passed.");
}

runDuplicateSignupSecurityTests().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
