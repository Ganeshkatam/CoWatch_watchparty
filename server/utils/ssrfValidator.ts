import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export interface SafeUrlValidationResult {
  valid: boolean;
  reason?: string;
  url?: URL;
  resolvedIps?: string[];
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedProtocols?: Array<"http:" | "https:">;
}

export interface SafeFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: Buffer;
  finalUrl: string;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

/**
 * Checks whether an IPv4 address belongs to private, loopback, link-local,
 * broadcast, or reserved network ranges.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return true;
  }

  const octets = parts.map((p) => {
    // Detect octal notation (leading zeros)
    if (p.length > 1 && p.startsWith("0")) {
      return -1;
    }
    const num = Number(p);
    return Number.isInteger(num) && num >= 0 && num <= 255 ? num : -1;
  });

  if (octets.some((o) => o === -1)) {
    return true;
  }

  const [o0, o1] = octets;

  // 0.0.0.0/8 (Current network)
  if (o0 === 0) return true;

  // 10.0.0.0/8 (Private)
  if (o0 === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (o0 === 127) return true;

  // 169.254.0.0/16 (Link-Local, AWS/GCP/Azure Metadata: 169.254.169.254)
  if (o0 === 169 && o1 === 254) return true;

  // 172.16.0.0/12 (Private)
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (o0 === 192 && o1 === 0 && octets[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (o0 === 192 && o1 === 0 && octets[2] === 2) return true;

  // 192.168.0.0/16 (Private)
  if (o0 === 192 && o1 === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (o0 === 198 && (o1 === 18 || o1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (o0 === 198 && o1 === 51 && octets[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (o0 === 203 && o1 === 0 && octets[2] === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (o0 >= 224 && o0 <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future Use)
  if (o0 >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address belongs to private, loopback, link-local,
 * unique-local, or IPv4-mapped private ranges.
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback ::1
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // Unspecified ::
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  if (normalized.startsWith("::ffff:") || normalized.startsWith("0:0:0:0:0:ffff:")) {
    const ipv4Part = normalized.substring(normalized.lastIndexOf(":") + 1);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateOrReservedIPv4(ipv4Part);
    }
    return true;
  }

  // Link-Local: fe80::/10 (fe80 to febf)
  if (/^fe[89ab][0-9a-f]/i.test(normalized) || normalized.startsWith("fe80:")) return true;

  // Unique Local: fc00::/7 (fc00 to fdff)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;

  // Multicast: ff00::/8
  if (normalized.startsWith("ff")) return true;

  return false;
}

/**
 * Validates any IP address string against private and reserved ranges.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return isPrivateOrReservedIPv4(ip);
  }
  if (version === 6) {
    return isPrivateOrReservedIPv6(ip);
  }
  // Unknown or invalid IP is treated as unsafe
  return true;
}

/**
 * Validates an external URL for SSRF protection:
 * - Scheme must be allowed (https by default)
 * - Hostname cannot be a cloud metadata or loopback alias
 * - Resolves all DNS records (A and AAAA) and asserts zero private/reserved IPs
 */
export async function validateExternalUrl(
  input: string,
  allowedProtocols: Array<"http:" | "https:"> = ["https:"]
): Promise<SafeUrlValidationResult> {
  if (!input || typeof input !== "string") {
    return { valid: false, reason: "URL must be a non-empty string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { valid: false, reason: "Malformed URL" };
  }

  const protocol = parsed.protocol as "http:" | "https:";
  if (!allowedProtocols.includes(protocol)) {
    return {
      valid: false,
      reason: `Protocol '${parsed.protocol}' is not allowed. Allowed: ${allowedProtocols.join(", ")}`,
    };
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "Credentials in URL are strictly prohibited" };
  }

  const hostname = parsed.hostname.toLowerCase().trim();
  if (!hostname) {
    return { valid: false, reason: "Empty hostname" };
  }

  // Reject numerical integer IP representations (e.g. http://2130706433/ or http://0x7f000001)
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    return { valid: false, reason: "Non-standard decimal/hexadecimal IP notation rejected" };
  }

  // Check known blocked hostnames or suffixes
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return { valid: false, reason: `Blocked hostname '${hostname}'` };
  }

  // If hostname is directly an IP literal
  const ipVersion = net.isIP(hostname);
  if (ipVersion !== 0) {
    if (isPrivateOrReservedIP(hostname)) {
      return {
        valid: false,
        reason: `Target IP '${hostname}' resolves to private/reserved network space`,
      };
    }
    return { valid: true, url: parsed, resolvedIps: [hostname] };
  }

  // Resolve hostname via DNS to inspect all records
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DNS resolution failed";
    return { valid: false, reason: `DNS lookup failed for '${hostname}': ${message}` };
  }

  if (!addresses || addresses.length === 0) {
    return { valid: false, reason: `No DNS records returned for '${hostname}'` };
  }

  const resolvedIps: string[] = [];
  for (const record of addresses) {
    resolvedIps.push(record.address);
    if (isPrivateOrReservedIP(record.address)) {
      return {
        valid: false,
        reason: `Hostname '${hostname}' resolved to private/reserved IP: ${record.address}`,
        resolvedIps,
      };
    }
  }

  return { valid: true, url: parsed, resolvedIps };
}

