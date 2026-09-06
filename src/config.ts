export default {
  VITE_SERVER_HOST: import.meta.env.VITE_SERVER_HOST,
  VITE_OAUTH_REDIRECT_HOSTNAME:
    import.meta.env.VITE_OAUTH_REDIRECT_HOSTNAME ?? "https://www.cowatch.me",
  VITE_AUTH_SIGNIN_METHODS: import.meta.env.VITE_AUTH_SIGNIN_METHODS ?? "google,email",
  NODE_ENV: import.meta.env.DEV ? "development" : "production",
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || "",
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
};
