import { strict as assert } from "node:assert";
import express from "express";
import http from "node:http";
import { createOperatorRouter } from "./operatorRouter.ts";

async function runOperatorRouterTests() {
  console.log("================================================================");
  console.log("STARTING OPERATOR ROUTER MODULAR EXTRACTION TEST SUITE");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(desc: string, condition: boolean) {
    if (condition) {
      console.log(`  PASS [${desc}]`);
      passed++;
    } else {
      console.error(`  FAIL [${desc}]`);
      failed++;
    }
  }

  // --- Mock State ---
  let isOperatorAuthorized = true;
  let mockOperatorId: string | null = "00000000-0000-0000-0000-000000000001";

  const mockAuthenticate = async () => ({
    authorized: isOperatorAuthorized,
    operatorId: mockOperatorId,
  });

  const mockStatsData = {
    roomCount: 42,
    userCount: 100,
    videoCount: 15,
  };
  const mockGetStats = async () => mockStatsData;

  const mockRedisSnapshot = {
    connected: true,
    totalCommands: 1234,
  };
  const mockRedisMetrics = {
    getSnapshot: () => mockRedisSnapshot,
  };

  let redisConnected = true;
  const timeSeriesStore = [
    JSON.stringify({ timestamp: 1000, value: 10 }),
    JSON.stringify({ timestamp: 2000, value: 20 }),
  ];
  const mockMetricsRedis = {
    get client() {
      return redisConnected ? ({} as unknown) : null;
    },
    execute: async (_op: string, _cmd: string, fn: (c: unknown) => Promise<unknown>) => {
      const mockClient = {
        lrange: async (_key: string, _start: number, _stop: number) => timeSeriesStore,
      };
      return fn(mockClient);
    },
  };

  interface FeedbackRow {
    id: string;
    user_id: string | null;
    type: string;
    rating: number | null;
    message: string;
    context: string;
    app_version: string;
    platform: string;
    status: string;
    reviewer_id: string | null;
    review_notes: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
  }

  const feedbackDb: FeedbackRow[] = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "user-1",
      type: "bug",
      rating: 4,
      message: "Audio delay",
      context: "playback",
      app_version: "1.0.0",
      platform: "web",
      status: "new",
      reviewer_id: null,
      review_notes: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      user_id: "user-2",
      type: "suggestion",
      rating: 5,
      message: "Add dark mode toggle",
      context: "room",
      app_version: "1.0.0",
      platform: "web",
      status: "reviewed",
      reviewer_id: "00000000-0000-0000-0000-000000000001",
      review_notes: "Accepted",
      reviewed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  let dbAvailable = true;
  const mockPostgres = {
    query: async (queryText: string, values?: unknown[]) => {
      const qNorm = queryText.replace(/\s+/g, " ").trim();
      const vals = values || [];

      // Total count query
      if (qNorm.includes("SELECT COUNT(*)::int as total FROM public.feedback")) {
        let matching = feedbackDb;
        const [filterStatus, filterType, filterContext, filterRating] = vals;
        if (filterStatus) matching = matching.filter((r) => r.status === filterStatus);
        if (filterType) matching = matching.filter((r) => r.type === filterType);
        if (filterContext) matching = matching.filter((r) => r.context === filterContext);
        if (filterRating !== null && filterRating !== undefined) matching = matching.filter((r) => r.rating === filterRating);
        return { rows: [{ total: matching.length }] };
      }

      // Items list query
      if (qNorm.includes("SELECT id, user_id, type, rating, message, context, app_version, platform, status")) {
        let matching = [...feedbackDb];
        const [filterStatus, filterType, filterContext, filterRating, limit, offset] = vals;
        if (filterStatus) matching = matching.filter((r) => r.status === filterStatus);
        if (filterType) matching = matching.filter((r) => r.type === filterType);
        if (filterContext) matching = matching.filter((r) => r.context === filterContext);
        if (filterRating !== null && filterRating !== undefined) matching = matching.filter((r) => r.rating === filterRating);
        const l = typeof limit === "number" ? limit : 20;
        const o = typeof offset === "number" ? offset : 0;
        return { rows: matching.slice(o, o + l) };
      }

      // Single item status query
      if (qNorm.includes("SELECT id, status FROM public.feedback WHERE id = $1")) {
        const id = vals[0] as string;
        const row = feedbackDb.find((r) => r.id === id);
        return { rows: row ? [{ id: row.id, status: row.status }] : [] };
      }

      // Update query
      if (qNorm.includes("UPDATE public.feedback")) {
        const [targetStatus, reviewerId, reviewNotes, id, currentStatus] = vals;
        const index = feedbackDb.findIndex((r) => r.id === id && r.status === currentStatus);
        if (index === -1) {
          return { rows: [] };
        }
        const updated = {
          ...feedbackDb[index],
          status: targetStatus as string,
          reviewer_id: reviewerId as string | null,
          review_notes: reviewNotes as string | null,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        feedbackDb[index] = updated;
        return { rows: [updated] };
      }

      // Metrics query
      if (qNorm.includes("COUNT(CASE WHEN status = 'new' THEN 1 END)::int as count_new")) {
        const total = feedbackDb.length;
        const countNew = feedbackDb.filter((r) => r.status === "new").length;
        const countReviewed = feedbackDb.filter((r) => r.status === "reviewed").length;
        const countActioned = feedbackDb.filter((r) => r.status === "actioned").length;
        const countDismissed = feedbackDb.filter((r) => r.status === "dismissed").length;
        const rated = feedbackDb.filter((r) => r.rating !== null);
        const avg = rated.length ? (rated.reduce((sum, r) => sum + (r.rating || 0), 0) / rated.length).toFixed(2) : null;
        return {
          rows: [
            {
              total,
              count_new: countNew,
              count_reviewed: countReviewed,
              count_actioned: countActioned,
              count_dismissed: countDismissed,
              avg_rating: avg,
              rated_count: rated.length,
            },
          ],
        };
      }

      if (qNorm.includes("SELECT type, COUNT(*)::int as count FROM public.feedback GROUP BY type")) {
        const map = new Map<string, number>();
        feedbackDb.forEach((r) => map.set(r.type, (map.get(r.type) || 0) + 1));
        return { rows: [...map.entries()].map(([type, count]) => ({ type, count })) };
      }

      if (qNorm.includes("SELECT context, COUNT(*)::int as count FROM public.feedback GROUP BY context")) {
        const map = new Map<string, number>();
        feedbackDb.forEach((r) => map.set(r.context, (map.get(r.context) || 0) + 1));
        return { rows: [...map.entries()].map(([context, count]) => ({ context, count })) };
      }

      if (qNorm.includes("SELECT rating, COUNT(*)::int as count FROM public.feedback WHERE rating IS NOT NULL GROUP BY rating")) {
        const map = new Map<number, number>();
        feedbackDb.forEach((r) => {
          if (r.rating !== null) map.set(r.rating, (map.get(r.rating) || 0) + 1);
        });
        return { rows: [...map.entries()].map(([rating, count]) => ({ rating, count })) };
      }

      return { rows: [] };
    },
  };

  const telemetryUpdates: boolean[] = [];
  const mockTelemetry = {
    recordReviewUpdate: (conflict: boolean) => {
      telemetryUpdates.push(conflict);
    },
    getMetrics: () => ({
      reviewUpdates: telemetryUpdates.length,
      conflicts: telemetryUpdates.filter(Boolean).length,
    }),
  };

  const app = express();
  app.use(express.json());
  app.use(
    createOperatorRouter({
      authenticate: mockAuthenticate as any,
      getStatsFn: mockGetStats as any,
      redisMetrics: mockRedisMetrics as any,
      metricsRedisClient: mockMetricsRedis as any,
      postgres: {
        get query() {
          return dbAvailable ? mockPostgres.query : undefined;
        },
      } as any,
      telemetry: mockTelemetry as any,
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(path: string, options: { method?: string; body?: any } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // not json
    }
    return { status: res.status, json };
  }

  try {
    // -------------------------------------------------------------
    // Test Group 1: /stats
    // -------------------------------------------------------------
    {
      const resOk = await request("/stats");
      test("GET /stats returns 200 and stats payload when authorized", resOk.status === 200 && resOk.json.roomCount === 42);

      isOperatorAuthorized = false;
      const resForbidden = await request("/stats");
      test("GET /stats returns 403 when operator unauthorized", resForbidden.status === 403 && resForbidden.json.error === "Access Denied");
      isOperatorAuthorized = true;
    }

    // -------------------------------------------------------------
    // Test Group 2: /stats/redis
    // -------------------------------------------------------------
    {
      const resOk = await request("/stats/redis");
      test("GET /stats/redis returns 200 and redis snapshot when authorized", resOk.status === 200 && resOk.json.totalCommands === 1234);

      isOperatorAuthorized = false;
      const resForbidden = await request("/stats/redis");
      test("GET /stats/redis returns 403 when unauthorized", resForbidden.status === 403 && resForbidden.json.error === "Access Denied");
      isOperatorAuthorized = true;
    }

    // -------------------------------------------------------------
    // Test Group 3: /timeSeries
    // -------------------------------------------------------------
    {
      const resOk = await request("/timeSeries");
      test("GET /timeSeries returns 200 and parsed timeSeries array", resOk.status === 200 && Array.isArray(resOk.json) && resOk.json.length === 2 && resOk.json[0].value === 10);

      redisConnected = false;
      const resNoRedis = await request("/timeSeries");
      test("GET /timeSeries returns 403 if metrics redis client disconnected", resNoRedis.status === 403);
      redisConnected = true;

      isOperatorAuthorized = false;
      const resForbidden = await request("/timeSeries");
      test("GET /timeSeries returns 403 when unauthorized", resForbidden.status === 403);
      isOperatorAuthorized = true;
    }

    // -------------------------------------------------------------
    // Test Group 4: GET /api/admin/feedback
    // -------------------------------------------------------------
    {
      const resOk = await request("/api/admin/feedback");
      test("GET /api/admin/feedback returns 200 with items and pagination", resOk.status === 200 && Array.isArray(resOk.json.items) && resOk.json.pagination.total === 2);

      const resFiltered = await request("/api/admin/feedback?type=bug&status=new");
      test("GET /api/admin/feedback applies filters", resFiltered.status === 200 && resFiltered.json.items.length === 1 && resFiltered.json.items[0].type === "bug");

      const resBadStatus = await request("/api/admin/feedback?status=invalid_status");
      test("GET /api/admin/feedback rejects invalid status with 400", resBadStatus.status === 400 && resBadStatus.json.error === "Invalid status filter");

      const resBadRating = await request("/api/admin/feedback?rating=10");
      test("GET /api/admin/feedback rejects invalid rating with 400", resBadRating.status === 400 && resBadRating.json.error === "Invalid rating filter");

      dbAvailable = false;
      const resDbDown = await request("/api/admin/feedback");
      test("GET /api/admin/feedback returns 503 when db unavailable", resDbDown.status === 503 && resDbDown.json.error === "Database unavailable");
      dbAvailable = true;

      isOperatorAuthorized = false;
      const resForbidden = await request("/api/admin/feedback");
      test("GET /api/admin/feedback returns 403 when unauthorized", resForbidden.status === 403);
      isOperatorAuthorized = true;
    }

    // -------------------------------------------------------------
    // Test Group 5: PATCH /api/admin/feedback/:id/status
    // -------------------------------------------------------------
    {
      const validId = "11111111-1111-1111-1111-111111111111";

      const resInvalidUuid = await request("/api/admin/feedback/not-a-uuid/status", {
        method: "PATCH",
        body: { status: "reviewed" },
      });
      test("PATCH status rejects non-UUID with 400", resInvalidUuid.status === 400 && resInvalidUuid.json.error === "Invalid feedback ID format");

      const resInvalidStatus = await request(`/api/admin/feedback/${validId}/status`, {
        method: "PATCH",
        body: { status: "deleted" },
      });
      test("PATCH status rejects invalid status value with 400", resInvalidStatus.status === 400 && resInvalidStatus.json.error === "Invalid target status");

      const resOptimisticMismatch = await request(`/api/admin/feedback/${validId}/status`, {
        method: "PATCH",
        body: { status: "reviewed", expected_status: "dismissed" },
      });
      test("PATCH status detects optimistic concurrency mismatch with 409", resOptimisticMismatch.status === 409 && resOptimisticMismatch.json.error === "Feedback status conflict");

      const resIllegalTransition = await request(`/api/admin/feedback/${validId}/status`, {
        method: "PATCH",
        body: { status: "actioned" }, // "new" -> "actioned" is not allowed (only "reviewed" or "dismissed")
      });
      test("PATCH status rejects illegal transition with 400", resIllegalTransition.status === 400 && resIllegalTransition.json.error.includes("Invalid status transition"));

      const resSuccess = await request(`/api/admin/feedback/${validId}/status`, {
        method: "PATCH",
        body: { status: "reviewed", review_notes: "Checked and verified" },
      });
      test("PATCH status accepts valid transition and returns updated feedback", resSuccess.status === 200 && resSuccess.json.success === true && resSuccess.json.feedback.status === "reviewed");

      const resSameState = await request(`/api/admin/feedback/${validId}/status`, {
        method: "PATCH",
        body: { status: "reviewed" },
      });
      test("PATCH status rejects transition to identical status with 400", resSameState.status === 400 && resSameState.json.error.includes("already in 'reviewed' status"));
    }

    // -------------------------------------------------------------
    // Test Group 6: GET /api/admin/feedback/metrics
    // -------------------------------------------------------------
    {
      const resMetrics = await request("/api/admin/feedback/metrics");
      test("GET /api/admin/feedback/metrics returns 200 with summary breakdowns and telemetry", resMetrics.status === 200 && resMetrics.json.summary.total === 2 && resMetrics.json.breakdowns.byType.bug === 1 && typeof resMetrics.json.telemetry === "object");

      isOperatorAuthorized = false;
      const resForbidden = await request("/api/admin/feedback/metrics");
      test("GET /api/admin/feedback/metrics returns 403 when unauthorized", resForbidden.status === 403);
      isOperatorAuthorized = true;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n================================================================");
  console.log(`OPERATOR ROUTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runOperatorRouterTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test runner fatal error:", err);
  process.exit(1);
});