/**
 * Safely fetches an external resource with complete SSRF defense:
 * 1. Validates the initial URL and DNS resolution.
 * 2. Pins the connection to the pre-validated IP to eliminate DNS rebinding TOCTOU.
 * 3. Enforces response timeouts (default 5000ms).
 * 4. Bounds maximum response payload bytes (default 5MB) to prevent memory exhaustion.
 * 5. Intercepts redirects and re-validates each redirect target against the full SSRF policy.
 */
export async function safeExternalGet(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const allowedProtocols = options.allowedProtocols ?? ["https:"];
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024; // 5 MB
  const maxRedirects = options.maxRedirects ?? 3;

  let currentUrl = targetUrl;
  let redirectsRemaining = maxRedirects;

  while (true) {
    const validation = await validateExternalUrl(currentUrl, allowedProtocols);
    if (!validation.valid || !validation.url || !validation.resolvedIps || validation.resolvedIps.length === 0) {
      throw new Error(`SSRF validation failed for '${currentUrl}': ${validation.reason ?? "Invalid URL"}`);
    }

    const parsedUrl = validation.url;
    const validatedIp = validation.resolvedIps[0];
    const isHttps = parsedUrl.protocol === "https:";

    // Create a pinned agent to enforce the validated IP and defeat DNS rebinding
    const customLookup: (
      hostname: string,
      opts: dns.LookupOptions,
      callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
    ) => void = (_hostname, _opts, callback) => {
      const family = net.isIPv6(validatedIp) ? 6 : 4;
      callback(null, validatedIp, family);
    };

    const agentOptions = {
      lookup: customLookup,
      timeout: timeoutMs,
    };

    const agent = isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);

    const requestHeaders: Record<string, string> = {
      "User-Agent": "CoWatch-Security-Client/1.0",
      Accept: "*/*",
      ...(options.headers ?? {}),
      Host: parsedUrl.host,
    };

    const response = await new Promise<SafeFetchResponse>((resolve, reject) => {
      const transport = isHttps ? https : http;
      let timedOut = false;

      const req = transport.request(
        parsedUrl,
        {
          method: "GET",
          agent,
          headers: requestHeaders,
          timeout: timeoutMs,
        },
        (res) => {
          const statusCode = res.statusCode ?? 500;
          const statusText = res.statusMessage ?? "Unknown";

          // Intercept redirects
          if (
            (statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 303 ||
              statusCode === 307 ||
              statusCode === 308) &&
            res.headers.location
          ) {
            res.resume(); // Discard body
            if (redirectsRemaining <= 0) {
              reject(new Error(`SSRF safe fetch exceeded max redirects (${maxRedirects})`));
              return;
            }
            redirectsRemaining--;

            // Resolve relative redirect location against current URL
            try {
              const redirectUrl = new URL(res.headers.location, parsedUrl).toString();
              resolve({
                status: statusCode,
                statusText,
                headers: res.headers as Record<string, string>,
                data: Buffer.from(redirectUrl),
                finalUrl: redirectUrl,
              });
              return;
            } catch {
              reject(new Error(`Invalid redirect location header: ${res.headers.location}`));
              return;
            }
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;

          res.on("data", (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              req.destroy(
                new Error(`Response body exceeded maximum allowed limit of ${maxBytes} bytes`)
              );
              return;
            }
            chunks.push(chunk);
          });

          res.on("end", () => {
            const normalizedHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === "string") {
                normalizedHeaders[key.toLowerCase()] = value;
              } else if (Array.isArray(value)) {
                normalizedHeaders[key.toLowerCase()] = value.join(", ");
              }
            }

            resolve({
              status: statusCode,
              statusText,
              headers: normalizedHeaders,
              data: Buffer.concat(chunks),
              finalUrl: currentUrl,
            });
          });

          res.on("error", (err) => {
            reject(err);
          });
        }
      );

      req.on("timeout", () => {
        timedOut = true;
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      req.on("error", (err) => {
        if (!timedOut) {
          reject(err);
        }
      });

      req.end();
    });

    // Check if this was a redirect that requires follow-up
    if (
      (response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308) &&
      response.finalUrl !== currentUrl
    ) {
      currentUrl = response.finalUrl;
      continue;
    }

    return response;
  }
}
