import config from "../config.ts";
import { postgres } from "../utils/postgres.ts";
import { getUser } from "../utils/supabase.ts";
import { providerRegistry } from "./provider-registry.ts";
import type { AssignedVM } from "./base.ts";

export type VBrowserPolicyCode =
  | "AUTHENTICATION_REQUIRED"
  | "VBROWSER_UNAVAILABLE"
  | "VBROWSER_USER_LIMIT"
  | "VBROWSER_ROOM_LIMIT"
  | "VBROWSER_DURATION_LIMIT";

export class VBrowserPolicyError extends Error {
  public readonly code: VBrowserPolicyCode;
  constructor(code: VBrowserPolicyCode) {
    super(code);
    this.name = "VBrowserPolicyError";
    this.code = code;
  }
}

export interface AllocateInput {
  roomId: string;
  uid: string;
  isLarge?: boolean;
  region?: string;
  requestedDuration?: number;
}

export interface AllocateResult {
  reservationId: string;
  assignment: AssignedVM;
  duration: number;
  providerId: string;
  poolId: string;
}

/** Server-only, fail-closed gate for all VBrowser allocations. */
export class VBrowserPolicyService {
  /**
   * Enforces authentication invariant.
   * Fail-closed: Missing account or unavailable Supabase results in AUTHENTICATION_REQUIRED.
   */
  async validateAuthentication(uid: string): Promise<void> {
    if (!uid || !config.SUPABASE_URL || !postgres) {
      throw new VBrowserPolicyError("AUTHENTICATION_REQUIRED");
    }
    try {
      const user = await getUser(uid);
      if (!user) {
        throw new VBrowserPolicyError("AUTHENTICATION_REQUIRED");
      }
      if (
        user.app_metadata?.provider === "email" &&
        !user.email_confirmed_at
      ) {
        throw new VBrowserPolicyError("AUTHENTICATION_REQUIRED");
      }
    } catch (e) {
      if (e instanceof VBrowserPolicyError) throw e;
      throw new VBrowserPolicyError("AUTHENTICATION_REQUIRED");
    }
  }

  /**
   * Resolves enabled provider and pool from DB, validates mandatory policy fields,
   * calculates effective session duration limits, and enforces requested duration bounds.
   */
  async resolveAndCalculate(input: {
    isLarge?: boolean;
    region?: string;
    requestedDuration?: number;
  }) {
    if (!postgres) {
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }

    const isLarge = Boolean(input.isLarge);
    const region = input.region || "";

    const { rows } = await postgres.query(
      `SELECT 
         p.id AS provider_id, p.enabled AS p_enabled, p.lifecycle AS p_lifecycle,
         p.max_concurrent_sessions AS p_max_concurrent, p.max_sessions_per_user AS p_max_user,
         p.max_sessions_per_room AS p_max_room, p.max_large_sessions AS p_max_large,
         p.max_session_duration_seconds AS p_max_dur, p.max_large_session_duration_seconds AS p_max_large_dur,
         q.id AS pool_id, q.enabled AS q_enabled, q.lifecycle AS q_lifecycle,
         q.limit_size AS q_limit_size, q.max_sessions_per_user AS q_max_user,
         q.max_sessions_per_room AS q_max_room, q.max_large_sessions AS q_max_large,
         q.max_session_duration_seconds AS q_max_dur, q.max_large_session_duration_seconds AS q_max_large_dur
       FROM vbrowser_providers p
       JOIN vbrowser_pools q ON q.provider_id = p.id
       WHERE p.enabled = true AND p.lifecycle = 'ENABLED'
         AND q.enabled = true AND q.lifecycle = 'ENABLED'
         AND q.is_large = $1 AND ($2 = '' OR q.region = $2)
       ORDER BY q.id LIMIT 1`,
      [isLarge, region]
    );

    const target = rows[0];
    if (!target) {
      // Empty registry produces VBROWSER_UNAVAILABLE without contacting any provider
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }

    // Fail closed if any mandatory DB policy field is missing or invalid
    const mandatoryFields = [
      target.p_max_concurrent,
      target.p_max_user,
      target.p_max_room,
      target.p_max_large,
      target.p_max_dur,
      target.p_max_large_dur,
      target.q_limit_size,
      target.q_max_user,
      target.q_max_room,
      target.q_max_large,
      target.q_max_dur,
      target.q_max_large_dur,
    ];

    for (const val of mandatoryFields) {
      if (val === null || val === undefined || Number(val) < 0) {
        throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
      }
    }
    if (
      Number(target.p_max_dur) <= 0 ||
      Number(target.p_max_large_dur) <= 0 ||
      Number(target.q_max_dur) <= 0 ||
      Number(target.q_max_large_dur) <= 0
    ) {
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }

    // Effective session duration:
    // standard = MIN(config.standard, DB.provider.standard, DB.pool.standard)
    // large    = MIN(config.large, DB.provider.large, DB.pool.large)
    const configStandardDur = Number(config.VBROWSER_SESSION_SECONDS || 10800);
    const configLargeDur = Number(config.VBROWSER_SESSION_SECONDS_LARGE || 86400);

    const effectiveStandardDur = Math.min(
      configStandardDur,
      Number(target.p_max_dur),
      Number(target.q_max_dur)
    );
    const effectiveLargeDur = Math.min(
      configLargeDur,
      Number(target.p_max_large_dur),
      Number(target.q_max_large_dur)
    );

    const effectiveDuration = isLarge ? effectiveLargeDur : effectiveStandardDur;

    if (input.requestedDuration && input.requestedDuration > effectiveDuration) {
      throw new VBrowserPolicyError("VBROWSER_DURATION_LIMIT");
    }

    return {
      providerId: target.provider_id as string,
      poolId: target.pool_id as string,
      effectiveDuration,
    };
  }

