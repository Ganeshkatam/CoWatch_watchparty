import assert from "node:assert/strict";
import {
  parseBoolean,
  parseBoundedInteger,
  parseOptionalInteger,
  createConfig,
  defaults,
} from "./config.ts";
import { SMTPEmailProvider } from "./notifications/providers/smtpEmailProvider.ts";

function test(name: string, fn: () => void | Promise<void>) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function runTests() {
  console.log("=== Centralized Configuration & Type Coercion Test Suite ===\n");

  console.log("1. parseBoolean parsing & validation...");
  test("returns fallback on undefined or null", () => {
    assert.equal(parseBoolean(undefined, false), false);
    assert.equal(parseBoolean(undefined, true), true);
    assert.equal(parseBoolean(null, false), false);
    assert.equal(parseBoolean(null, true), true);
  });

  test("returns fallback on empty or whitespace-only string", () => {
    assert.equal(parseBoolean("", false), false);
    assert.equal(parseBoolean("", true), true);
    assert.equal(parseBoolean("   ", false), false);
    assert.equal(parseBoolean(" \t\n ", true), true);
  });

  test("accepts native boolean values", () => {
    assert.equal(parseBoolean(true, false), true);
    assert.equal(parseBoolean(false, true), false);
  });

  test("parses truthy strings correctly with whitespace handling", () => {
    assert.equal(parseBoolean("true", false), true);
    assert.equal(parseBoolean("True", false), true);
    assert.equal(parseBoolean("TRUE", false), true);
    assert.equal(parseBoolean(" true ", false), true);
    assert.equal(parseBoolean("1", false), true);
    assert.equal(parseBoolean(" 1 ", false), true);
  });

  test("parses falsy strings correctly with whitespace handling", () => {
    assert.equal(parseBoolean("false", true), false);
    assert.equal(parseBoolean("False", true), false);
    assert.equal(parseBoolean("FALSE", true), false);
    assert.equal(parseBoolean(" false ", true), false);
    assert.equal(parseBoolean("0", true), false);
    assert.equal(parseBoolean(" 0 ", true), false);
  });

  test("rejects malformed boolean strings", () => {
    assert.throws(
      () => parseBoolean("abc", false, "TEST_BOOL"),
      /\[CONFIG ERROR\] Invalid boolean configuration value for TEST_BOOL: "abc"/
    );
    assert.throws(
      () => parseBoolean("yes", false),
      /\[CONFIG ERROR\] Invalid boolean configuration value: "yes"/
    );
    assert.throws(
      () => parseBoolean("no", false),
      /\[CONFIG ERROR\] Invalid boolean configuration value: "no"/
    );
    assert.throws(
      () => parseBoolean("12.5", false),
      /\[CONFIG ERROR\] Invalid boolean configuration value: "12.5"/
    );
    assert.throws(
      () => parseBoolean("2", false),
      /\[CONFIG ERROR\] Invalid boolean configuration value: "2"/
    );
  });

  console.log("\n2. parseBoundedInteger parsing & validation...");
  test("returns fallback on undefined or null", () => {
    assert.equal(parseBoundedInteger(undefined, 8080), 8080);
    assert.equal(parseBoundedInteger(null, 587), 587);
  });

  test("returns fallback on empty or whitespace string", () => {
    assert.equal(parseBoundedInteger("", 8080), 8080);
    assert.equal(parseBoundedInteger("   ", 8080), 8080);
  });

  test("accepts valid numbers and trims whitespace", () => {
    assert.equal(parseBoundedInteger(8080, 3000), 8080);
    assert.equal(parseBoundedInteger("8080", 3000), 8080);
    assert.equal(parseBoundedInteger(" 8080 ", 3000), 8080);
  });

  test("handles zero strictly based on minimum boundary", () => {
    // Permitted where min is 0
    assert.equal(
      parseBoundedInteger("0", 10, { min: 0, max: 500, propertyName: "ROOM_CAPACITY" }),
      0
    );
    // Rejected where min is 1
    assert.throws(
      () => parseBoundedInteger("0", 8080, { min: 1, max: 65535, propertyName: "PORT" }),
      /\[CONFIG ERROR\] Value 0 for PORT is below minimum allowed 1/
    );
  });

  test("rejects non-integer floating point numbers", () => {
    assert.throws(
      () => parseBoundedInteger("12.5", 10, { propertyName: "COUNT" }),
      /\[CONFIG ERROR\] Invalid integer configuration value for COUNT: "12.5"/
    );
    assert.throws(
      () => parseBoundedInteger(12.5, 10, { propertyName: "COUNT" }),
      /\[CONFIG ERROR\] Invalid non-integer number for COUNT: 12.5/
    );
  });

  test("rejects malformed string numbers", () => {
    assert.throws(
      () => parseBoundedInteger("abc", 10, { propertyName: "PORT" }),
      /\[CONFIG ERROR\] Invalid integer configuration value for PORT: "abc"/
    );
    assert.throws(
      () => parseBoundedInteger("8080a", 10, { propertyName: "PORT" }),
      /\[CONFIG ERROR\] Invalid integer configuration value for PORT: "8080a"/
    );
    assert.throws(
      () => parseBoundedInteger("1e5", 10, { propertyName: "PORT" }),
      /\[CONFIG ERROR\] Invalid integer configuration value for PORT: "1e5"/
    );
  });

  test("rejects unsafe positive and negative integers in both number and string inputs", () => {
    // Number inputs exceeding safe integer bounds
    assert.throws(
      () => parseBoundedInteger(Number.MAX_SAFE_INTEGER + 1, 10, { propertyName: "UNSAFE_POS_NUM" }),
      /\[CONFIG ERROR\] Out of safe integer range for UNSAFE_POS_NUM/
    );
    assert.throws(
      () => parseBoundedInteger(Number.MIN_SAFE_INTEGER - 1, 10, { propertyName: "UNSAFE_NEG_NUM" }),
      /\[CONFIG ERROR\] Out of safe integer range for UNSAFE_NEG_NUM/
    );
    // String inputs exceeding safe integer bounds
    assert.throws(
      () => parseBoundedInteger("9007199254740992", 10, { propertyName: "UNSAFE_POS_STR" }),
      /\[CONFIG ERROR\] Out of safe integer range for UNSAFE_POS_STR/
    );
    assert.throws(
      () => parseBoundedInteger("-9007199254740992", 10, { propertyName: "UNSAFE_NEG_STR" }),
      /\[CONFIG ERROR\] Out of safe integer range for UNSAFE_NEG_STR/
    );
  });

  test("validates boundary values inclusive of min and max", () => {
    assert.equal(parseBoundedInteger("1", 8080, { min: 1, max: 65535 }), 1);
    assert.equal(parseBoundedInteger("65535", 8080, { min: 1, max: 65535 }), 65535);
  });

  test("rejects numbers out of specified bounds", () => {
    assert.throws(
      () => parseBoundedInteger("-1", 8080, { min: 1, max: 65535, propertyName: "PORT" }),
      /\[CONFIG ERROR\] Value -1 for PORT is below minimum allowed 1/
    );
    assert.throws(
      () => parseBoundedInteger("65536", 8080, { min: 1, max: 65535, propertyName: "PORT" }),
      /\[CONFIG ERROR\] Value 65536 for PORT exceeds maximum allowed 65535/
    );
  });

  console.log("\n3. parseOptionalInteger parsing & validation...");
  test("preserves undefined on undefined or empty string", () => {
    assert.equal(parseOptionalInteger(undefined, undefined), undefined);
    assert.equal(parseOptionalInteger("", undefined), undefined);
    assert.equal(parseOptionalInteger("   ", undefined), undefined);
  });

  test("parses valid optional integer with bounds", () => {
    assert.equal(parseOptionalInteger("2", undefined, { min: 0, propertyName: "SHARD" }), 2);
    assert.throws(
      () => parseOptionalInteger("-1", undefined, { min: 0, propertyName: "SHARD" }),
      /\[CONFIG ERROR\] Value -1 for SHARD is below minimum allowed 0/
    );
  });

  console.log("\n4. createConfig integration & isolation...");
  test("retains all defaults when given empty custom environment", () => {
    const config = createConfig({});
    assert.equal(config.PORT, defaults.PORT);
    assert.equal(config.HOST, defaults.HOST);
    assert.equal(config.EMAIL_SMTP_PORT, defaults.EMAIL_SMTP_PORT);
    assert.equal(config.EMAIL_SMTP_SECURE, defaults.EMAIL_SMTP_SECURE);
    assert.equal(config.ROOM_CAPACITY, defaults.ROOM_CAPACITY);
    assert.equal(config.EMAIL_WORKER_INTERVAL_MS, defaults.EMAIL_WORKER_INTERVAL_MS);
  });

  test("coerces string environment variables to typed values with whitespace handling", () => {
    const config = createConfig({
      PORT: "  9000  ",
      HOST: "  127.0.0.1  ",
      EMAIL_SMTP_PORT: " 465 ",
      EMAIL_SMTP_SECURE: " true ",
      ROOM_CAPACITY: " 25 ",
      EMAIL_WORKER_BATCH_SIZE: " 50 ",
    });
    assert.equal(config.PORT, 9000);
    assert.equal(config.HOST, "127.0.0.1");
    assert.equal(config.EMAIL_SMTP_PORT, 465);
    assert.equal(config.EMAIL_SMTP_SECURE, true);
    assert.equal(config.ROOM_CAPACITY, 25);
    assert.equal(config.EMAIL_WORKER_BATCH_SIZE, 50);
  });

  test("throws on invalid environment variables", () => {
    assert.throws(
      () => createConfig({ PORT: "invalid-port" }),
      /\[CONFIG ERROR\] Invalid integer configuration value for PORT: "invalid-port"/
    );
    assert.throws(
      () => createConfig({ EMAIL_SMTP_SECURE: "maybe" }),
      /\[CONFIG ERROR\] Invalid boolean configuration value for EMAIL_SMTP_SECURE: "maybe"/
    );
  });

  console.log("\n5. SMTP Secure Mode & Transport Configuration Tests...");
  test("EMAIL_SMTP_SECURE=false, port 587 produces secure: false in transport options", () => {
    const cfg = createConfig({
      EMAIL_SMTP_HOST: "smtp-relay.brevo.com",
      EMAIL_SMTP_PORT: "587",
      EMAIL_SMTP_SECURE: " false ",
    });
    assert.equal(cfg.EMAIL_SMTP_SECURE, false);
    assert.equal(cfg.EMAIL_SMTP_PORT, 587);

    const provider = new SMTPEmailProvider({ config: cfg });
    const transporter = (provider as any).getTransporter();
    assert.equal(transporter.options.secure, false, "Nodemailer transport secure option must be false");
    assert.equal(transporter.options.port, 587, "Nodemailer transport port option must be 587");
  });

  test("EMAIL_SMTP_SECURE=true, port 587 produces secure: true in transport options", () => {
    const cfg = createConfig({
      EMAIL_SMTP_HOST: "smtp-relay.brevo.com",
      EMAIL_SMTP_PORT: "587",
      EMAIL_SMTP_SECURE: " true ",
    });
    assert.equal(cfg.EMAIL_SMTP_SECURE, true);
    assert.equal(cfg.EMAIL_SMTP_PORT, 587);

    const provider = new SMTPEmailProvider({ config: cfg });
    const transporter = (provider as any).getTransporter();
    assert.equal(transporter.options.secure, true, "Nodemailer transport secure option must be true");
    assert.equal(transporter.options.port, 587, "Nodemailer transport port option must be 587");
  });

  test("port 465 produces secure: true in transport options even when EMAIL_SMTP_SECURE=false", () => {
    const cfg = createConfig({
      EMAIL_SMTP_HOST: "smtp-relay.brevo.com",
      EMAIL_SMTP_PORT: "465",
      EMAIL_SMTP_SECURE: " false ",
    });
    assert.equal(cfg.EMAIL_SMTP_SECURE, false);
    assert.equal(cfg.EMAIL_SMTP_PORT, 465);

    const provider = new SMTPEmailProvider({ config: cfg });
    const transporter = (provider as any).getTransporter();
    assert.equal(transporter.options.secure, true, "Port 465 must enforce secure: true in transport options");
    assert.equal(transporter.options.port, 465, "Nodemailer transport port option must be 465");
  });

  console.log("\nAll Centralized Configuration Parsing & SMTP tests PASSED!\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

