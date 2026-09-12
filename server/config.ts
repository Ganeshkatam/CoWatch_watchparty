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
  NODE_ENV: "",
  REDIS_URL: "", // Fallback single Redis URL
  REDIS_CORE_URL: "", // Redis Core: distributed coordination (locks, leases, idempotency)
  REDIS_EDGE_URL: "", // Redis Edge: high-volume cache (metadata, batched presence)
  REDIS_METRICS_URL: "", // Redis Metrics: analytics buffer flush
  DATABASE_URL: "", // Optional, for permanent rooms and VBrowser management (PostgreSQL)
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
  // VBrowser Infrastructure Configuration
  // ==========================================
  VIRTUAL_BROWSER_ENABLED: false, // Authoritative server switch. Defaults to false.
  VIRTUAL_BROWSER_PROVIDER: "auto", // Provider selection: "auto" | "local" | "hetzner" | "pooled"
  VBROWSER_SESSION_SECONDS: 10800, // Number of seconds to allow vbrowsers to run for
  VBROWSER_SESSION_SECONDS_LARGE: 86400, // Number of seconds to allow large vbrowsers to run for
  VBROWSER_AUTOSCALING: false, // Gate provisioning behind an operator-controlled setting. Defaults to false.
  VBROWSER_PROVIDER_LIMIT: 2147483647, // Config ceiling for provider capacity
  VBROWSER_POOL_LIMIT: 2147483647, // Config ceiling for pool capacity
  VM_POOL_RAMP_DOWN_HOURS: "", // Comma separated start/end UTC hours of the ramp down period
  VM_POOL_RAMP_UP_HOURS: "", // Comma separated start/end UTC hours of the ramp up period
  VBROWSER_TAG: "", // Optional, tag to put on VBrowser VM instances
  DO_TOKEN: "", // Optional, for DigitalOcean VMs
  DO_GATEWAY: "", // Gateway handling SSL termination
  DO_IMAGE: "", // ID of DigitalOcean snapshot image to use for vbrowser
  DO_SSH_KEYS: "", // IDs of DigitalOcean SSH keys to access vbrowsers
  HETZNER_TOKEN: "", // Optional, for Hetzner VMs
  HETZNER_GATEWAY: "", // Gateway handling SSL termination
  HETZNER_SSH_KEYS: "", // IDs of Hetzner SSH keys to access vbrowsers
  HETZNER_IMAGE: "", // ID of Hetzner snapshot image to use for vbrowser
  SCW_SECRET_KEY: "", // Optional, for Scaleway VMs
  SCW_ORGANIZATION_ID: "", // Optional, for Scaleway VMs
  SCW_GATEWAY: "", // Gateway handling SSL termination
  SCW_IMAGE: "", // ID of Scaleway snapshot image to use for vbrowser
  // Azure VM Configuration
  AZURE_CLIENT_ID: "", // Optional, Azure Service Principal Application Client ID
  AZURE_CLIENT_SECRET: "", // Optional, Azure Service Principal Client Secret
  AZURE_TENANT_ID: "", // Optional, Azure AD Directory Tenant ID
  AZURE_SUBSCRIPTION_ID: "", // Optional, Azure Subscription ID
  AZURE_RESOURCE_GROUP: "", // Optional, Azure Resource Group Name
  AZURE_LOCATION: "eastus", // Optional, Azure location/region (e.g. eastus)
  AZURE_GATEWAY: "", // Optional, Gateway handling SSL termination for Azure
  AZURE_IMAGE_ID: "", // Optional, Azure Resource ID for custom managed image (/subscriptions/.../resourceGroups/.../providers/Microsoft.Compute/images/...)
  AZURE_ADMIN_USERNAME: "azureuser", // Optional, Admin username for Azure VMs
  AZURE_SSH_KEY: "", // Optional, Public SSH key for Azure VM admin user
  AZURE_SUBNET_ID: "", // Optional, Azure Virtual Network Subnet ID for attaching NICs
  AZURE_REUSE_VMS: false, // Optional, default false (clean termination per session)
  VM_MANAGER_CONFIG: "", // Comma-separated list of the pools of VMs to run (provider:size:region:minSize:limitSize:hostname), e.g. Docker:large:US:0:1:localhost,Docker:standard:US:0:1:localhost
  VM_MIN_UPTIME_MINUTES: 15, // Number of minutes of the hour VMs must exist for before being eligible for termination
  VMWORKER_PORT: 3100, // Port to use for the vmWorker HTTP server
  VM_ASSIGNMENT_TIMEOUT: 75, // Number of seconds to wait for a VM before failing
  VBROWSER_ADMIN_KEY: "", // Optional, the key to hit admin endpoints on the vbrowser

  // ==========================================
  // NOTIFY-001, NOTIFY-002 & NOTIFY-004: Transactional Email Architecture
  // ==========================================
  EMAIL_PROVIDER: "smtp",          // Global default email provider adapter: "brevo" | "resend" | "smtp"
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

  // Resend API Configuration
  RESEND_API_KEY: "",              // Resend API key; leave blank for dry-run
  RESEND_FROM_EMAIL: "CoWatch <noreply@cowatch.tv>", // Legacy Resend from-address
  RESEND_WEBHOOK_SECRET: "",       // Resend Svix webhook signing secret (whsec_...)

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
  DOCKER_VM_HOST: "localhost", // Optional, for Docker VMs
  DOCKER_VM_HOST_SSH_USER: "root", // Optional, username for Docker host
  DOCKER_VM_HOST_SSH_KEY_BASE64: "", // Optional, private SSH key for Docker host, or default to ~/.ssh/id_rsa content
  SSL_KEY_FILE: "", // Optional, Filename of SSL key (to use https for local development)
  SSL_CRT_FILE: "", // Optional, Filename of SSL cert (to use https for local development)
  STATS_KEY: "", // Secret string to validate viewing stats
  CUSTOM_SETTINGS_HOSTNAME: "", // Hostname to send different config settings to client
};

const resolvedConfig = {
  ...defaults,
  ...process.env,
  VIRTUAL_BROWSER_ENABLED:
    process.env.VIRTUAL_BROWSER_ENABLED !== undefined
      ? process.env.VIRTUAL_BROWSER_ENABLED === "true"
      : defaults.VIRTUAL_BROWSER_ENABLED,
  VIRTUAL_BROWSER_PROVIDER: (
    process.env.VIRTUAL_BROWSER_PROVIDER || defaults.VIRTUAL_BROWSER_PROVIDER
  ).toLowerCase(),
  VBROWSER_AUTOSCALING:
    process.env.VBROWSER_AUTOSCALING !== undefined
      ? process.env.VBROWSER_AUTOSCALING === "true"
      : defaults.VBROWSER_AUTOSCALING,
  VBROWSER_PROVIDER_LIMIT:
    process.env.VBROWSER_PROVIDER_LIMIT !== undefined
      ? Number(process.env.VBROWSER_PROVIDER_LIMIT)
      : defaults.VBROWSER_PROVIDER_LIMIT,
  VBROWSER_POOL_LIMIT:
    process.env.VBROWSER_POOL_LIMIT !== undefined
      ? Number(process.env.VBROWSER_POOL_LIMIT)
      : defaults.VBROWSER_POOL_LIMIT,
  AZURE_REUSE_VMS:
    process.env.AZURE_REUSE_VMS !== undefined
      ? process.env.AZURE_REUSE_VMS === "true"
      : defaults.AZURE_REUSE_VMS,
};

export default resolvedConfig;