  /**
   * Executes atomic reservation in PostgreSQL database.
   */
  async reserveCapacity(input: {
    providerId: string;
    poolId: string;
    roomId: string;
    uid: string;
    isLarge: boolean;
    duration: number;
  }): Promise<string> {
    if (!postgres) {
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }

    try {
      const configProviderLimit = config.VBROWSER_PROVIDER_LIMIT ?? 2147483647;
      const configPoolLimit = config.VBROWSER_POOL_LIMIT ?? 2147483647;

      const result = await postgres.query(
        `SELECT reserve_vbrowser_capacity($1,$2,$3,$4,$5,$6,$7,$8) AS id`,
        [
          input.providerId,
          input.poolId,
          input.roomId,
          input.uid,
          input.isLarge,
          configProviderLimit,
          configPoolLimit,
          input.duration,
        ]
      );
      return result.rows[0].id as string;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("USER_CAPACITY_EXCEEDED")) {
        throw new VBrowserPolicyError("VBROWSER_USER_LIMIT");
      }
      if (msg.includes("ROOM_CAPACITY_EXCEEDED")) {
        throw new VBrowserPolicyError("VBROWSER_ROOM_LIMIT");
      }
      if (
        msg.includes("PROVIDER_CAPACITY_EXCEEDED") ||
        msg.includes("POOL_CAPACITY_EXCEEDED") ||
        msg.includes("LARGE_CAPACITY_EXCEEDED") ||
        msg.includes("POLICY_INVALID") ||
        msg.includes("POLICY_MISSING_OR_DISABLED")
      ) {
        throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
      }
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }
  }

  /** Standalone atomic reservation method for policy service. */
  async reserve(input: {
    roomId: string;
    uid: string;
    isLarge: boolean;
    region?: string;
    requestedDuration?: number;
  }) {
    await this.validateAuthentication(input.uid);
    const resolved = await this.resolveAndCalculate(input);
    const id = await this.reserveCapacity({
      providerId: resolved.providerId,
      poolId: resolved.poolId,
      roomId: input.roomId,
      uid: input.uid,
      isLarge: Boolean(input.isLarge),
      duration: resolved.effectiveDuration,
    });
    return { id, duration: resolved.effectiveDuration };
  }

  /** Releases a reservation by ID. */
  async release(id: string, reason = "RELEASED"): Promise<void> {
    if (!postgres || !id) return;
    const status = reason === "ADAPTER_FAILURE" ? "FAILED" : "RELEASED";
    await postgres.query(
      `UPDATE vbrowser_reservations 
       SET status = $1, released_at = now(), failure_reason = $2 
       WHERE id = $3 AND status IN ('RESERVED', 'ALLOCATED')`,
      [status, reason, id]
    );
  }

  /** Releases all active reservations associated with a room. */
  async releaseByRoom(roomId: string): Promise<void> {
    if (!postgres || !roomId) return;
    await postgres.query(
      `UPDATE vbrowser_reservations 
       SET status = 'RELEASED', released_at = now() 
       WHERE room_id = $1 AND status IN ('RESERVED', 'ALLOCATED')`,
      [roomId]
    );
  }

  /**
   * Primary, authoritative application-facing allocation API.
   * Guaranteed sequence: Authenticate -> Resolve -> Registry -> Reserve -> Assign.
   * Cleans up reservation upon adapter assignment failure.
   */
  async allocate(input: AllocateInput): Promise<AllocateResult> {
    // 1. Authenticate user
    await this.validateAuthentication(input.uid);

    // 2. Resolve provider, pool, and calculate effective limits from DB
    const resolved = await this.resolveAndCalculate(input);

    // 3. Resolve adapter from registry BEFORE reservation
    //    Never reserve capacity for a provider the server cannot execute.
    //    poolId is the canonical key matching BaseVMManager.getPoolName().
    const manager = providerRegistry.resolve(resolved.poolId);
    if (!manager) {
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }

    // 4. Atomic reservation
    const reservationId = await this.reserveCapacity({
      providerId: resolved.providerId,
      poolId: resolved.poolId,
      roomId: input.roomId,
      uid: input.uid,
      isLarge: Boolean(input.isLarge),
      duration: resolved.effectiveDuration,
    });

    // 5. Provider assignment via resolved manager
    let assignment: AssignedVM | null = null;
    try {
      assignment = await manager.assignVM(input.roomId, input.uid) || null;
      if (!assignment) {
        throw new Error("Manager assignVM returned null");
      }
    } catch (e) {
      // 6. Rollback reservation on failure
      await this.release(reservationId, "ADAPTER_FAILURE");
      if (e instanceof VBrowserPolicyError) throw e;
      throw new VBrowserPolicyError("VBROWSER_UNAVAILABLE");
    }

    // 7. Confirm allocation in DB upon success
    if (postgres) {
      await postgres.query(
        `UPDATE vbrowser_reservations SET status = 'ALLOCATED' WHERE id = $1`,
        [reservationId]
      );
    }

    return {
      reservationId,
      assignment,
      duration: resolved.effectiveDuration,
      providerId: resolved.providerId,
      poolId: resolved.poolId,
    };
  }
}

export const vBrowserPolicyService = new VBrowserPolicyService();
