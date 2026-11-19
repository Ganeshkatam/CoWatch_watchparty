import { loadEnvFile } from "node:process";
import fs from "node:fs";

if (fs.existsSync(".env")) {
  try {
    loadEnvFile();
  } catch (e) {
    // ignore
  }
}

const defaults = {
  // ==========================================
  // Core CoWatch Configuration
  // ==========================================
  NODE_ENV: "production",
  REDIS_URL: "", // Fallback single Redis URL (local-development and testing only; production requires dedicated instances)
  REDIS_CORE_URL: "", // Redis Core: distributed coordination (locks, leases, idempotency)
  REDIS_EDGE_URL: "", // Redis Edge: high-volume cache (metadata, batched presence)
  REDIS_METRICS_URL: "", // Redis Metrics: analytics buffer flush
  DATABASE_URL: "", // Optional, for permanent rooms (PostgreSQL)
  SUPABASE_URL: "", // Optional, required for Supabase integration
  SUPABASE_SECRET_KEY: "", // Optional, required for Supabase integration
  PORT: 8080, // Port to use for server
  HOST: "0.0.0.0", // Host interface to bind server to
  SHARD: undefined, // Shard ID of the web server (configure in ecosystem.config.js)
  ROOM_CAPACITY: 10, // Maximum capacity of a standard room. Set to 0 for unlimited.
  ROOM_CAPACITY_SUB: 10, // Maximum capacity of a sub room. Set to 0 for unlimited.
  FREE_ROOM_LIMIT: 2, // The maximum number of rooms a free user can have
  SUBSCRIBER_ROOM_LIMIT: 10, // The maximum number of rooms a subscriber can have
  BETA_USER_EMAILS: "", // Comma-delimited list of user emails to include in the beta / auth
  APP_URL: "https://cowatch.tomesphere.in", // Canonical web application URL for notifications and deep links
  ALLOWED_ORIGINS: [
    "https://cowatch.tomesphere.in",
    "https://www.cowatch.tomesphere.in",
    "https://tomesphere.in",
    "https://cowatch-api.tomesphere.in",
  ],

  // ==========================================
  // Media Configuration
  // ==========================================
  YOUTUBE_API_KEY: "", // Optional, provide one to enable searching YouTube
  TWITCH_PROXY_PATH: "", // Optional, URL of the server that can proxy twitch HLS stream playlists and segments
  MEDIASOUP_SERVER: "", // Optional, URL of the MediaSoup server to broadcast to for larger screen/file shares
  STREAM_PATH: "", // Path of server that supports additional video streams
  CONVERT_PATH: "", // Path of server that supports video conversion



  // ==========================================
  // Remote email service boundary. Provider credentials and sender identities live remotely.
  EMAIL_SERVICE_URL: "",
  EMAIL_SERVICE_API_SECRET: "",
  EMAIL_SERVICE_WORKER_SECRET: "",
  BREVO_WEBHOOK_SECRET: "", // Webhook verification remains on CoWatch.
  RESEND_WEBHOOK_SECRET: "", // Webhook verification remains on CoWatch.

  // CoWatch-owned durable outbox policy.
  EMAIL_WORKER_LEASE_SECONDS: 600,
  EMAIL_RETRY_DELAYS_MS: "60000,300000,1800000,3600000",
  EMAIL_MAX_ATTEMPTS: 5,
  EMAIL_SENT_RETENTION_DAYS: 14,
  EMAIL_FAILED_RETENTION_DAYS: 60,
  NOTIFICATION_READ_RETENTION_DAYS: 90,

  // ==========================================
  // Development / Legacy Compatibility Configuration
  // ==========================================
  // Kept solely because existing local Docker development/testing infrastructure or legacy admin metrics depend on them.

  SSL_KEY_FILE: "", // Optional, Filename of SSL key (to use https for local development)
  SSL_CRT_FILE: "", // Optional, Filename of SSL cert (to use https for local development)
  STATS_KEY: "", // Secret string to validate viewing stats
  CUSTOM_SETTINGS_HOSTNAME: "", // Hostname to send different config settings to client

  // ==========================================
  // TURN Relay Configuration (Coturn RFC 5766)
  // ==========================================
  TURN_SHARED_SECRET: "", // Shared secret key for HMAC-SHA1 credential generation
  TURN_HOST: "", // FQDN or IP of the TURN server (e.g. turn.cowatch.tomesphere.in)
  TURN_PORT_UDP: 3478, // Standard TURN UDP port (default 3478)
  TURN_PORT_TLS: 443, // Secure TURN TLS/TURNS port (default 443)
  TURN_FALLBACK_STUN_URLS: "stun:stun.l.google.com:19302", // Comma-delimited list of fallback STUN servers
};

