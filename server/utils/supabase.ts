import { createClient } from "@supabase/supabase-js";
import config from "../config.ts";

const supabaseUrl = config.SUPABASE_URL || "";
const supabaseSecretKey = config.SUPABASE_SECRET_KEY || "";

if (!supabaseUrl || !supabaseSecretKey) {
  console.warn("Supabase URL or Secret Key is missing from configuration.");
}

// Public client for validating user access tokens
// This intentionally DOES NOT use the secret key, so it cannot bypass RLS
// We just use it to verify the JWT provided by the frontend.
// Wait, we don't have an anon key in the backend. 
// For validating tokens, we just use the secret key to instantiate an admin client,
// but for standard getUser(jwt), it doesn't matter since it sends the JWT directly.
// Actually, to validate a JWT securely, we use supabase.auth.getUser(jwt).

export const supabaseAdmin = supabaseUrl && supabaseSecretKey 
  ? createClient(supabaseUrl, supabaseSecretKey) 
  : null as any;

export async function validateUserToken(uid: string, token: string, requireConfirmation: boolean = true) {
  if (!supabaseUrl || !supabaseSecretKey || !token) {
    return undefined;
  }
  try {
    // getUser(token) validates the JWT against the Supabase Auth server directly.
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return undefined;
    }
    if (uid !== user.id) {
      // Valid but for wrong user
      return undefined;
    }

    if (requireConfirmation && user.email_confirmed_at == null) {
      return "EMAIL_NOT_VERIFIED";
    }

    // Return a mocked decoded token matching the previous Auth interface
    return { uid: user.id, email: user.email, email_verified: user.email_confirmed_at != null };
  } catch (e) {
    console.log(e);
    return undefined;
  }
}

import { postgres } from "./postgres.ts";

// Administrative operations (bypass RLS)
export async function getUserByEmail(email: string) {
  if (!supabaseUrl || !supabaseSecretKey) return null;
  try {
    // Supabase JS doesn't have a direct getUserByEmail, but we can query auth.users directly since we have pg connected as superuser.
    const result = await postgres?.query("SELECT id, email FROM auth.users WHERE email = $1 LIMIT 1", [email]);
    if (result && result.rows.length > 0) {
      return { uid: result.rows[0].id, email: result.rows[0].email };
    }
    return null;
  } catch (e: any) {
    console.log(email, e.message);
  }
  return null;
}

export async function getUser(uid: string) {
  if (!supabaseUrl || !supabaseSecretKey) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (error) throw error;
    return user;
  } catch(e) {
    return null;
  }
}

export async function getUserEmail(uid: string) {
  if (!supabaseUrl || !supabaseSecretKey) return null;
  const user = await getUser(uid);
  return user?.email;
}

export async function deleteUser(uid: string) {
  if (!supabaseUrl || !supabaseSecretKey) return null;
  return supabaseAdmin.auth.admin.deleteUser(uid);
}
