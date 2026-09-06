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

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}