import express, { type Request, type Response, Router } from "express";
import { postgres as defaultPostgres } from "../utils/postgres.ts";
import { supabaseAdmin as defaultSupabaseAdmin } from "../utils/supabase.ts";
import { checkDurableAbuseReportRateLimit } from "../utils/durableRateLimit.ts";
import { recordAbuseReportAttempt } from "../utils/abuseReportRateLimit.ts";
import { checkFeedbackRateLimit, recordFeedbackAttempt } from "../utils/feedbackRateLimit.ts";
import { feedbackTelemetry as defaultFeedbackTelemetry } from "../utils/feedbackTelemetry.ts";

export interface FeedbackRouterOptions {
  postgres?: typeof defaultPostgres;
  supabaseAdmin?: typeof defaultSupabaseAdmin;
  feedbackTelemetry?: typeof defaultFeedbackTelemetry;
  checkAbuseReportRateLimit?: typeof checkDurableAbuseReportRateLimit;
}

export function createFeedbackRouter(options?: FeedbackRouterOptions): Router {
  const router = express.Router();
  const postgres = options?.postgres !== undefined ? options.postgres : defaultPostgres;
  const supabaseAdmin = options?.supabaseAdmin !== undefined ? options.supabaseAdmin : defaultSupabaseAdmin;
  const telemetry = options?.feedbackTelemetry ?? defaultFeedbackTelemetry;
  const checkAbuseReportRateLimit = options?.checkAbuseReportRateLimit ?? checkDurableAbuseReportRateLimit;

  const handleAbuseReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";

      // 1. Authentication check: Bearer token is strictly required
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid authorization header" });
        return;
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        res.status(401).json({ error: "Bearer token missing" });
        return;
      }

      let reporterUserId: string;
      try {
        if (!supabaseAdmin) {
          res.status(401).json({ error: "Unauthorized session or token expired" });
          return;
        }
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user?.id) {
          res.status(401).json({ error: "Unauthorized session or token expired" });
          return;
        }
        reporterUserId = user.id;
      } catch (_authErr: unknown) {
        res.status(401).json({ error: "Failed to authenticate session token" });
        return;
      }

      // 2. Strict Payload Validation
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Invalid request payload format" });
        return;
      }

      const allowedKeys = new Set(["category", "reason", "targetUserId", "targetRoomId", "context"]);
      const bodyKeys = Object.keys(req.body);
      if (bodyKeys.some((k) => !allowedKeys.has(k))) {
        res.status(400).json({ error: "Payload contains unrecognized fields" });
        return;
      }

      const { category, reason, targetUserId, targetRoomId, context } = req.body;

      const validCategories = new Set([
        "harassment",
        "spam",
        "hate_speech",
        "inappropriate_content",
        "copyright",
        "other",
      ]);

      if (!category || typeof category !== "string" || !validCategories.has(category)) {
        res.status(400).json({ error: "Invalid or missing report category" });
        return;
      }

      if (!reason || typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 1000) {
        res.status(400).json({ error: "Reason must be between 5 and 1000 characters" });
        return;
      }

      const cleanTargetUserId = typeof targetUserId === "string" && targetUserId.trim() ? targetUserId.trim() : null;
      const cleanTargetRoomId = typeof targetRoomId === "string" && targetRoomId.trim() ? targetRoomId.trim() : null;

      if (!cleanTargetUserId && !cleanTargetRoomId) {
        res.status(400).json({ error: "At least one target (user or room) must be specified" });
        return;
      }

      // Self-reporting check
      if (cleanTargetUserId && cleanTargetUserId === reporterUserId) {
        res.status(400).json({ error: "Cannot report yourself" });
        return;
      }

      const cleanContext = context && typeof context === "object" && !Array.isArray(context) ? context : {};

      // Consume quota only after the complete report payload has passed validation.
      const rateLimit = await checkAbuseReportRateLimit(ip, reporterUserId);
      if (!rateLimit.allowed) {
        res.status(429).json({
          error: "Too many abuse reports submitted. Please try again later.",
          retryAfter: rateLimit.retryAfterSeconds,
        });
        return;
      }

      // 4. Server/service-role database write (bypassing client RLS securely)
      const query = `
        INSERT INTO public.abuse_reports (
          reporter_user_id,
          target_user_id,
          target_room_id,
          category,
          reason,
          context,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        RETURNING id, created_at;
      `;

      const values = [
        reporterUserId,
        cleanTargetUserId,
        cleanTargetRoomId,
        category,
        reason.trim(),
        JSON.stringify(cleanContext),
      ];

      let result: { rows: Array<{ id: string; created_at: string }> };
      if (postgres) {
        const pgResult = await postgres.query<{ id: string; created_at: string }>(query, values);
        result = { rows: pgResult.rows };
      } else if (supabaseAdmin) {
        const { data, error: sbErr } = await supabaseAdmin
          .from("abuse_reports")
          .insert({
            reporter_user_id: reporterUserId,
            target_user_id: cleanTargetUserId,
            target_room_id: cleanTargetRoomId,
            category,
            reason: reason.trim(),
            context: cleanContext,
            status: "pending",
          })
          .select("id, created_at")
          .single();
        if (sbErr) throw sbErr;
        result = { rows: [data] };
      } else {
        throw new Error("No database connection available");
      }

      recordAbuseReportAttempt(ip, reporterUserId);

      res.status(201).json({
        success: true,
        reportId: result.rows[0].id,
        createdAt: result.rows[0].created_at,
      });
    } catch (err: unknown) {
      console.error("Error processing abuse report:", err);
      res.status(500).json({ error: "Internal server error while filing report" });
    }
  };

  const handleFeedback = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    telemetry.recordSubmissionAttempt();

    try {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";

      // 1. Strict Payload & Schema Guard: Reject malformed JSON, non-objects, or arrays
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        telemetry.recordValidationFailure();
        res.status(400).json({ error: "Invalid request payload format" });
        return;
      }

      // 2. Reject unexpected / forbidden / internal fields before processing
      const allowedKeys = new Set(["type", "rating", "message", "context", "app_version", "platform", "idempotency_key"]);
      const bodyKeys = Object.keys(req.body);
      const hasForbiddenKeys = bodyKeys.some((k) => !allowedKeys.has(k));
      if (hasForbiddenKeys) {
        telemetry.recordValidationFailure();
        res.status(400).json({ error: "Payload contains unrecognized or forbidden fields" });
        return;
      }

      // 3. Zero-Trust Identity: Strictly derive from verified server session, NEVER from client body or header
      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          if (supabaseAdmin) {
            const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
            if (!error && user?.id) {
              userId = user.id;
            }
          }
        } catch (_authErr: unknown) {
          userId = null;
        }
      }

      // 4. Rate limiting check (In-memory sliding window, 0 Redis commands)
      const rateLimit = checkFeedbackRateLimit(ip, userId);
      if (!rateLimit.allowed) {
        telemetry.recordRateLimitDrop();
        res.status(429).json({
          error: "Too many feedback submissions. Please try again later.",
          retryAfter: rateLimit.retryAfterSeconds,
        });
        return;
      }

      // 5. Input Validation & Strict Enums
      const {
        type: rawType,
        context: rawContext,
        rating: rawRating,
        message: rawMessage,
        app_version: rawAppVersion,
        platform: rawPlatform,
        idempotency_key: rawIdempotencyKey,
      } = req.body;

      const allowedTypes = ["bug", "suggestion", "problem", "experience"];
      const allowedContexts = [
        "room",
        "playback",
        "host",
        "participants",
        "chat",
        "video",
        "connection",
      ];

      if (!rawType || typeof rawType !== "string" || !allowedTypes.includes(rawType)) {
        telemetry.recordValidationFailure();
        res.status(400).json({ error: "Invalid feedback type" });
        return;
      }

      if (!rawMessage || typeof rawMessage !== "string") {
        telemetry.recordValidationFailure();
        res.status(400).json({ error: "Feedback message is required" });
        return;
      }

      // Unicode normalization (NFC) & whitespace trim
      const normalizedMessage = rawMessage.normalize("NFC").trim();
      if (!normalizedMessage) {
        telemetry.recordValidationFailure();
        res.status(400).json({ error: "Feedback message cannot be empty or whitespace only" });
        return;
      }

      if (normalizedMessage.length > 2000) {
        telemetry.recordValidationFailure();
        res.status(400).json({ error: "Feedback message must not exceed 2000 characters" });
        return;
      }

      const context = rawContext && typeof rawContext === "string" && allowedContexts.includes(rawContext)
        ? rawContext
        : "room";

      let rating: number | null = null;
      if (rawRating !== undefined && rawRating !== null) {
        if (typeof rawRating !== "number" || !Number.isInteger(rawRating) || rawRating < 1 || rawRating > 5) {
          telemetry.recordValidationFailure();
          res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
          return;
        }
        rating = rawRating;
      }

      const appVersion = typeof rawAppVersion === "string" ? rawAppVersion.slice(0, 50) : "1.0.3";
      const platform = typeof rawPlatform === "string" ? rawPlatform.slice(0, 50) : "web";
      const idempotencyKey = typeof rawIdempotencyKey === "string" && rawIdempotencyKey.trim().length > 0
        ? rawIdempotencyKey.trim().slice(0, 100)
        : (typeof req.headers["x-idempotency-key"] === "string" ? (req.headers["x-idempotency-key"] as string).slice(0, 100) : null);

      // 6. Privacy & Redaction Barrier: Strip sensitive credentials, JWTs, keys, and connection URIs
      const sanitizedMessage = normalizedMessage
        .replace(/\bBearer\s+[A-Za-z0-9-_=.]+\b/gi, "[TOKEN_REDACTED]")
        .replace(/\b(sk_[a-zA-Z0-9_-]{20,}|sbp_[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})\b/g, "[TOKEN_REDACTED]")
        .replace(/\b(redis|postgres|postgresql|mongodb):\/\/[^\s]+/gi, "[URI_REDACTED]")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "[SCRIPT_REMOVED]");

      if (!postgres) {
        telemetry.recordDbFailure();
        res.status(503).json({ error: "Database service unavailable" });
        return;
      }

      // 7. Idempotency Check: Short-circuit if identical idempotency key already persisted
      if (idempotencyKey) {
        try {
          const existingResult = await postgres.query<{ id: string; created_at: string }>(
            `SELECT id, created_at FROM public.feedback WHERE idempotency_key = $1`,
            [idempotencyKey]
          );
          if (existingResult.rows.length > 0) {
            const existing = existingResult.rows[0];
            telemetry.recordSubmissionSuccess(true, Date.now() - startTime);
            res.status(200).json({
              success: true,
              id: existing.id,
              created_at: existing.created_at,
              deduped: true,
            });
            return;
          }
        } catch (checkErr: unknown) {
          console.warn("Idempotency check query failed, proceeding to insert:", checkErr);
        }
      }

      // 8. Direct PostgreSQL insert with authoritative default status = 'new'
      let insertResult;
      try {
        insertResult = await postgres.query<{ id: string; created_at: string }>(
          `INSERT INTO public.feedback (user_id, type, rating, message, context, app_version, platform, status, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8)
           ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING id, created_at`,
          [userId, rawType, rating, sanitizedMessage, context, appVersion, platform, idempotencyKey]
        );
      } catch (dbErr: unknown) {
        console.error("Feedback database insert error:", dbErr);
        telemetry.recordDbFailure();
        res.status(503).json({ error: "Database service unavailable" });
        return;
      }

      recordFeedbackAttempt(ip, userId);

      let inserted = insertResult.rows[0];
      let isDeduped = false;

      // In case of concurrent race on same idempotency key
      if (!inserted && idempotencyKey) {
        const fallbackResult = await postgres.query<{ id: string; created_at: string }>(
          `SELECT id, created_at FROM public.feedback WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        inserted = fallbackResult.rows[0];
        isDeduped = true;
      }

      if (!inserted) {
        telemetry.recordDbFailure();
        res.status(500).json({ error: "Failed to persist feedback" });
        return;
      }

      telemetry.recordSubmissionSuccess(isDeduped, Date.now() - startTime);

      res.status(200).json({
        success: true,
        id: inserted.id,
        created_at: inserted.created_at,
        ...(isDeduped ? { deduped: true } : {}),
      });
    } catch (err: unknown) {
      console.error("Feedback submission error:", err);
      telemetry.recordDbFailure();
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  };

  // Register both prefixed and non-prefixed paths for absolute routing resilience
  router.post("/api/reports/abuse", handleAbuseReport);
  router.post("/reports/abuse", handleAbuseReport);
  router.post("/api/feedback", handleFeedback);
  router.post("/feedback", handleFeedback);

  return router;
}
