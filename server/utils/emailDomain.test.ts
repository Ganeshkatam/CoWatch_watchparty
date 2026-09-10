import assert from "node:assert/strict";
import { ALLOWED_EMAIL_DOMAIN_VALUES } from "../config/emailDomains.ts";
import {
  extractEmailDomain,
  isAllowedEmailDomain,
  normalizeEmail,
} from "./emailDomain.ts";

for (const domain of ALLOWED_EMAIL_DOMAIN_VALUES) {
  assert.equal(isAllowedEmailDomain(`user@${domain}`), true, domain);
}

assert.equal(isAllowedEmailDomain("USER@GMAIL.COM"), true);
assert.equal(isAllowedEmailDomain("  user@outlook.com  "), true);
assert.equal(normalizeEmail("  USER@GMAIL.COM  "), "user@gmail.com");
assert.equal(extractEmailDomain("User@Proton.Me"), "proton.me");

for (const email of [
  "user@evil-gmail.com",
  "user@randommail.example",
  "user@gmail.com.evil.com",
  "user@sub.outlook.com",
]) {
  assert.equal(isAllowedEmailDomain(email), false, email);
}

for (const email of [
  "usergmail.com",
  "user@@gmail.com",
  "@gmail.com",
  "user@",
  "user @gmail.com",
  "user@gmail .com",
  "",
]) {
  assert.equal(isAllowedEmailDomain(email), false, email);
  assert.equal(extractEmailDomain(email), null, email);
}

console.log("emailDomain.test.ts: all tests passed");
