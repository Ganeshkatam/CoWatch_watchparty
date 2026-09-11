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
  REDIS_URL: "", // Optional, for metrics and Redis connection
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
  VM_MANAGER_CONFIG: "", // Comma-separated list of the pools of VMs to run (provider:size:region:minSize:limitSize:hostname), e.g. Docker:large:US:0:1:localhost,Docker:standard:US:0:1:localhost
  VM_MIN_UPTIME_MINUTES: 15, // Number of minutes of the hour VMs must exist for before being eligible for termination
  VMWORKER_PORT: 3100, // Port to use for the vmWorker HTTP server
  VM_ASSIGNMENT_TIMEOUT: 75, // Number of seconds to wait for a VM before failing
  VBROWSER_ADMIN_KEY: "", // Optional, the key to hit admin endpoints on the vbrowser

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
};

export default resolvedConfig;
