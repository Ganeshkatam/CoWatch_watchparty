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
  APP_URL: "", // Canonical web application URL for notifications and deep links
  CORS_ALLOWED_ORIGINS: "", // Comma-delimited list of permitted CORS origins in production

  // ==========================================
  // Media Configuration
  // ==========================================
  YOUTUBE_API_KEY: "", // Optional, provide one to enable searching YouTube
  TWITCH_PROXY_PATH: "", // Optional, URL of the server that can proxy twitch HLS stream playlists and segments
  OPENSUBTITLES_KEY: "", // Optional, key to OpenSubtitles API
  MEDIASOUP_SERVER: "", // Optional, URL of the MediaSoup server to broadcast to for larger screen/file shares
  STREAM_PATH: "", // Path of server that supports additional video streams
  CONVERT_PATH: "", // Path of server that supports video conversion



  // ==========================================
  // NOTIFY-001, NOTIFY-002 & NOTIFY-004: Transactional Email Architecture
  // ==========================================
  EMAIL_PROVIDER: "smtp",          // Global default email provider adapter: "brevo" | "smtp"
  EMAIL_FROM_ADDRESS: "noreply@cowatch.tv", // Default sender email address
  EMAIL_FROM_NAME: "CoWatch",      // Default sender display name

  // Delivery Profiles (Provider-neutral sender overrides)
  EMAIL_PROFILE_INVITATION_SENDER: "", // Sender address for transactional_invitation (defaults to EMAIL_FROM_ADDRESS)
  EMAIL_PROFILE_SECURITY_SENDER: "",   // Sender address for transactional_security (defaults to EMAIL_FROM_ADDRESS)
  EMAIL_PROFILE_SYSTEM_SENDER: "",     // Sender address for transactional_system (defaults to EMAIL_FROM_ADDRESS)

  // Infrastructure Provider Bindings (Maps Delivery Profile -> Named Provider/Account Binding)
  EMAIL_PROFILE_DEFAULT_BINDING: "default",
  EMAIL_PROFILE_INVITATION_BINDING: "default", // e.g. "invitations", "default"
  EMAIL_PROFILE_SECURITY_BINDING: "default",   // e.g. "security", "default"
  EMAIL_PROFILE_SYSTEM_BINDING: "default",     // e.g. "system", "default"

  // Named Provider Bindings (Maps binding name -> registered provider adapter)
  EMAIL_BINDING_DEFAULT_PROVIDER: "",    // Optional provider override for "default" binding
  EMAIL_BINDING_INVITATION_PROVIDER: "", // Optional provider override for "invitations" binding
  EMAIL_BINDING_SECURITY_PROVIDER: "",   // Optional provider override for "security" binding
  EMAIL_BINDING_SYSTEM_PROVIDER: "",     // Optional provider override for "system" binding

  // Brevo API Configuration & Multi-Account Support
  BREVO_API_KEY: "",               // Brevo default API key (xkeysib-...)
  BREVO_API_KEY_INVITATIONS: "",   // Optional Brevo account API key for invitations
  BREVO_API_KEY_SECURITY: "",      // Optional Brevo account API key for security alerts
  BREVO_API_KEY_SYSTEM: "",        // Optional Brevo account API key for system mail
  BREVO_WEBHOOK_SECRET: "",        // Brevo webhook authentication token/secret

  // Generic SMTP Configuration (Works with Brevo SMTP, Amazon SES, Postmark, etc.)
  EMAIL_SMTP_HOST: "",             // SMTP server hostname (e.g. smtp-relay.brevo.com)
  EMAIL_SMTP_PORT: 587,            // SMTP port (587 for STARTTLS, 465 for SSL)
  EMAIL_SMTP_USERNAME: "",         // SMTP username
  EMAIL_SMTP_PASSWORD: "",         // SMTP password
  EMAIL_SMTP_SECURE: false,        // True for 465 SSL, false for 587 STARTTLS

  // Internal Boundary Secret (for /internal/health and administrative endpoints)
  INTERNAL_API_SECRET: "",

  EMAIL_WORKER_INTERVAL_MS: 30000, // How often the email outbox worker polls (default 30s)
  EMAIL_WORKER_BATCH_SIZE: 10,     // How many outbox rows to claim per cycle
  EMAIL_WORKER_LEASE_SECONDS: 600, // Lease duration before a PROCESSING job is considered stalled (10m)
  EMAIL_RETRY_DELAYS_MS: "60000,300000,1800000,3600000", // Comma-separated per-attempt delays (4 retries)
  EMAIL_MAX_ATTEMPTS: 5,           // Max delivery attempts before marking FAILED
  EMAIL_SENT_RETENTION_DAYS: 14,   // Days to retain SENT outbox rows before purging
  EMAIL_FAILED_RETENTION_DAYS: 60, // Days to retain FAILED outbox rows for auditing
  NOTIFICATION_READ_RETENTION_DAYS: 90, // Days to retain READ notifications

  // ==========================================
  // Development / Legacy Compatibility Configuration
  // ==========================================
  // Kept solely because existing local Docker development/testing infrastructure or legacy admin metrics depend on them.

  SSL_KEY_FILE: "", // Optional, Filename of SSL key (to use https for local development)
  SSL_CRT_FILE: "", // Optional, Filename of SSL cert (to use https for local development)
  STATS_KEY: "", // Secret string to validate viewing stats
  CUSTOM_SETTINGS_HOSTNAME: "", // Hostname to send different config settings to client
};

const resolvedConfig = {
  ...defaults,
  ...process.env,
};

export default resolvedConfig;
