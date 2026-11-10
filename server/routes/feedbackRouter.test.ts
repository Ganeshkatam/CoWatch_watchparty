import { strict as assert } from "node:assert";
import express from "express";
import http from "node:http";
import { createFeedbackRouter } from "./feedbackRouter.ts";
import { resetFallbackBuckets } from "../utils/durableRateLimit.ts";
import { _resetAbuseReportRateLimits } from "../utils/abuseReportRateLimit.ts";
import { resetFeedbackRateLimitsForTesting } from "../utils/feedbackRateLimit.ts";

async function runFeedbackRouterTests() {
  console.log("================================================================");
  console.log("STARTING FEEDBACK ROUTER MODULAR EXTRACTION TEST SUITE");
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

  // Section 1: In-memory mock database & auth client
  const feedbackStore: Array<{
    id: string;
    user_id: string | null;
    type: string;
    rating: number | null;
    message: string;
    context: string;
    app_version: string;
    platform: string;
    status: string;
    idempotency_key: string | null;
    created_at: string;
  }> = [];

  let abuseRateLimitCalls = 0;

  const abuseReportStore: Array<{
    id: string;
    reporter_user_id: string;
    target_user_id: string | null;
    target_room_id: string | null;
    category: string;
    reason: string;
    context: string;
    status: string;
    created_at: string;
  }> = [];

  const mockPostgres = {
    query: async (queryText: string, values?: unknown[]) => {
      const q = queryText.trim();
      const vals = values || [];

      // Idempotency check query for feedback
      if (q.includes("SELECT id, created_at FROM public.feedback WHERE idempotency_key = $1")) {
        const key = vals[0] as string;
        const found = feedbackStore.find((f) => f.idempotency_key === key);
        return {
          rows: found ? [{ id: found.id, created_at: found.created_at }] : [],
        };
      }

      // Insert feedback query
      if (q.includes("INSERT INTO public.feedback")) {
        const [user_id, type, rating, message, context, app_version, platform, idempotency_key] = vals as [
          string | null,
          string,
          number | null,
          string,
          string,
          string,
          string,
          string | null
        ];

        // ON CONFLICT DO NOTHING simulation
        if (idempotency_key) {
          const conflict = feedbackStore.find((f) => f.idempotency_key === idempotency_key);
          if (conflict) {
            return { rows: [] };
          }
        }

        const newRecord = {
          id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          user_id,
          type,
          rating,
          message,
          context,
          app_version,
          platform,
          status: "new",
          idempotency_key,
          created_at: new Date().toISOString(),
        };
        feedbackStore.push(newRecord);
        return { rows: [{ id: newRecord.id, created_at: newRecord.created_at }] };
      }

      // Insert abuse report query
      if (q.includes("INSERT INTO public.abuse_reports")) {
        const [reporter_user_id, target_user_id, target_room_id, category, reason, context] = vals as [
          string,
          string | null,
          string | null,
          string,
          string,
          string
        ];
        const newRecord = {
          id: `abuse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          reporter_user_id,
          target_user_id,
          target_room_id,
          category,
          reason,
          context,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        abuseReportStore.push(newRecord);
        return { rows: [{ id: newRecord.id, created_at: newRecord.created_at }] };
      }

      return { rows: [] };
    },
  };

  let reporterIndex = 0;
  const nextReporter = () => {
    reporterIndex++;
    const id = `rep-${Date.now().toString(36)}-${reporterIndex}`;
    const token = `token-${id}`;
    const ip = `198.51.100.${reporterIndex}`;
    return { id, token, ip };
  };

  const mockSupabaseAdmin = {
    auth: {
      getUser: async (token: string) => {
        if (token === "valid-user-token") {
          return { data: { user: { id: "user-12345" } }, error: null };
        }
        if (token.startsWith("token-rep-")) {
          const id = token.replace("token-", "");
          return { data: { user: { id } }, error: null };
        }
        return { data: { user: null }, error: { message: "Invalid token" } };
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createFeedbackRouter({
      postgres: mockPostgres as any,
      supabaseAdmin: mockSupabaseAdmin as any,
      checkAbuseReportRateLimit: async () => {
        abuseRateLimitCalls++;
        return { allowed: true, retryAfterSeconds: 0 };
      },
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  resetFallbackBuckets();
  _resetAbuseReportRateLimits();
  resetFeedbackRateLimitsForTesting();

  try {
    // --- Test 1: Abuse Reports Auth Guard ---
    {
      const res = await fetch(`${baseUrl}/api/reports/abuse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "harassment", reason: "Spamming the chat", targetUserId: "target-user-1" }),
      });
      test("Abuse report without Authorization header returns 401", res.status === 401);
    }

    {
      const res = await fetch(`${baseUrl}/api/reports/abuse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify({ category: "harassment", reason: "Spamming the chat", targetUserId: "target-user-1" }),
      });
      test("Abuse report with invalid token returns 401", res.status === 401);
    }

    // --- Test 2: Abuse Reports Validation Guards ---
    {
      const rep = nextReporter();
      const res = await fetch(`${baseUrl}/api/reports/abuse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": rep.ip,
          Authorization: `Bearer ${rep.token}`,
        },
        body: JSON.stringify({
          category: "harassment",
          reason: "Spamming the chat",
          targetUserId: "target-user-1",
          injectedField: "malicious",
        }),
      });
      test("Abuse report with forbidden fields returns 400", res.status === 400);
    }

    {
      const rep = nextReporter();
      const res = await fetch(`${baseUrl}/api/reports/abuse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": rep.ip,
          Authorization: `Bearer ${rep.token}`,
        },
        body: JSON.stringify({
          category: "harassment",
          reason: "Spamming the chat",
          targetUserId: rep.id, // Self-reporting
        }),
      });
      test("Abuse report self-reporting returns 400", res.status === 400);
    }

    {
      const rep = nextReporter();
      const res = await fetch(`${baseUrl}/api/reports/abuse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": rep.ip,
          Authorization: `Bearer ${rep.token}`,
        },
        body: JSON.stringify({
          category: "harassment",
          reason: "hi", // Too short (< 5 chars)
          targetUserId: "target-user-1",
        }),
      });
      test("Abuse report with reason < 5 chars returns 400", res.status === 400);
    }

    test("Invalid abuse-report payloads do not consume rate-limit tokens", abuseRateLimitCalls === 0);

    // --- Test 3: Abuse Reports Valid Submission ---
    {
      const rep = nextReporter();
      const res = await fetch(`${baseUrl}/api/reports/abuse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": rep.ip,
          Authorization: `Bearer ${rep.token}`,
        },
        body: JSON.stringify({
          category: "harassment",
          reason: "Offensive language in room chat repeatedly",
          targetUserId: "target-user-222",
          targetRoomId: "room-abc-123",
          context: { source: "video_chat" },
        }),
      });
      const data = await res.json() as any;
      test(
        "Abuse report valid submission returns 201 with reportId",
        res.status === 201 && data.success === true && typeof data.reportId === "string"
      );
      test("Valid abuse report consumes exactly one rate-limit check", abuseRateLimitCalls === 1);
    }

    // --- Test 4: Feedback Validation Guards ---
    {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "invalid-type", message: "A test message here" }),
      });
      test("Feedback with invalid type returns 400", res.status === 400);
    }

    {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bug", message: "" }),
      });
      test("Feedback with empty message returns 400", res.status === 400);
    }

    {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bug", message: "A test message", rating: 6 }),
      });
      test("Feedback with out-of-bounds rating returns 400", res.status === 400);
    }

    // --- Test 5: Feedback Valid Submission ---
    let firstCreatedAt = "";
    {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-user-token",
        },
        body: JSON.stringify({
          type: "suggestion",
          context: "playback",
          rating: 5,
          message: "Would love keyboard shortcuts for playback volume! Contact at redis://secret:pass@localhost:6379",
          app_version: "1.2.2",
          platform: "web",
          idempotency_key: "idem-key-9999",
        }),
      });
      const data = await res.json() as any;
      firstCreatedAt = data.created_at;
      test(
        "Feedback valid submission returns 200 with id and created_at",
        res.status === 200 && data.success === true && typeof data.id === "string"
      );

      // Verify privacy redaction in database
      const saved = feedbackStore.find((f) => f.idempotency_key === "idem-key-9999");
      test(
        "Sensitive redis URI redacted in persisted feedback message",
        Boolean(saved && saved.message.includes("[URI_REDACTED]") && !saved.message.includes("secret:pass"))
      );
    }

    // --- Test 6: Feedback Idempotency / Deduplication ---
    {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-user-token",
        },
        body: JSON.stringify({
          type: "suggestion",
          context: "playback",
          rating: 5,
          message: "Would love keyboard shortcuts for playback volume!",
          app_version: "1.2.2",
          platform: "web",
          idempotency_key: "idem-key-9999",
        }),
      });
      const data = await res.json() as any;
      test(
        "Duplicate idempotency_key returns 200 with deduped: true",
        res.status === 200 && data.success === true && data.deduped === true && data.created_at === firstCreatedAt
      );
    }

    // --- Test 7: Direct non-prefixed paths (/reports/abuse, /feedback) ---
    {
      const res = await fetch(`${baseUrl}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "problem",
          message: "Direct non-prefixed path test message",
        }),
      });
      const data = await res.json() as any;
      test(
        "Non-prefixed /feedback path is reachable and functional",
        res.status === 200 && data.success === true
      );
    }
  } finally {
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(`FEEDBACK ROUTER SUITE COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log(`================================================================`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runFeedbackRouterTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
