import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import config from "../config";

const supabaseUrl = config.VITE_SUPABASE_URL;
const supabaseKey = config.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase URL or Publishable Key is missing from configuration.");
}

// Singleton: survive Vite HMR reloads so only one GoTrueClient exists per browser tab
const globalForSupabase = globalThis as unknown as { __supabase?: SupabaseClient };

export const supabase: SupabaseClient =
  globalForSupabase.__supabase ??
  createClient(supabaseUrl || "", supabaseKey || "");

globalForSupabase.__supabase = supabase;

export function getCachedSupabaseUser(): User | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const val = window.localStorage.getItem(key);
        if (val && val !== "{}" && val !== "null") {
          const parsed = JSON.parse(val);
          const user = parsed?.user ?? parsed?.currentSession?.user;
          if (user && user.id) {
            return user as User;
          }
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

export function getCachedSupabaseToken(): string | undefined {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const val = window.localStorage.getItem(key);
        if (val && val !== "{}" && val !== "null") {
          const parsed = JSON.parse(val);
          const token = parsed?.access_token ?? parsed?.currentSession?.access_token;
          if (token && typeof token === "string") {
            return token;
          }
        }
      }
    }
  } catch (e) {
    return undefined;
  }
  return undefined;
}

export function hasCachedSupabaseToken(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return Boolean(getCachedSupabaseToken());
}

export async function safeGetSession(timeoutMs = 2000) {
  try {
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<{ data: { session: null }; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null }, error: new Error("Session timeout") }), timeoutMs)
    );
    return await Promise.race([sessionPromise, timeoutPromise]);
  } catch (err) {
    return { data: { session: null }, error: err as Error };
  }
}

export async function getAccessToken(timeoutMs = 2500): Promise<string | undefined> {
  try {
    const { data } = await safeGetSession(timeoutMs);
    if (data.session?.access_token) {
      return data.session.access_token;
    }
    return getCachedSupabaseToken();
  } catch (err) {
    console.warn("Failed to get access token, using cached token:", err);
    return getCachedSupabaseToken();
  }
}