export function parseBoolean(
  value: unknown,
  fallback: boolean,
  propertyName?: string
): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return fallback;
    }
    const lower = trimmed.toLowerCase();
    if (lower === "true" || lower === "1") {
      return true;
    }
    if (lower === "false" || lower === "0") {
      return false;
    }
  }
  const prop = propertyName ? ` for ${propertyName}` : "";
  throw new Error(`[CONFIG ERROR] Invalid boolean configuration value${prop}: "${String(value)}"`);
}

export function parseBoundedInteger(
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number; propertyName?: string }
): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Invalid non-integer number${prop}: ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Out of safe integer range${prop}: ${value}`);
    }
    if (options?.min !== undefined && value < options.min) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Value ${value}${prop} is below minimum allowed ${options.min}`);
    }
    if (options?.max !== undefined && value > options.max) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Value ${value}${prop} exceeds maximum allowed ${options.max}`);
    }
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return fallback;
    }
    if (!/^-?\d+$/.test(trimmed)) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Invalid integer configuration value${prop}: "${value}"`);
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Out of safe integer range${prop}: "${value}"`);
    }
    if (options?.min !== undefined && parsed < options.min) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Value ${parsed}${prop} is below minimum allowed ${options.min}`);
    }
    if (options?.max !== undefined && parsed > options.max) {
      const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
      throw new Error(`[CONFIG ERROR] Value ${parsed}${prop} exceeds maximum allowed ${options.max}`);
    }
    return parsed;
  }
  const prop = options?.propertyName ? ` for ${options.propertyName}` : "";
  throw new Error(`[CONFIG ERROR] Invalid integer configuration value${prop}: "${String(value)}"`);
}

export function parseOptionalInteger(
  value: unknown,
  fallback: number | undefined,
  options?: { min?: number; max?: number; propertyName?: string }
): number | undefined {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string" && value.trim() === "") {
    return fallback;
  }
  return parseBoundedInteger(value, fallback ?? 0, options);
}

export function createConfig(customEnv: NodeJS.ProcessEnv = process.env) {
  return {
    ...defaults,
    ...Object.fromEntries(
      Object.keys(defaults)
        .filter((key) => customEnv[key] !== undefined)
        .map((key) => [key, customEnv[key]]),
    ),
    HOST:
      typeof customEnv.HOST === "string" && customEnv.HOST.trim() !== ""
        ? customEnv.HOST.trim()
        : defaults.HOST,
    PORT: parseBoundedInteger(customEnv.PORT, defaults.PORT, {
      min: 1,
      max: 65535,
      propertyName: "PORT",
    }),
    SHARD: parseOptionalInteger(customEnv.SHARD, defaults.SHARD, {
      min: 0,
      propertyName: "SHARD",
    }),
    ROOM_CAPACITY: parseBoundedInteger(
      customEnv.ROOM_CAPACITY,
      defaults.ROOM_CAPACITY,
      { min: 0, max: 500, propertyName: "ROOM_CAPACITY" }
    ),
    ROOM_CAPACITY_SUB: parseBoundedInteger(
      customEnv.ROOM_CAPACITY_SUB,
      defaults.ROOM_CAPACITY_SUB,
      { min: 0, max: 500, propertyName: "ROOM_CAPACITY_SUB" }
    ),
    FREE_ROOM_LIMIT: parseBoundedInteger(
      customEnv.FREE_ROOM_LIMIT,
      defaults.FREE_ROOM_LIMIT,
      { min: 0, max: 1000, propertyName: "FREE_ROOM_LIMIT" }
    ),
    SUBSCRIBER_ROOM_LIMIT: parseBoundedInteger(
      customEnv.SUBSCRIBER_ROOM_LIMIT,
      defaults.SUBSCRIBER_ROOM_LIMIT,
      { min: 0, max: 1000, propertyName: "SUBSCRIBER_ROOM_LIMIT" }
    ),
    ALLOWED_ORIGINS: customEnv.ALLOWED_ORIGINS
      ? customEnv.ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      : defaults.ALLOWED_ORIGINS,
    EMAIL_WORKER_LEASE_SECONDS: parseBoundedInteger(
      customEnv.EMAIL_WORKER_LEASE_SECONDS,
      defaults.EMAIL_WORKER_LEASE_SECONDS,
      { min: 5, max: 86400, propertyName: "EMAIL_WORKER_LEASE_SECONDS" }
    ),
    EMAIL_MAX_ATTEMPTS: parseBoundedInteger(
      customEnv.EMAIL_MAX_ATTEMPTS,
      defaults.EMAIL_MAX_ATTEMPTS,
      { min: 1, max: 20, propertyName: "EMAIL_MAX_ATTEMPTS" }
    ),
    EMAIL_SENT_RETENTION_DAYS: parseBoundedInteger(
      customEnv.EMAIL_SENT_RETENTION_DAYS,
      defaults.EMAIL_SENT_RETENTION_DAYS,
      { min: 1, max: 3650, propertyName: "EMAIL_SENT_RETENTION_DAYS" }
    ),
    EMAIL_FAILED_RETENTION_DAYS: parseBoundedInteger(
      customEnv.EMAIL_FAILED_RETENTION_DAYS,
      defaults.EMAIL_FAILED_RETENTION_DAYS,
      { min: 1, max: 3650, propertyName: "EMAIL_FAILED_RETENTION_DAYS" }
    ),
    NOTIFICATION_READ_RETENTION_DAYS: parseBoundedInteger(
      customEnv.NOTIFICATION_READ_RETENTION_DAYS,
      defaults.NOTIFICATION_READ_RETENTION_DAYS,
      { min: 1, max: 3650, propertyName: "NOTIFICATION_READ_RETENTION_DAYS" }
    ),
    TURN_PORT_UDP: parseBoundedInteger(
      customEnv.TURN_PORT_UDP,
      defaults.TURN_PORT_UDP,
      { min: 1, max: 65535, propertyName: "TURN_PORT_UDP" }
    ),
    TURN_PORT_TLS: parseBoundedInteger(
      customEnv.TURN_PORT_TLS,
      defaults.TURN_PORT_TLS,
      { min: 1, max: 65535, propertyName: "TURN_PORT_TLS" }
    ),
  };
}

