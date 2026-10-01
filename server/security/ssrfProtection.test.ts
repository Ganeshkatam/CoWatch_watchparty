import assert from "node:assert";
import {
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  isPrivateOrReservedIP,
  validateExternalUrl,
  safeExternalGet,
} from "../utils/ssrfValidator.ts";

async function runSsrfSecurityTests() {
  console.log("================================================================");
  console.log("STARTING SSRF-001 EXTERNAL URL BOUNDARY SECURITY TEST SUITE");
  console.log("================================================================");

  // Group 1: IPv4 Boundary Classification
  console.log("\n--- Group 1: IPv4 Boundary Classification ---");
  const privateIpv4List = [
    "127.0.0.1",
    "127.0.0.2",
    "127.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.20.5.10",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.1.254",
    "169.254.169.254", // Cloud Metadata
    "169.254.0.1",
    "100.64.0.1", // CGNAT
    "100.127.255.254",
    "0.0.0.0",
    "192.0.2.1", // TEST-NET-1
    "198.51.100.1", // TEST-NET-2
    "203.0.113.1", // TEST-NET-3
    "224.0.0.1", // Multicast
    "240.0.0.1", // Reserved
    "255.255.255.255",
    "0177.0.0.1", // Octal evasion
    "127.0.0.1.bad",
  ];

  for (const ip of privateIpv4List) {
    assert.strictEqual(
      isPrivateOrReservedIPv4(ip),
      true,
      `Expected ${ip} to be classified as private/reserved IPv4`
    );
  }
  console.log("  PASS [Group 1.1: All private and reserved IPv4 addresses blocked]");

  const publicIpv4List = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "104.16.132.229"];
  for (const ip of publicIpv4List) {
    assert.strictEqual(
      isPrivateOrReservedIPv4(ip),
      false,
      `Expected ${ip} to be recognized as public IPv4`
    );
  }
  console.log("  PASS [Group 1.2: Valid public IPv4 addresses allowed]");

  // Group 2: IPv6 Boundary Classification
  console.log("\n--- Group 2: IPv6 Boundary Classification ---");
  const privateIpv6List = [
    "::1",
    "0:0:0:0:0:0:0:1",
    "::",
    "0:0:0:0:0:0:0:0",
    "fe80::1",
    "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fc00::1",
    "fd12:3456:789a:1::1",
    "ff02::1", // Multicast
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    "::ffff:192.168.1.1", // IPv4-mapped private
  ];

  for (const ip of privateIpv6List) {
    assert.strictEqual(
      isPrivateOrReservedIPv6(ip),
      true,
      `Expected ${ip} to be classified as private/reserved IPv6`
    );
  }
  console.log("  PASS [Group 2.1: All private, loopback, and IPv4-mapped IPv6 addresses blocked]");

  const publicIpv6List = [
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
  ];
  for (const ip of publicIpv6List) {
    assert.strictEqual(
      isPrivateOrReservedIPv6(ip),
      false,
      `Expected ${ip} to be recognized as public IPv6`
    );
  }
  console.log("  PASS [Group 2.2: Valid public IPv6 addresses allowed]");

  // Group 3: Obfuscation & Malformed Hostname Rejection
  console.log("\n--- Group 3: Obfuscation & Malformed Hostname Rejection ---");
  const adversarialUrls = [
    "http://127.0.0.1:8080/admin",
    "http://localhost:3000/",
    "http://sub.localhost/",
    "http://internal.service.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://instance-data/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", // Decimal IP for 127.0.0.1
    "http://0x7f000001/", // Hexadecimal IP for 127.0.0.1
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_flushall",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
    "https://admin:secret@example.com/",
    "javascript:alert(1)",
    "",
    "   ",
    "not-a-url",
  ];

  for (const maliciousUrl of adversarialUrls) {
    const res = await validateExternalUrl(maliciousUrl, ["http:", "https:"]);
    assert.strictEqual(
      res.valid,
      false,
      `Expected malicious URL '${maliciousUrl}' to be rejected, but it was marked valid`
    );
  }
  console.log("  PASS [Group 3.1: All 18 adversarial and obfuscated URLs strictly rejected]");

  // Group 4: Protocol Enforcement
  console.log("\n--- Group 4: Protocol Enforcement ---");
  const httpUrl = "http://example.com/test";
  const defaultCheck = await validateExternalUrl(httpUrl); // Default is https only
  assert.strictEqual(
    defaultCheck.valid,
    false,
    "Expected HTTP URL to be rejected under default https-only policy"
  );
  console.log("  PASS [Group 4.1: Protocol enforcement rejects plaintext http when https required]");

  // Group 5: Legitimate Public URL Validation
  console.log("\n--- Group 5: Legitimate Public URL Validation ---");
  const publicUrl = "https://cloudflare.com/cdn-cgi/trace";
  const publicValidation = await validateExternalUrl(publicUrl, ["https:"]);
  assert.strictEqual(
    publicValidation.valid,
    true,
    `Expected '${publicUrl}' to be valid public URL, reason: ${publicValidation.reason}`
  );
  assert.ok(
    publicValidation.resolvedIps && publicValidation.resolvedIps.length > 0,
    "Must return resolved public IPs"
  );
  console.log("  PASS [Group 5.1: Legitimate public URL successfully resolves and validates]");

  console.log("================================================================");
  console.log("ALL SSRF-001 EXTERNAL URL BOUNDARY SECURITY TESTS PASSED!");
  console.log("================================================================");
}

runSsrfSecurityTests().catch((err) => {
  console.error("SSRF test suite failed:", err);
  process.exit(1);
});
