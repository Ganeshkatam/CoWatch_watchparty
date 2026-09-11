/**
 * Validates a "next" URL to prevent open redirects.
 * Only allows relative paths starting with a single slash (e.g. /rooms, /profile).
 * Rejects external URLs like https://example.com or //example.com.
 *
 * @param next - The proposed redirect path (from URL parameters)
 * @param fallback - The default path to redirect to if next is invalid or missing
 * @returns A safe relative URL
 */
export function getSafeRedirectUrl(next: string | null, fallback: string = "/myrooms"): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return fallback;
}
