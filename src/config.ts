export default {
  VITE_SERVER_HOST:
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVER_HOST) ||
    "https://cowatchwatchparty-production.up.railway.app,https://cowatch-watchparty.onrender.com",
  VITE_OAUTH_REDIRECT_HOSTNAME:
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_OAUTH_REDIRECT_HOSTNAME) ?? "https://www.cowatch.me",
  VITE_AUTH_SIGNIN_METHODS:
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_SIGNIN_METHODS) ?? "google,email",
  NODE_ENV:
    (typeof import.meta !== "undefined" && import.meta.env?.DEV) ? "development" : "production",
  VITE_SUPABASE_URL:
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) || "",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) || "",
};
