import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export function hasCachedSupabaseToken(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const val = window.localStorage.getItem(key);
        if (val && val !== "{}" && val !== "null") return true;
      }
    }
  } catch (e) {
    return false;
  }
  return false;
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

export async function getAccessToken(timeoutMs = 2000) {
  try {
    const { data } = await safeGetSession(timeoutMs);
    return data.session?.access_token;
  } catch (err) {
    console.warn("Failed to get access token:", err);
    return undefined;
  }
}