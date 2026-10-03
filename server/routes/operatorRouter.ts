import express, { type Request, type Response, Router } from "express";
import { authenticateOperator as defaultAuthenticateOperator } from "../utils/operatorAuth.ts";
import { getStats as defaultGetStats } from "../utils/getStats.ts";
import { RedisMetrics as defaultRedisMetrics, metricsRedis as defaultMetricsRedis } from "../utils/redis.ts";
import { postgres as defaultPostgres } from "../utils/postgres.ts";
import { feedbackTelemetry as defaultFeedbackTelemetry } from "../utils/feedbackTelemetry.ts";

export interface OperatorRouterOptions {
  authenticate?: typeof defaultAuthenticateOperator;
  getStatsFn?: typeof defaultGetStats;
  redisMetrics?: typeof defaultRedisMetrics;
  metricsRedisClient?: typeof defaultMetricsRedis;
  postgres?: typeof defaultPostgres;
  telemetry?: typeof defaultFeedbackTelemetry;
}

interface FeedbackMetricsDbRow {
  total?: number | string;
  count_new?: number | string;
  count_reviewed?: number | string;
  count_actioned?: number | string;
  count_dismissed?: number | string;
  avg_rating?: number | string | null;
  rated_count?: number | string;
}

export function createOperatorRouter(options?: OperatorRouterOptions): Router {
  const router = express.Router();
  const authenticate = options?.authenticate ?? defaultAuthenticateOperator;
  const getStatsFn = options?.getStatsFn ?? defaultGetStats;
  const redisMetrics = options?.redisMetrics ?? defaultRedisMetrics;
  const metricsRedisClient = options?.metricsRedisClient ?? defaultMetricsRedis;
  const db = options?.postgres !== undefined ? options.postgres : defaultPostgres;
  const telemetry = options?.telemetry ?? defaultFeedbackTelemetry;

  // ============================================================================
  // OPERATIONAL STATS & METRICS
  // ============================================================================

  router.get("/stats", async (req: Request, res: Response) => {
    const auth = await authenticate(req);
    if (!auth.authorized) {
      res.status(403).json({ error: "Access Denied" });
      return;
    }
    const stats = await getStatsFn();
    res.json(stats);
  });

  router.get("/stats/redis", async (req: Request, res: Response) => {
    const auth = await authenticate(req);
    if (!auth.authorized) {
      res.status(403).json({ error: "Access Denied" });
      return;
    }
    res.json(redisMetrics.getSnapshot());
  });

  router.get("/timeSeries", async (req: Request, res: Response) => {
    const auth = await authenticate(req);
    if (!auth.authorized || !metricsRedisClient?.client) {
      res.status(403).json({ error: "Access Denied" });
      return;
    }
    const timeSeriesData = await metricsRedisClient.execute("analytics", "lrange", (c) => c.lrange("timeSeries", 0, -1));
    const timeSeries = timeSeriesData?.map((entry: string) => JSON.parse(entry)) || [];
    res.json(timeSeries);
  });

  // ============================================================================
  // ADMIN FEEDBACK OPERATIONS (FEEDBACK-003)
  // ============================================================================

  // 1. Operational List Query (Paginated, Filtered, Operator-Only)
  router.get("/api/admin/feedback", async (req: Request, res: Response) => {
    try {
      const auth = await authenticate(req);
      if (!auth.authorized) {
        res.status(403).json({ error: "Unauthorized operator access" });
        return;
      }

      if (!db || typeof db.query !== "function") {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const rawPage = Number(req.query.page) || 1;
      const rawLimit = Number(req.query.limit) || 20;

      const page = Math.max(1, Number.isInteger(rawPage) ? rawPage : 1);
      const limit = Math.min(50, Math.max(1, Number.isInteger(rawLimit) ? rawLimit : 20));
      const offset = (page - 1) * limit;

      const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
      const rawType = typeof req.query.type === "string" ? req.query.type : undefined;
      const rawContext = typeof req.query.context === "string" ? req.query.context : undefined;
      const rawRating = req.query.rating ? Number(req.query.rating) : null;

      const allowedStatuses = ["new", "reviewed", "actioned", "dismissed"];
      const allowedTypes = ["bug", "suggestion", "problem", "experience"];
      const allowedContexts = ["room", "playback", "host", "participants", "chat", "video", "connection"];

      if (rawStatus && !allowedStatuses.includes(rawStatus)) {
        res.status(400).json({ error: "Invalid status filter" });
        return;
      }
      if (rawType && !allowedTypes.includes(rawType)) {
        res.status(400).json({ error: "Invalid type filter" });
        return;
      }
      if (rawContext && !allowedContexts.includes(rawContext)) {
        res.status(400).json({ error: "Invalid context filter" });
        return;
      }
      if (rawRating !== null && (!Number.isInteger(rawRating) || rawRating < 1 || rawRating > 5)) {
        res.status(400).json({ error: "Invalid rating filter" });
        return;
      }

      const filterStatus = rawStatus || null;
      const filterType = rawType || null;
      const filterContext = rawContext || null;
      const filterRating = rawRating;

      // Total Count
      const countResult = await db.query(
        `SELECT COUNT(*)::int as total
         FROM public.feedback
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR context = $3)
           AND ($4::int IS NULL OR rating = $4)`,
        [filterStatus, filterType, filterContext, filterRating]
      );
      const total = Number(countResult.rows[0]?.total) || 0;
      const totalPages = Math.ceil(total / limit);

      // Items
      const itemsResult = await db.query(
        `SELECT id, user_id, type, rating, message, context, app_version, platform, status,
                reviewer_id, review_notes, reviewed_at, created_at, updated_at
         FROM public.feedback
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR context = $3)
           AND ($4::int IS NULL OR rating = $4)
         ORDER BY created_at DESC
         LIMIT $5 OFFSET $6`,
        [filterStatus, filterType, filterContext, filterRating, limit, offset]
      );

      res.json({
        items: itemsResult.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      });
    } catch (e: unknown) {
      console.error("Admin feedback list error:", e);
      res.status(500).json({ error: "Failed to retrieve feedback list" });
    }
  });

  // 2. Concurrency-Safe Review Transition Endpoint
  router.patch("/api/admin/feedback/:id/status", async (req: Request, res: Response) => {
    try {
      const auth = await authenticate(req);
      if (!auth.authorized) {
        res.status(403).json({ error: "Unauthorized operator access" });
        return;
      }

      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const { id } = req.params;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!id || !uuidRegex.test(id)) {
        res.status(400).json({ error: "Invalid feedback ID format" });
        return;
      }

      const { status: targetStatus, review_notes: rawNotes, expected_status: expectedStatus } = req.body || {};
      const allowedStatuses = ["new", "reviewed", "actioned", "dismissed"];
      if (!targetStatus || !allowedStatuses.includes(targetStatus)) {
        res.status(400).json({ error: "Invalid target status" });
        return;
      }

      if (!db || typeof db.query !== "function") {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      // Retrieve current record state
      const currentResult = await db.query(
        `SELECT id, status FROM public.feedback WHERE id = $1`,
        [id]
      );
      if (currentResult.rows.length === 0) {
        res.status(404).json({ error: "Feedback record not found" });
        return;
      }

      const currentStatus = currentResult.rows[0].status;

      // Check optimistic lock if expected_status specified
      if (expectedStatus && expectedStatus !== currentStatus) {
        telemetry.recordReviewUpdate(true);
        res.status(409).json({
          error: "Feedback status conflict",
          currentStatus,
          expectedStatus,
        });
        return;
      }

      // Valid State Transitions Map:
      // new -> reviewed, dismissed
      // reviewed -> actioned, dismissed, new
      // actioned -> reviewed, dismissed
      // dismissed -> reviewed
      const allowedTransitions: Record<string, string[]> = {
        new: ["reviewed", "dismissed"],
        reviewed: ["actioned", "dismissed", "new"],
        actioned: ["reviewed", "dismissed"],
        dismissed: ["reviewed"],
      };

      if (currentStatus === targetStatus) {
        res.status(400).json({ error: `Record is already in '${targetStatus}' status` });
        return;
      }

      const validNextStates = allowedTransitions[currentStatus] || [];
      if (!validNextStates.includes(targetStatus)) {
        res.status(400).json({
          error: `Invalid status transition from '${currentStatus}' to '${targetStatus}'`,
          allowedTransitions: validNextStates,
        });
        return;
      }

      const reviewNotes = typeof rawNotes === "string" ? rawNotes.trim().slice(0, 1000) : null;
      const reviewerId = auth.operatorId && uuidRegex.test(auth.operatorId) ? auth.operatorId : null;

      // Atomic conditional update
      const updateResult = await db.query(
        `UPDATE public.feedback
         SET status = $1,
             reviewer_id = $2,
             review_notes = $3,
             reviewed_at = now(),
             updated_at = now()
         WHERE id = $4 AND status = $5
         RETURNING id, user_id, type, rating, message, context, status, reviewer_id, review_notes, reviewed_at, updated_at`,
        [targetStatus, reviewerId, reviewNotes, id, currentStatus]
      );

      if (updateResult.rows.length === 0) {
        telemetry.recordReviewUpdate(true);
        res.status(409).json({ error: "Concurrent update conflict. Please refresh and retry." });
        return;
      }

      telemetry.recordReviewUpdate(false);

      res.json({
        success: true,
        feedback: updateResult.rows[0],
      });
    } catch (e: unknown) {
      console.error("Admin feedback status update error:", e);
      res.status(500).json({ error: "Failed to update feedback status" });
    }
  });

  // 3. Operational Product Signals & Metrics Aggregation Endpoint
  router.get("/api/admin/feedback/metrics", async (req: Request, res: Response) => {
    try {
      const auth = await authenticate(req);
      if (!auth.authorized) {
        res.status(403).json({ error: "Unauthorized operator access" });
        return;
      }

      if (!db || typeof db.query !== "function") {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const metricsResult = await db.query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN status = 'new' THEN 1 END)::int as count_new,
          COUNT(CASE WHEN status = 'reviewed' THEN 1 END)::int as count_reviewed,
          COUNT(CASE WHEN status = 'actioned' THEN 1 END)::int as count_actioned,
          COUNT(CASE WHEN status = 'dismissed' THEN 1 END)::int as count_dismissed,
          ROUND(AVG(rating)::numeric, 2) as avg_rating,
          COUNT(CASE WHEN rating IS NOT NULL THEN 1 END)::int as rated_count
        FROM public.feedback
      `);

      const typeResult = await db.query(`
        SELECT type, COUNT(*)::int as count
        FROM public.feedback
        GROUP BY type
        ORDER BY count DESC
      `);

      const contextResult = await db.query(`
        SELECT context, COUNT(*)::int as count
        FROM public.feedback
        GROUP BY context
        ORDER BY count DESC
      `);

      const ratingResult = await db.query(`
        SELECT rating, COUNT(*)::int as count
        FROM public.feedback
        WHERE rating IS NOT NULL
        GROUP BY rating
        ORDER BY rating ASC
      `);

      const base = (metricsResult.rows[0] as FeedbackMetricsDbRow | undefined) || {};
      const byType: Record<string, number> = {};
      for (const r of typeResult.rows) byType[r.type] = Number(r.count);

      const byContext: Record<string, number> = {};
      for (const r of contextResult.rows) byContext[r.context] = Number(r.count);

      const byRating: Record<number, number> = {};
      for (const r of ratingResult.rows) byRating[Number(r.rating)] = Number(r.count);

      res.json({
        summary: {
          total: Number(base.total) || 0,
          countNew: Number(base.count_new) || 0,
          countReviewed: Number(base.count_reviewed) || 0,
          countActioned: Number(base.count_actioned) || 0,
          countDismissed: Number(base.count_dismissed) || 0,
          avgRating: base.avg_rating ? parseFloat(String(base.avg_rating)) : null,
          ratedCount: Number(base.rated_count) || 0,
        },
        breakdowns: {
          byType,
          byContext,
          byRating,
        },
        telemetry: telemetry.getMetrics(),
      });
    } catch (e: unknown) {
      console.error("Admin feedback metrics error:", e);
      res.status(500).json({ error: "Failed to calculate feedback metrics" });
    }
  });

  return router;
}
