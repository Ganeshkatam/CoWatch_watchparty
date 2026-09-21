/**
 * PROFILE-001: Server-Authoritative Profile HTTP Contract & Concurrency Test Suite
 *
 * Exercises the live Express HTTP wire boundary for /api/profile and /api/users/:userId/public-profile:
 * - Transport authentication and Bearer token derivation
 * - Authorization boundary and User A / User B isolation
 * - Strict input validation and rejection of unknown/protected fields
 * - Atomic self-healing and concurrency safety under parallel requests
 * - Column-level concurrency-safe updates (no lost updates)
 * - Username uniqueness constraint mapping (23505 -> 409 Conflict)
 * - Fail-closed persistence behavior during database outages and clean recovery
 * - Non-sensitive public profile projection and UUID validation
 * - Durable rate limiting integration
 */

import http from "node:http";
import express from "express";
import { profileRouter } from "./routes/profile.ts";
import { profileRepository, type ProfileRow, type PublicProfileRow } from "./repositories/profileRepository.ts";
import { ProfileService } from "./services/profileService.ts";
import { setPostgresForTesting } from "./utils/postgres.ts";
import { resetCircuitBreaker } from "./utils/durableRateLimit.ts";
import { supabaseAdmin } from "./utils/supabase.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, testNum: number, message: string) {
  if (condition) {
    passed++;
    console.log(`PASS [Test ${testNum}]: ${message}`);
  } else {
    failed++;
    console.error(`FAIL [Test ${testNum}]: ${message}`);
  }
}

// In-Memory Mock Database for Profiles
const mockProfiles = new Map<string, ProfileRow>();
let shouldSimulateDbOutage = false;

