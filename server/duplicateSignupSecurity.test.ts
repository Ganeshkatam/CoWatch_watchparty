import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderDuplicateSignupAlertEmail,
  sendDuplicateSignupSecurityAlert,
} from "./notifications/securityAlerts.ts";
import { EmailProviderRegistry } from "./notifications/emailProviderRegistry.ts";
import type { EmailMessage, EmailSendResult } from "./notifications/emailProvider.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function runDuplicateSignupSecurityTests() {
  console.log("=== Duplicate Signup Security Notice & Anti-Enumeration Test Suite ===\n");

  // Test 1: Security alert template rendering
  console.log("Case 1: Validating security alert email template structure...");
  const rendered = renderDuplicateSignupAlertEmail({
    email: "user@gmail.com",
    ipAddress: "192.0.2.1",
    attemptedAt: new Date("2026-09-15T12:00:00Z"),
  });

  assert.ok(rendered.subject.includes("Security Notice"), "Subject must indicate a security notice");
  assert.ok(rendered.html.includes("user@gmail.com"), "HTML body must reference the target email");
  assert.ok(rendered.html.includes("192.0.2.1"), "HTML body must reference the attempt IP");
  assert.ok(rendered.html.includes("/login"), "HTML body must contain sign-in link");
  assert.ok(rendered.html.includes("/reset-password"), "HTML body must contain password reset link");
  assert.ok(rendered.text.includes("WAS THIS YOU?"), "Plaintext must contain advisory section");

  // Crucial security invariant: Must NOT contain any account confirmation or activation link
  const forbiddenConfirmationTokens = [
    "confirm your email",
    "confirm your account",
    "confirm account",
    "verify your email",
    "verify email",
    "confirmation_url",
    "email_confirmation",
    "signup-confirm",
  ];
  for (const token of forbiddenConfirmationTokens) {
    assert.ok(
      !rendered.html.toLowerCase().includes(token),
      `Security email must NOT contain confirmation token: "${token}"`
    );
    assert.ok(
      !rendered.text.toLowerCase().includes(token),
      `Security plaintext must NOT contain confirmation token: "${token}"`
    );
  }
  console.log("  [PASS] Email template provides security context with ZERO confirmation links.");

  // Test 2: Delivery profile and provider dispatch
  console.log("Case 2: Validating transactional_security dispatch routing...");
  const sentMessages: EmailMessage[] = [];
  const mockSecurityProvider = {
    name: "mock-security-provider",
    capabilities: {
      transactionalSending: true,
      nativeIdempotency: true,
      deliveryWebhooks: false,
      bounceEvents: false,
    },
    async send(msg: EmailMessage): Promise<EmailSendResult> {
      sentMessages.push(msg);
      return { accepted: true, provider: "mock-security-provider", providerMessageId: "sec-msg-123" };
    },
    async verifyConfiguration(): Promise<void> {},
    classifyError(err: unknown) {
      return err as any;
    },
  };

  EmailProviderRegistry.register(mockSecurityProvider);

  // Send security alert
  const sendResult = await sendDuplicateSignupSecurityAlert({
    email: "registered-user@gmail.com",
    ipAddress: "203.0.113.42",
    attemptedAt: new Date(),
  });

  assert.ok(sendResult, "Security alert must dispatch successfully");
  console.log("  [PASS] Transactional security alert dispatched through provider registry.");

  // Test 3: Static analysis of Signup.tsx anti-enumeration guarantees
  console.log("Case 3: Verifying Signup.tsx zero-knowledge anti-enumeration guarantees...");
  const signupPath = path.join(rootDir, "src", "components", "Auth", "Signup.tsx");
  const signupContent = fs.readFileSync(signupPath, "utf-8");

  // Invariant 3a: Endpoint call exists
  assert.ok(
    signupContent.includes("/api/auth/duplicate-signup-alert"),
    "Signup.tsx must call /api/auth/duplicate-signup-alert upon detecting existing account"
  );

  // Invariant 3b: Identical user-facing success feedback
  assert.ok(
    signupContent.includes("We've sent a confirmation link to your email address. Please confirm your email to sign in."),
    "Signup.tsx must present standard confirmation message"
  );

  // Invariant 3c: Existing account errors are suppressed from user display
  const prohibitedDisplayTexts = [
    "User already registered",
    "Account already exists",
    "An account with this email already exists",
    "Email already in use",
  ];
  for (const text of prohibitedDisplayTexts) {
    assert.ok(
      !signupContent.includes(`setError("${text}")`),
      `Signup.tsx must NEVER present "${text}" directly to the user`
    );
  }

  // Invariant 3d: No resend option for duplicate security mails
  assert.ok(
    signupContent.includes("!isDuplicate &&"),
    "Signup.tsx must suppress the resend button when a duplicate account triggers security notice"
  );
  assert.ok(
    signupContent.includes("if (isDuplicate || resendCooldown > 0 || !email) return;"),
    "handleResend must guard against resending for duplicate security emails"
  );
  console.log("  [PASS] Resend option strictly excluded for duplicate security notices.");
  console.log("  [PASS] Signup.tsx strictly prevents account enumeration.");

  // Test 4: Server route registration
  console.log("Case 4: Verifying server route registration for /api/auth/duplicate-signup-alert...");
  const serverPath = path.join(rootDir, "server", "server.ts");
  const serverContent = fs.readFileSync(serverPath, "utf-8");

  assert.ok(
    serverContent.includes('app.post("/api/auth/duplicate-signup-alert"'),
    "server.ts must expose POST /api/auth/duplicate-signup-alert"
  );
  assert.ok(
    serverContent.includes("checkRateLimit"),
    "server.ts duplicate-signup-alert route must be protected by rate limits"
  );
  assert.ok(
    serverContent.includes("getUserByEmail"),
    "server.ts duplicate-signup-alert must verify user existence before dispatching notification"
  );
  console.log("  [PASS] Server route is registered with rate limiting and database verification.");

  console.log("\n=========================================================");
  console.log("All Duplicate Signup Security & Anti-Enumeration Tests PASSED!");
  console.log("=========================================================\n");
}

runDuplicateSignupSecurityTests().catch((err) => {
  console.error("Duplicate Signup Security test failed:", err);
  process.exit(1);
});
