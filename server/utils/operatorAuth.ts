/**
 * Centralized Operator & Admin Authorization Engine
 *
 * INVARIANTS:
 * 1. Derives operator identity and admin authority strictly from server-managed claims:
 *    - Valid STATS_KEY passed exclusively via HTTP headers (x-operator-key, x-stats-key)
 *    - Supabase verified JWT with server-controlled app_metadata.role === 'admin'
 *    - Supabase verified JWT with server-controlled app_metadata.is_admin === true
 * 2. NEVER derives operator credentials from URL query parameters (?key=...).
 * 3. NEVER trusts client-writable claims (such as user_metadata).
 * 4. All administrative REST routes (/api/admin/*) and operational metrics endpoints must flow through this choke-point.
 */

import type { Request } from 'express';
import config from '../config.ts';
import { supabaseAdmin } from './supabase.ts';

export interface OperatorAuthResult {
  authorized: boolean;
  operatorId?: string;
}

export async function authenticateOperator(
  req: Request | { headers?: Record<string, any> },
  customSupabaseClient?: any
): Promise<OperatorAuthResult> {
  // Enforce: Operator keys are accepted EXCLUSIVELY via HTTP headers.
  // Query parameters (?key=...) are strictly forbidden to prevent credential leakage in logs, history, and referrers.
  const operatorKey =
    req.headers?.["x-operator-key"] ||
    req.headers?.["x-stats-key"];

  if (config.STATS_KEY && operatorKey === config.STATS_KEY) {
    return { authorized: true, operatorId: "system-operator" };
  }

  const authHeader = req.headers?.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const client = customSupabaseClient || supabaseAdmin;
      const { data: { user }, error } = await client.auth.getUser(token);
      if (!error && user) {
        // Enforce: ONLY server-controlled app_metadata is authoritative for admin authority.
        const isAdmin =
          user.app_metadata?.role === "admin" ||
          user.app_metadata?.is_admin === true;
        if (isAdmin) {
          return { authorized: true, operatorId: user.id };
        }
      }
    } catch {
      // Return unauthenticated on any JWT resolution error
    }
  }

  return { authorized: false };
}