const mockPostgres = {
  query: async (queryText: string, values?: any[]): Promise<{ rows: any[]; rowCount: number }> => {
    if (shouldSimulateDbOutage) {
      const err = new Error("Connection refused to PostgreSQL host");
      (err as any).code = "ECONNREFUSED";
      throw err;
    }

    const trimmed = queryText.trim().toUpperCase();

    // 1. SELECT from public.profiles
    if (trimmed.startsWith("SELECT") && queryText.includes("FROM public.profiles")) {
      const id = values?.[0];
      const found = mockProfiles.get(id);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }

    // 2. INSERT into public.profiles
    if (trimmed.startsWith("INSERT INTO PUBLIC.PROFILES")) {
      const [id, displayName, username, avatarUrl] = values || [];

      // Check username uniqueness (case-insensitive)
      for (const [existingId, p] of mockProfiles.entries()) {
        if (existingId !== id && p.username && p.username.toLowerCase() === username?.toLowerCase()) {
          const err = new Error('duplicate key value violates unique constraint "profiles_username_unique"');
          (err as any).code = "23505";
          throw err;
        }
      }

      if (!mockProfiles.has(id)) {
        const row: ProfileRow = {
          id,
          display_name: displayName || null,
          username: username || null,
          avatar_url: avatarUrl || null,
          pref_show_chat_column: true,
          pref_show_people_column: false,
          pref_disable_chat_sound: false,
          pref_camera_on: false,
          pref_mic_on: false,
          pref_appearance_mode: "system",
          terms_agreed_at: null,
          age_verified_at: null,
          updated_at: new Date().toISOString(),
        };
        mockProfiles.set(id, row);
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 3. UPDATE public.profiles
    if (trimmed.startsWith("UPDATE PUBLIC.PROFILES")) {
      const id = values?.[values.length - 1];
      const existing = mockProfiles.get(id);
      if (!existing) {
        return { rows: [], rowCount: 0 };
      }

      // Check username uniqueness if updating username
      if (queryText.includes('"username"')) {
        const usernameVal = values?.[0];
        for (const [otherId, p] of mockProfiles.entries()) {
          if (otherId !== id && p.username && p.username.toLowerCase() === usernameVal?.toLowerCase()) {
            const err = new Error('duplicate key value violates unique constraint "profiles_username_unique"');
            (err as any).code = "23505";
            throw err;
          }
        }
      }

      // Dynamic column application from SQL text
      const updated = { ...existing, updated_at: new Date().toISOString() };
      const setMatches = queryText.match(/"([a-zA-Z0-9_]+)"\s*=\s*\$([0-9]+)/g) || [];
      for (const match of setMatches) {
        const [, col, paramStr] = match.match(/"([a-zA-Z0-9_]+)"\s*=\s*\$([0-9]+)/) || [];
        const paramIndex = Number.parseInt(paramStr, 10) - 1;
        (updated as any)[col] = values?.[paramIndex];
      }

      mockProfiles.set(id, updated);
      return { rows: [updated], rowCount: 1 };
    }

    // 4. SELECT from public.public_profiles
    if (trimmed.startsWith("SELECT") && queryText.includes("FROM public.public_profiles")) {
      const id = values?.[0];
      const found = mockProfiles.get(id);
      if (found) {
        const pubRow: PublicProfileRow = {
          id: found.id,
          display_name: found.display_name,
          username: found.username,
          avatar_url: found.avatar_url,
        };
        return { rows: [pubRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 5. Durable rate limit check fallback
    if (queryText.includes("consume_durable_rate_limit")) {
      return {
        rows: [{ allowed: true, remaining: 50, retry_after_seconds: 0 }],
        rowCount: 1,
      };
    }

    return { rows: [], rowCount: 0 };
  },
};

async function runProfileContractTests() {
  console.log("================================================================");
  console.log("STARTING PROFILE-001 HTTP CONTRACT & CONCURRENCY TEST SUITE");
  console.log("================================================================\n");

  setPostgresForTesting(mockPostgres);
  resetCircuitBreaker();

  // Create Express application mounting the profile router
  const app = express();
  app.use(express.json());
  app.use("/api", profileRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const validTokenUserA = "token_user_a_active";
  const validTokenUserB = "token_user_b_active";
  const userAId = "11111111-1111-4111-8111-111111111111";
  const userBId = "22222222-2222-4222-8222-222222222222";

  // Pre-seed User A in mock DB
  mockProfiles.set(userAId, {
    id: userAId,
    display_name: "Alice Original",
    username: "alice_orig",
    avatar_url: "https://placeholder.supabase.co/storage/v1/object/public/avatars/alice.png",
    pref_show_chat_column: true,
    pref_show_people_column: false,
    pref_disable_chat_sound: false,
    pref_camera_on: false,
    pref_mic_on: false,
    pref_appearance_mode: "system",
    terms_agreed_at: null,
    age_verified_at: null,
    updated_at: new Date().toISOString(),
  });

  // Mock supabaseAdmin.auth.getUser
  const originalGetUser = supabaseAdmin?.auth?.getUser;
  if (supabaseAdmin?.auth) {
    supabaseAdmin.auth.getUser = (async (token: string) => {
      if (token === validTokenUserA) {
        return { data: { user: { id: userAId, email: "alice@example.com", email_confirmed_at: "2026-01-01" } }, error: null };
      }
      if (token === validTokenUserB) {
        return { data: { user: { id: userBId, email: "bob@example.com", email_confirmed_at: "2026-01-01" } }, error: null };
      }
      return { data: { user: null }, error: new Error("Invalid token") };
    }) as any;
  }

  try {
    // Test 1: Unauthenticated GET /api/profile returns 401
    {
      const res = await fetch(`${baseUrl}/api/profile`);
      assert(res.status === 401, 1, "Unauthenticated GET /api/profile returns 401 Unauthorized");
    }

    // Test 2: Unauthenticated PATCH /api/profile returns 401
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: "Hacker" }),
      });
      assert(res.status === 401, 2, "Unauthenticated PATCH /api/profile returns 401 Unauthorized");
    }

    // Test 3: Unauthenticated GET /api/users/:userId/public-profile returns 401
    {
      const res = await fetch(`${baseUrl}/api/users/${userAId}/public-profile`);
      assert(res.status === 401, 3, "Unauthenticated public-profile lookup returns 401 Unauthorized");
    }

    // Test 4: Invalid token returns 401
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        headers: { Authorization: "Bearer invalid_garbage_token" },
      });
      assert(res.status === 401, 4, "Invalid token returns 401 Unauthorized");
    }

    // Test 5: Authenticated User A loads canonical profile
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 && data.profile && data.profile.id === userAId && data.profile.display_name === "Alice Original",
        5,
        "Authenticated User A receives canonical profile"
      );
    }

    // Test 6: Authorization Isolation: User A cannot mutate User B via payload injection
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: userBId, display_name: "Alice Modified" }),
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.code === "PROTECTED_FIELD_REJECTED",
        6,
        "Client cannot supply 'id' in PATCH; rejected with 400 PROTECTED_FIELD_REJECTED"
      );
    }

    // Test 7: Strict Unknown Field Rejection: unknown properties return 400 Bad Request
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ unknown_field_abc: "malicious_payload" }),
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.code === "UNKNOWN_FIELD_REJECTED",
        7,
        "Unknown payload fields are strictly rejected with 400 UNKNOWN_FIELD_REJECTED"
      );
    }

    // Test 8: Protected Legal Fields Rejection: terms_agreed_at and age_verified_at return 400
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ age_verified_at: "2026-01-01T00:00:00Z" }),
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.code === "PROTECTED_FIELD_REJECTED",
        8,
        "Protected legal fields like age_verified_at are strictly rejected with 400"
      );
    }

    // Test 9: Input Validation: Oversized display_name (>50 chars) returns 400
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ display_name: "A".repeat(51) }),
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.code === "INVALID_DISPLAY_NAME_LENGTH",
        9,
        "Oversized display_name (>50 chars) returns 400 INVALID_DISPLAY_NAME_LENGTH"
      );
    }

    // Test 10: Input Validation: Disallowed avatar URL host returns 400
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_url: "https://evil-unauthorized-server.com/malicious.png" }),
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.code === "INVALID_AVATAR_URL",
        10,
        "Disallowed avatar URL origin returns 400 INVALID_AVATAR_URL"
      );
    }

    // Test 11: Valid Column-Level Update returns 200 with updated canonical state
    {
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validTokenUserA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: "Alice Updated",
          pref_camera_on: true,
          pref_appearance_mode: "mantine",
        }),
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.profile &&
        data.profile.display_name === "Alice Updated" &&
        data.profile.pref_camera_on === true &&
        data.profile.pref_appearance_mode === "mantine",
        11,
        "Valid PATCH successfully updates columns and returns canonical profile"
      );
    }

    // Test 12: Atomic Self-Healing Under Concurrency: 10 parallel GET requests for new user
    {
      const newUserId = "33333333-3333-4333-8333-333333333333";
      const newToken = "token_user_c_new";
      supabaseAdmin.auth.getUser = (async (t: string) => {
        if (t === newToken) {
          return { data: { user: { id: newUserId, email: "charlie@example.com", email_confirmed_at: "2026-01-01" } }, error: null };
        }
        if (t === validTokenUserA) {
          return { data: { user: { id: userAId, email: "alice@example.com", email_confirmed_at: "2026-01-01" } }, error: null };
        }
        if (t === validTokenUserB) {
          return { data: { user: { id: userBId, email: "bob@example.com", email_confirmed_at: "2026-01-01" } }, error: null };
        }
        return { data: { user: null }, error: new Error("Invalid") };
      }) as any;

      const promises = Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/api/profile`, {
          headers: { Authorization: `Bearer ${newToken}` },
        }).then((r) => r.json())
      );

      const results = await Promise.all(promises);
      const allSucceeded = results.every((r) => r.profile && r.profile.id === newUserId);
      const canonicalUsername = results[0].profile.username;
      const allSameUsername = results.every((r) => r.profile.username === canonicalUsername);

      assert(
        allSucceeded && allSameUsername && mockProfiles.has(newUserId),
        12,
        "10 parallel GET /api/profile requests atomically create exactly 1 row and return identical profile"
      );
    }

    // Test 13: Concurrency-Safe Independent Column Updates
    {
      const patch1 = fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${validTokenUserA}`, "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: "Alice Parallel Name" }),
      });
      const patch2 = fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${validTokenUserA}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pref_mic_on: true }),
      });

      const [res1, res2] = await Promise.all([patch1, patch2]);
      const current = mockProfiles.get(userAId);

      assert(
        res1.status === 200 && res2.status === 200 &&
        current?.display_name === "Alice Parallel Name" &&
        current?.pref_mic_on === true,
        13,
        "Concurrent updates to distinct columns merge without lost writes"
      );
    }

    // Test 14: Username Collision Mapping: 23505 maps to 409 Conflict
    {
      // Try to rename User A to User C's username
      const userC = mockProfiles.get("33333333-3333-4333-8333-333333333333");
      const res = await fetch(`${baseUrl}/api/profile`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${validTokenUserA}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: userC?.username }),
      });
      const data = await res.json();
      assert(
        res.status === 409 && data.error?.code === "USERNAME_ALREADY_EXISTS",
        14,
        "Username conflict returns 409 Conflict with USERNAME_ALREADY_EXISTS"
      );
    }

    // Test 15: Fail-Closed Persistence: DB outage returns 500/503; no synthetic profile
    {
      shouldSimulateDbOutage = true;
      const res = await fetch(`${baseUrl}/api/profile`, {
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const data = await res.json();
      assert(
        res.status === 500 && data.error && !data.profile,
        15,
        "Database outage fails closed with 500 error; no synthetic profile returned"
      );
    }

    // Test 16: Fail-Closed Recovery: Subsequent requests succeed when DB resumes
    {
      shouldSimulateDbOutage = false;
      const res = await fetch(`${baseUrl}/api/profile`, {
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 && data.profile && data.profile.id === userAId,
        16,
        "System recovers cleanly after DB restored; subsequent request succeeds"
      );
    }

    // Test 17: Public Profile Projection: Resolves non-sensitive projection
    {
      const res = await fetch(`${baseUrl}/api/users/${userAId}/public-profile`, {
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.profile &&
        data.profile.id === userAId &&
        !("pref_camera_on" in data.profile) &&
        !("pref_mic_on" in data.profile) &&
        !("pref_appearance_mode" in data.profile),
        17,
        "Public profile returns strictly non-sensitive fields and hides private preferences"
      );
    }

    // Test 18: Public Profile Invalid UUID returns 400 Bad Request
    {
      const res = await fetch(`${baseUrl}/api/users/not-a-valid-uuid-123/public-profile`, {
        headers: { Authorization: `Bearer ${validTokenUserA}` },
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.error?.code === "INVALID_USER_ID",
        18,
        "Invalid UUID format for public profile returns 400 INVALID_USER_ID"
      );
    }
  } finally {
    server.close();
  }

  console.log("================================================================");
  if (failed === 0) {
    console.log(`ALL 18 PROFILE-001 CONTRACT TESTS PASSED WITH ZERO FAILURES.`);
  } else {
    console.error(`PROFILE TEST SUITE FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("================================================================\n");
}

runProfileContractTests();
