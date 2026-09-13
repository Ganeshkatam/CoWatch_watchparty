/**
 * Centralized Operator & Admin Authorization Engine
 *
 * INVARIANTS:
 * 1. Derives operator identity and admin authority strictly from server-managed claims:
 *    - Valid STATS_KEY operator header
 *    - Supabase verified JWT with server-controlled app_metadata.role === 'admin'
 *    - Supabase verified JWT with server-controlled app_metadata.is_admin === true
 * 2. NEVER trusts client-writable claims (such as user_metadata).
 * 3. All administrative REST routes (/api/admin/*) must flow through this choke-point.
 */

import type { Request } from 'express';
import config from '../config.ts';
import { supabaseAdmin } from './supabase.ts';

export interface OperatorAuthResult {
  authorized: boolean;
  operatorId?: string;
}

export async function authenticateOperator(
  req: Request | { headers?: Record<string, any>; query?: Record<string, any> },
  customSupabaseClient?: any
): Promise<OperatorAuthResult> {
  const operatorKey =
    req.headers?.["x-operator-key"] ||
    req.headers?.["x-stats-key"] ||
    (req.query as any)?.key;

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
