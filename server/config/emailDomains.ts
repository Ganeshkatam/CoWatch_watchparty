export const ALLOWED_EMAIL_DOMAIN_VALUES = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "zoho.com",
  "proton.me",
  "protonmail.com",
] as const;

export const ALLOWED_EMAIL_DOMAINS: ReadonlySet<string> = new Set(
  ALLOWED_EMAIL_DOMAIN_VALUES,
);
