import { ALLOWED_EMAIL_DOMAINS } from "../config/emailDomains.ts";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractEmailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.indexOf("@");

  if (
    atIndex <= 0 ||
    atIndex !== normalized.lastIndexOf("@") ||
    atIndex === normalized.length - 1
  ) {
    return null;
  }

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  if (!localPart || !domain || /\s/.test(normalized)) {
    return null;
  }

  return domain;
}

export function isAllowedEmailDomain(email: string): boolean {
  const domain = extractEmailDomain(email);
  return domain !== null && ALLOWED_EMAIL_DOMAINS.has(domain);
}