export { defaults };

const resolvedConfig = createConfig(process.env);

// Provider credentials belong exclusively to the remote email-service process.
const REMOTE_EMAIL_ENV_KEYS = [
  'EMAIL_PROVIDER', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME',
  'EMAIL_PROFILE_DEFAULT_BINDING', 'EMAIL_PROFILE_INVITATION_BINDING',
  'EMAIL_PROFILE_SECURITY_BINDING', 'EMAIL_PROFILE_SYSTEM_BINDING',
  'EMAIL_PROFILE_INVITATION_SENDER', 'EMAIL_PROFILE_SECURITY_SENDER', 'EMAIL_PROFILE_SYSTEM_SENDER',
  'EMAIL_BINDING_DEFAULT_PROVIDER', 'EMAIL_BINDING_INVITATION_PROVIDER',
  'EMAIL_BINDING_SECURITY_PROVIDER', 'EMAIL_BINDING_SYSTEM_PROVIDER',
  'BREVO_API_KEY', 'BREVO_API_KEY_INVITATIONS', 'BREVO_API_KEY_SECURITY', 'BREVO_API_KEY_SYSTEM',
  'RESEND_API_KEY', 'EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT', 'EMAIL_SMTP_USERNAME',
  'EMAIL_SMTP_PASSWORD', 'EMAIL_SMTP_SECURE', 'EMAIL_WORKER_INTERVAL_MS', 'EMAIL_WORKER_BATCH_SIZE',
] as const;
for (const key of REMOTE_EMAIL_ENV_KEYS) delete process.env[key];

// Validate TURN configuration
if (resolvedConfig.NODE_ENV === "production") {
  if (resolvedConfig.TURN_SHARED_SECRET && !resolvedConfig.TURN_HOST) {
    console.error("[CONFIG ERROR] TURN_SHARED_SECRET is configured but TURN_HOST is missing. Relay credential generation will fail.");
  } else if (!resolvedConfig.TURN_SHARED_SECRET && resolvedConfig.TURN_HOST) {
    console.error("[CONFIG ERROR] TURN_HOST is configured but TURN_SHARED_SECRET is missing. Relay credential generation will fail.");
  } else if (!resolvedConfig.TURN_SHARED_SECRET && !resolvedConfig.TURN_HOST) {
    console.warn("[CONFIG WARN] TURN_HOST and TURN_SHARED_SECRET are not set in production. WebRTC will operate STUN-only without relay fallback.");
  }
}

export default resolvedConfig;
