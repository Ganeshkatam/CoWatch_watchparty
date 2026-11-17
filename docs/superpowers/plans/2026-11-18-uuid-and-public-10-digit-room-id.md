# Ultra-Realistic Architecture: UUID Canonical Room ID & 10-Digit Public Room ID

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform CoWatch room identity into an enterprise-grade, dual-identifier system: native PostgreSQL 128-bit RFC 4122 v4 UUIDs for canonical internal system state, foreign-key relational integrity, Socket.IO namespaces, and canonical URL display (`/watch/<uuid>` and `/join/<uuid>`), paired with a cryptographically generated, human-friendly 10-digit numeric public room code (`###-###-####`) for manual code entry on `/join`, verbal sharing, and invite messages.

**Architecture:**
1. **Database Layer (PostgreSQL 17 / Supabase):**
   - Convert primary key `public.rooms."roomId"` and all 7 referencing foreign keys (`room_admissions`, `room_bans`, `room_invitations`, `room_lifecycle_events`, `room_media_sessions`, `room_messages`, `room_quota_events`) from `text` to native `uuid`.
   - Add `public_id varchar(10) NOT NULL UNIQUE` constrained to `^[0-9]{10}$` with a dedicated B-tree index.
   - Deploy `resolve_room_authoritative(p_identifier text)` stored function that classifies input via regex and routes to the B-tree index of either `public_id` or `"roomId"`, eliminating type-cast exceptions (`22P02`) and query planner sequential scans.
   - Refactor stored procedures (`create_room_authoritative`, `delete_room_authoritative`, `end_room_authoritative`, `extend_room_authoritative`, `set_room_activity_authoritative`, `update_room_metadata_authoritative`) to operate on native `uuid` while supporting public-code ingestion.
2. **Backend Domain Service (`server/room/roomIdentifierService.ts`):**
   - Isolate identifier mechanics in an authoritative domain service: CSPRNG generation (`crypto.randomUUID()` and `crypto.randomInt()`), formatting (`###-###-####`), normalization, and shard-routing affinity.
   - Implement dual-identifier middleware with enumeration defense: enforce sliding-window rate-limiting on public-code lookups to prevent brute-force room scanning across the 10-billion space.
   - Bind Socket.IO namespaces exclusively to canonical UUIDs (`/watch/<uuid>`) so real-time clusters and WebRTC signaling are completely decoupled from user-facing codes.
3. **Frontend Client Experience (Mantine v7 + React 18):**
   - Formatted 10-digit room code input with live auto-segmentation (`3-3-4` grouping: `849-201-9485`) and seamless paste handling in `/join`.
   - Modern Room Header & Sharing Dialogs: 1-click copy badge, human-readable invite message, and host-only permission boundaries strictly maintained.
   - Direct canonical routing to `/watch/<uuid>` after zero-latency resolution in the join gateway.

**Tech Stack:** Node.js 24 (TSX), Express 4, Socket.IO, PostgreSQL 17 / Supabase, Mantine UI v7, React 18, Tabler Icons.

**Spec:** Requirement to modernize room identification with canonical UUIDs and a 10-digit public room ID without temporary patches or superficial wrappers.

## Global Constraints

- Never create TS/JS files to inspect the database. Strictly use Supabase MCP tools or plain SQL scripts for database operations.
- Do not push commits to the remote repository. Keep all commits local and never run `git push` unless explicitly instructed by the user.
- Never use `window.confirm`, `window.alert`, or native browser prompt dialogs; always use custom Mantine modals or notifications.
- Never auto-confirm users or bypass email verification.
- Never delete any file in the repository; instead of deleting files, convert them to configuration or maintain compatibility stubs.
- Always write detailed commit messages including a structured summary, architectural rationale, key changes, and verification notes.
- Never show host-only UI, moderation controls, room configuration options, room credentials (such as passcodes), or invitation controls to non-host participants or guests. Non-hosts must never be able to invite users, copy party invite links/messages, unmask passcodes, moderate chat, or alter room playback lock and capacity settings. All host-only UI elements and invitation actions must be conditionally excluded from rendering (not merely disabled or hidden with CSS), and server-side authorization must strictly reject unauthorized invitation requests and host actions from non-hosts.
- Never create new files unnecessarily. Always prioritize using and extending existing files efficiently.

## Review Focus

1. **Native PostgreSQL Type Migration Integrity:** The database migration must alter `"roomId"` and all 7 referencing foreign-key tables to native `uuid` type without breaking existing relational links, while backfilling clean UUIDs and unique 10-digit public IDs for all existing records.
2. **Type-Safe Dual Resolution:** Any query taking an identifier parameter (UUID or 10-digit string) must classify the type *before* executing the SQL query or use the `resolve_room_authoritative` procedure, strictly preventing PostgreSQL `22P02: invalid input syntax for type uuid`.
3. **Enumeration & Brute-Force Defense:** Because 10-digit codes have a finite search space ($10^{10} = 10 \text{ billion}$), public ID lookups on `/roomInfo/:id` and `/verifyPasscode` must be guarded by durable IP and user rate limiters to prevent automated room scanning.
4. **Multi-Shard Realtime Topology:** When `cfg.SHARD` is configured, generated UUIDs must deterministically match the authoritative shard worker's NGINX routing map based on its leading hex character.
5. **Host Privilege Isolation in Public Sharing:** While the 10-digit public room ID and URL are shareable with participants, passcodes, invite creation APIs, and host administration controls must remain strictly inaccessible to non-hosts and guests.

---

### Task 1: Database Migration: Native PostgreSQL UUID & 10-Digit Public ID

**Files:**
- Create: `sql/migrations/20261118_ultra_realistic_uuid_and_public_id.sql`
- Modify: `sql/schema.sql:103-160`, `sql/schema.sql:639-785`, `sql/schema.sql:788-825`, `sql/schema.sql:903-950`
- Test: `sql/tests/test_ultra_realistic_room_identifiers.sql`

**Interfaces:**
- Consumes: PostgreSQL schema with text-based room IDs across 8 tables.
- Produces: 
  - `public.rooms."roomId"` converted to `uuid PRIMARY KEY`.
  - `public.rooms.public_id` column: `varchar(10) NOT NULL UNIQUE CHECK (public_id ~ '^[0-9]{10}$')`.
  - 7 child tables (`room_admissions`, `room_bans`, `room_invitations`, `room_lifecycle_events`, `room_media_sessions`, `room_messages`, `room_quota_events`) with foreign keys pointing to `rooms("roomId")` typed as native `uuid`.
  - Stored function `public.resolve_room_authoritative(p_identifier text)` returning `public.rooms%ROWTYPE`.
  - Updated stored procedures `create_room_authoritative(p_account_id uuid, p_room_id uuid, p_public_id text, ...)` returning `{ roomId: uuid, publicId: text, ... }`.

- [ ] **Step 1: Write the failing SQL test script**
Create `sql/tests/test_ultra_realistic_room_identifiers.sql` that:
1. Verifies column `public.rooms."roomId"` is native `uuid` data type (`information_schema.columns.data_type = 'uuid'`).
2. Verifies column `public.rooms.public_id` is `character varying` with length 10 and unique constraint.
3. Tests `public.resolve_room_authoritative` with both a 10-digit code and a UUID.
4. Tests inserting a room with invalid public_id (e.g. 9 digits or non-digits) and verifies rejection.
5. Verifies all 7 referencing tables have `room_id` / `"roomId"` columns of type `uuid` with valid foreign keys.

- [ ] **Step 2: Run test to verify it fails**
Execute test script via Supabase MCP `execute_sql`.
Expected: FAIL (`roomId is text, public_id does not exist`).

- [ ] **Step 3: Implement database migration script in `sql/migrations/20261118_ultra_realistic_uuid_and_public_id.sql`**
Write a transactional migration:
```sql
BEGIN;

-- 1. Create mapping table for existing rooms
CREATE TEMP TABLE room_id_migration_map (
  old_room_id text PRIMARY KEY,
  new_uuid uuid NOT NULL,
  new_public_id text NOT NULL
);

-- Generate deterministic UUIDs and unique 10-digit public IDs for all existing records
INSERT INTO room_id_migration_map (old_room_id, new_uuid, new_public_id)
SELECT 
  "roomId",
  gen_random_uuid(),
  (1000000000 + floor(random() * 9000000000))::bigint::text
FROM public.rooms;

-- Ensure no duplicate public IDs in migration map
WHILE (SELECT count(DISTINCT new_public_id) FROM room_id_migration_map) < (SELECT count(*) FROM room_id_migration_map) LOOP
  UPDATE room_id_migration_map
  SET new_public_id = (1000000000 + floor(random() * 9000000000))::bigint::text;
END LOOP;

-- 2. Drop foreign key constraints on referencing tables
ALTER TABLE public.room_admissions DROP CONSTRAINT IF EXISTS room_admissions_room_id_fkey;
ALTER TABLE public.room_bans DROP CONSTRAINT IF EXISTS room_bans_room_id_fkey;
ALTER TABLE public.room_invitations DROP CONSTRAINT IF EXISTS room_invitations_room_id_fkey;
ALTER TABLE public.room_lifecycle_events DROP CONSTRAINT IF EXISTS room_lifecycle_events_room_fk;
ALTER TABLE public.room_media_sessions DROP CONSTRAINT IF EXISTS room_media_sessions_room_id_fkey;
ALTER TABLE public.room_messages DROP CONSTRAINT IF EXISTS room_messages_room_id_fkey;
ALTER TABLE public.room_quota_events DROP CONSTRAINT IF EXISTS room_quota_events_room_id_fkey;

-- 3. Update foreign key table data with mapped UUIDs
UPDATE public.room_admissions a SET room_id = m.new_uuid::text FROM room_id_migration_map m WHERE a.room_id = m.old_room_id;
UPDATE public.room_bans b SET room_id = m.new_uuid::text FROM room_id_migration_map m WHERE b.room_id = m.old_room_id;
UPDATE public.room_invitations i SET room_id = m.new_uuid::text FROM room_id_migration_map m WHERE i.room_id = m.old_room_id;
UPDATE public.room_lifecycle_events l SET "roomId" = m.new_uuid::text FROM room_id_migration_map m WHERE l."roomId" = m.old_room_id;
UPDATE public.room_media_sessions ms SET room_id = m.new_uuid::text FROM room_id_migration_map m WHERE ms.room_id = m.old_room_id;
UPDATE public.room_messages msg SET room_id = m.new_uuid::text FROM room_id_migration_map m WHERE msg.room_id = m.old_room_id;
UPDATE public.room_quota_events q SET room_id = m.new_uuid::text FROM room_id_migration_map m WHERE q.room_id = m.old_room_id;

-- 4. Update rooms table data with mapped UUIDs and add public_id column
ALTER TABLE public.rooms ADD COLUMN public_id varchar(10);

UPDATE public.rooms r
SET "roomId" = m.new_uuid::text,
    public_id = m.new_public_id
FROM room_id_migration_map m
WHERE r."roomId" = m.old_room_id;

-- 5. Alter columns to native uuid data type
ALTER TABLE public.rooms 
  ALTER COLUMN "roomId" TYPE uuid USING "roomId"::uuid,
  ALTER COLUMN "roomId" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN public_id SET NOT NULL;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_public_id_check CHECK (public_id ~ '^[0-9]{10}$'),
  ADD CONSTRAINT rooms_public_id_unique UNIQUE (public_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_public_id ON public.rooms (public_id);

ALTER TABLE public.room_admissions ALTER COLUMN room_id TYPE uuid USING room_id::uuid;
ALTER TABLE public.room_bans ALTER COLUMN room_id TYPE uuid USING room_id::uuid;
ALTER TABLE public.room_invitations ALTER COLUMN room_id TYPE uuid USING room_id::uuid;
ALTER TABLE public.room_lifecycle_events ALTER COLUMN "roomId" TYPE uuid USING "roomId"::uuid;
ALTER TABLE public.room_media_sessions ALTER COLUMN room_id TYPE uuid USING room_id::uuid;
ALTER TABLE public.room_messages ALTER COLUMN room_id TYPE uuid USING room_id::uuid;
ALTER TABLE public.room_quota_events ALTER COLUMN room_id TYPE uuid USING room_id::uuid;

-- 6. Recreate foreign key constraints
ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
ALTER TABLE public.room_bans ADD CONSTRAINT room_bans_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
ALTER TABLE public.room_invitations ADD CONSTRAINT room_invitations_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
ALTER TABLE public.room_lifecycle_events ADD CONSTRAINT room_lifecycle_events_room_fk FOREIGN KEY ("roomId") REFERENCES public.rooms("roomId") ON DELETE CASCADE;
ALTER TABLE public.room_media_sessions ADD CONSTRAINT room_media_sessions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
ALTER TABLE public.room_messages ADD CONSTRAINT room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
ALTER TABLE public.room_quota_events ADD CONSTRAINT room_quota_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE SET NULL;

-- 7. Deploy authoritative identifier resolver function
CREATE OR REPLACE FUNCTION public.resolve_room_authoritative(p_identifier text)
RETURNS SETOF public.rooms
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean text := btrim(p_identifier);
BEGIN
  IF v_clean ~ '^[0-9]{10}$' THEN
    RETURN QUERY SELECT * FROM public.rooms WHERE public_id = v_clean LIMIT 1;
  ELSIF v_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT * FROM public.rooms WHERE "roomId" = v_clean::uuid LIMIT 1;
  ELSE
    RETURN;
  END IF;
END;
$$;

-- 8. Update stored procedures (create_room_authoritative with p_room_id uuid and p_public_id text)
CREATE OR REPLACE FUNCTION public.create_room_authoritative(
  p_account_id uuid,
  p_room_id uuid,
  p_public_id text,
  p_room_kind text,
  p_room_title text,
  p_room_description text,
  p_passcode_hash text,
  p_owner_passcode text,
  p_passcode_fingerprint text,
  p_cover_photo text,
  p_is_chat_disabled boolean,
  p_expires_at timestamptz,
  p_requested_participants integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_is_permanent boolean := (p_room_kind = 'permanent');
  v_usage RECORD;
  v_entitlement RECORD;
  v_effective_capacity integer;
  v_effective_expires_at timestamptz;
  v_public_id text := btrim(p_public_id);
BEGIN
  -- Validate public_id structure or auto-generate
  IF v_public_id IS NULL OR v_public_id = '' THEN
    LOOP
      v_public_id := (1000000000 + floor(random() * 9000000000))::bigint::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE public_id = v_public_id);
    END LOOP;
  ELSE
    IF NOT (v_public_id ~ '^[0-9]{10}$') THEN
      RAISE EXCEPTION 'INVALID_PUBLIC_ROOM_ID';
    END IF;
  END IF;

  -- Entitlement & quota checks (preserving existing hardening)
  INSERT INTO public.account_room_usage (account_id, updated_at) VALUES (p_account_id, v_now) ON CONFLICT (account_id) DO NOTHING;
  PERFORM 1 FROM public.account_room_limits WHERE account_id = p_account_id FOR UPDATE;
  PERFORM 1 FROM public.account_room_usage WHERE account_id = p_account_id FOR UPDATE;

  SELECT * INTO v_entitlement FROM public.resolve_account_entitlement(p_account_id);
  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- Single-pass quota count
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  IF v_usage.total >= v_entitlement.max_total_rooms THEN
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  IF p_room_kind = 'watch' AND v_usage.watch >= v_entitlement.max_watch_rooms THEN
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
    RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
  END IF;

  v_effective_capacity := COALESCE(p_requested_participants, v_entitlement.max_participant_capacity);
  IF v_effective_capacity < 2 OR v_effective_capacity > v_entitlement.max_participant_capacity THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_CAPACITY';
  END IF;

  IF v_is_permanent THEN
    v_effective_expires_at := NULL;
  ELSE
    IF p_expires_at IS NULL THEN
      v_effective_expires_at := v_now + make_interval(hours => v_entitlement.max_room_duration_hours);
    ELSE
      IF p_expires_at <= v_now OR p_expires_at > v_now + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
        RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
      END IF;
      v_effective_expires_at := p_expires_at;
    END IF;
  END IF;

  -- Insert authoritative room row
  INSERT INTO public.rooms (
    "roomId", public_id, "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind, max_participants
  ) VALUES (
    p_room_id, v_public_id, v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, v_effective_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind, v_effective_capacity
  );

  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total + 1,
      watch_rooms = v_usage.watch + CASE WHEN p_room_kind = 'watch' THEN 1 ELSE 0 END,
      permanent_rooms = v_usage.permanent + CASE WHEN p_room_kind = 'permanent' THEN 1 ELSE 0 END,
      updated_at = v_now
  WHERE account_id = p_account_id;

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, p_account_id::text, 'room.created', 'inactive', v_effective_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'publicId', v_public_id,
    'roomKind', p_room_kind,
    'totalRooms', v_usage.total + 1,
    'maxCapacity', v_effective_capacity,
    'expiresAt', v_effective_expires_at
  );
END;
$$;

COMMIT;
```

- [ ] **Step 4: Execute migration and run test to verify it passes**
Apply the migration script via Supabase MCP `execute_sql` and execute `sql/tests/test_ultra_realistic_room_identifiers.sql`.
Expected: PASS with all tables and stored procedures updated cleanly.

- [ ] **Step 5: Synchronize `sql/schema.sql` and Commit**
Update `sql/schema.sql` to mirror the migrated table definitions and functions.
```bash
git add sql/migrations/20261118_ultra_realistic_uuid_and_public_id.sql sql/schema.sql sql/tests/test_ultra_realistic_room_identifiers.sql
git commit -m "db: migrate rooms to native uuid and add 10-digit public_id

- Structured Summary:
  - Migrated public.rooms.\"roomId\" and all 7 child table foreign keys to native PostgreSQL uuid data type.
  - Added public_id column (varchar(10), check constraint ^[0-9]{10}$, unique index).
  - Deployed resolve_room_authoritative function for fast B-tree identifier lookup.
  - Updated create_room_authoritative to accept and return native uuid and publicId.
- Architectural Rationale:
  - Establishes true database-level typing, eliminates text-based PK compromises, and introduces high-performance 10-digit public indexing.
- Verification Notes:
  - Executed migration and verified with test_ultra_realistic_room_identifiers.sql."
```

---

### Task 2: Domain Identifier Service (`server/room/roomIdentifierService.ts`)

**Files:**
- Create: `server/room/roomIdentifierService.ts`
- Create: `server/room/roomIdentifierService.test.ts`
- Modify: `server/utils/moniker.ts:1-41` (deprecate room name generation, retain guest username generation)

**Interfaces:**
- Consumes: `node:crypto`, `resolveShard` from `server/utils/resolveShard.ts`.
- Produces:
  - `classifyIdentifier(input: string): { type: 'uuid' | 'public_id' | 'invalid', cleanValue: string }`
  - `generateCanonicalRoomId(shard?: number): string` (RFC 4122 v4 UUID with shard routing parity)
  - `generatePublicRoomId(): string` (CSPRNG 10-digit string `1000000000`–`9999999999`)
  - `formatPublicRoomId(publicId: string): string` (3-3-4 grouping: `###-###-####`)
  - `normalizePublicRoomId(input: string): string` (strips hyphens and whitespace)
  - `isValidUUID(id: string): boolean`
  - `isValidPublicRoomId(code: string): boolean`

- [ ] **Step 1: Write the failing unit tests in `server/room/roomIdentifierService.test.ts`**
```ts
import assert from "node:assert";
import test from "node:test";
import {
  classifyIdentifier,
  generateCanonicalRoomId,
  generatePublicRoomId,
  formatPublicRoomId,
  normalizePublicRoomId,
  isValidUUID,
  isValidPublicRoomId,
} from "./roomIdentifierService.js";
import { resolveShard } from "../utils/resolveShard.js";

test("RoomIdentifierService Suite", async (t) => {
  await t.test("classifyIdentifier accurately distinguishes UUIDs, public IDs, and rejects malformed inputs", () => {
    assert.deepStrictEqual(classifyIdentifier("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"), {
      type: "uuid",
      cleanValue: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    });
    assert.deepStrictEqual(classifyIdentifier("849-201-9485"), {
      type: "public_id",
      cleanValue: "8492019485",
    });
    assert.deepStrictEqual(classifyIdentifier("8492019485"), {
      type: "public_id",
      cleanValue: "8492019485",
    });
    assert.strictEqual(classifyIdentifier("invalid-slug-here").type, "invalid");
    assert.strictEqual(classifyIdentifier("12345").type, "invalid");
    assert.strictEqual(classifyIdentifier("").type, "invalid");
  });

  await t.test("generateCanonicalRoomId generates RFC 4122 UUID matching requested shard", () => {
    const defaultUuid = generateCanonicalRoomId();
    assert(isValidUUID(defaultUuid));

    for (let s = 1; s <= 2; s++) {
      const shardedUuid = generateCanonicalRoomId(s);
      assert(isValidUUID(shardedUuid));
      assert.strictEqual(resolveShard(shardedUuid), s);
    }
  });

  await t.test("generatePublicRoomId generates strictly 10 digits within range [10^9, 10^10 - 1]", () => {
    for (let i = 0; i < 50; i++) {
      const pubId = generatePublicRoomId();
      assert(isValidPublicRoomId(pubId));
      assert(Number(pubId) >= 1000000000 && Number(pubId) <= 9999999999);
    }
  });

  await t.test("formatPublicRoomId formats 10-digit codes with 3-3-4 grouping", () => {
    assert.strictEqual(formatPublicRoomId("8492019485"), "849-201-9485");
    assert.strictEqual(formatPublicRoomId("849-201-9485"), "849-201-9485");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/room/roomIdentifierService.test.ts"`
Expected: FAIL (`module not found`).

- [ ] **Step 3: Implement `server/room/roomIdentifierService.ts`**
```ts
import crypto from "node:crypto";
import { resolveShard } from "../utils/resolveShard.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ID_REGEX = /^[0-9]{10}$/;

export type IdentifierType = "uuid" | "public_id" | "invalid";

export interface ClassifiedIdentifier {
  type: IdentifierType;
  cleanValue: string;
}

export function isValidUUID(id: string): boolean {
  if (typeof id !== "string") return false;
  return UUID_REGEX.test(id.trim());
}

export function isValidPublicRoomId(code: string): boolean {
  if (typeof code !== "string") return false;
  return PUBLIC_ID_REGEX.test(code.trim());
}

export function normalizePublicRoomId(input: string): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\s-]/g, "").trim();
}

export function formatPublicRoomId(code: string): string {
  const clean = normalizePublicRoomId(code);
  if (clean.length !== 10) return code;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

export function classifyIdentifier(rawInput: string | null | undefined): ClassifiedIdentifier {
  if (!rawInput || typeof rawInput !== "string") {
    return { type: "invalid", cleanValue: "" };
  }
  const trimmed = rawInput.trim();
  if (UUID_REGEX.test(trimmed)) {
    return { type: "uuid", cleanValue: trimmed.toLowerCase() };
  }
  const stripped = normalizePublicRoomId(trimmed);
  if (PUBLIC_ID_REGEX.test(stripped)) {
    return { type: "public_id", cleanValue: stripped };
  }
  return { type: "invalid", cleanValue: trimmed };
}

export function generateCanonicalRoomId(shard?: number): string {
  if (!shard) {
    return crypto.randomUUID();
  }
  let id = crypto.randomUUID();
  while (resolveShard(id) !== Number(shard)) {
    id = crypto.randomUUID();
  }
  return id;
}

export function generatePublicRoomId(): string {
  const num = crypto.randomInt(1000000000, 10000000000);
  return num.toString();
}
```
Update `server/utils/moniker.ts` to export deprecation compatibility wrappers pointing to `roomIdentifierService.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/room/roomIdentifierService.test.ts"`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**
```bash
git add server/room/roomIdentifierService.ts server/room/roomIdentifierService.test.ts server/utils/moniker.ts
git commit -m "feat(domain): implement authoritative roomIdentifierService

- Structured Summary:
  - Created roomIdentifierService providing classifyIdentifier, generateCanonicalRoomId, and generatePublicRoomId.
  - Implemented 3-3-4 grouping formatting and normalization.
  - Maintained shard-routing deterministic generation for distributed topologies.
- Architectural Rationale:
  - Centralizes identifier classification, generation, and formatting in an isolated domain module.
- Verification Notes:
  - Passed roomIdentifierService.test.ts."
```

---

### Task 3: Authoritative Backend Resolution & Realtime Gateway

**Files:**
- Modify: `server/room.ts:40-110`, `server/room.ts:180-220`
- Modify: `server/server.ts:250-350`
- Modify: `server/lifecycle/roomReconstruction.ts:30-80`
- Test: `server/room/roomPlaybackCoordinator.test.ts`

**Interfaces:**
- Consumes: `classifyIdentifier` and `resolve_room_authoritative`.
- Produces:
  - In-memory `Room` instance carrying `roomId: UUID` and `publicId: string`.
  - `getOrCreateRoom(identifier: string)` transparently resolving either UUID or public ID.
  - Realtime Socket.IO namespaces bound strictly to canonical UUID (`/watch/<uuid>`).

- [ ] **Step 1: Write the failing test for dual-identifier room loading**
In `server/room/roomLookup.test.ts`, create a test verifying that `getOrCreateRoom` successfully reconstructs an active room when passed either its canonical UUID or its 10-digit public ID, and both references resolve to the identical in-memory `Room` instance.

- [ ] **Step 2: Run test to verify it fails**
Run: `& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/room/roomLookup.test.ts"`
Expected: FAIL (`publicId resolution not implemented`).

- [ ] **Step 3: Implement dual-resolution in `server.ts` and `room.ts`**
1. In `server/room.ts`:
   - Add field `public publicId: string = "";`
   - In constructor `constructor(io: Server, roomId: string, publicId?: string)`: set `this.publicId = publicId || "";`.
   - In `getState()`: include `publicId: this.publicId`.
2. In `server/lifecycle/roomReconstruction.ts`:
   - Pass `persistedRoom.public_id` into `new Room(io, persistedRoom.roomId, persistedRoom.public_id)`.
3. In `server/server.ts`:
   - Update `getOrCreateRoom`:
     ```ts
     export async function getOrCreateRoom(rawIdentifier: string): Promise<Room | null> {
       const classified = classifyIdentifier(rawIdentifier);
       if (classified.type === "invalid") return null;

       // Fast-path memory cache check
       const existingDirect = rooms.get(classified.cleanValue);
       if (existingDirect) return existingDirect;

       if (!postgres) return null;
       try {
         const persistedRoom = (
           await postgres.query<PersistentRoom>(
             `SELECT * FROM public.resolve_room_authoritative($1)`,
             [classified.cleanValue],
           )
         )?.rows?.[0];

         if (!persistedRoom) return null;

         const canonicalId = persistedRoom.roomId;
         // Check shard assignment against canonical UUID
         const shard = resolveShard(canonicalId);
         const isCorrectShard = !config.SHARD || shard === Number(config.SHARD);
         if (!isCorrectShard) return null;

         if (rooms.has(canonicalId)) {
           const existing = rooms.get(canonicalId)!;
           if (classified.type === "public_id") {
             rooms.set(classified.cleanValue, existing); // Alias for quick lookup
           }
           return existing;
         }

         const { room } = await roomReconstructor.reconstructRoom(persistedRoom, io);
         rooms.set(canonicalId, room);
         if (persistedRoom.public_id) {
           rooms.set(persistedRoom.public_id, room); // Dual memory alias
         }
         return room;
       } catch (err) {
         console.error(`[Room] Failed loading room ${rawIdentifier}:`, err);
         return null;
       }
     }
     ```
   - In `unregisterRoomNamespace(roomId)`:
     Ensure alias entries in `rooms` map are cleaned up on room termination.

- [ ] **Step 4: Run test to verify it passes**
Run: `& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/room/roomLookup.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/room.ts server/server.ts server/lifecycle/roomReconstruction.ts server/room/roomLookup.test.ts
git commit -m "feat(server): authoritatively resolve in-memory rooms by uuid or public_id

- Structured Summary:
  - Extended Room model with publicId property.
  - Updated getOrCreateRoom to use resolve_room_authoritative and dual-key in-memory aliasing.
  - Preserved canonical UUID binding for Socket.IO namespaces and shard topology.
- Architectural Rationale:
  - Eliminates SQL casting bugs while enabling sub-millisecond memory resolution by either identifier.
- Verification Notes:
  - Passed roomLookup.test.ts."
```

---

### Task 4: Router Modernization & Enumeration Protection

**Files:**
- Modify: `server/routes/roomConfigRouter.ts:280-415`
- Modify: `server/routes/roomDiscoveryRouter.ts:40-140`
- Modify: `server/routes/roomAdmissionRouter.ts:60-180`, `server/routes/roomAdmissionRouter.ts:220-270`
- Modify: `server/routes/roomOwnerInspectionRouter.ts:68-230`, `server/routes/roomOwnerInspectionRouter.ts:250-290`
- Modify: `server/invitations/invitationRouter.ts:130-170`, `server/invitations/invitationRouter.ts:520-580`
- Test: `server/routes/roomConfigRouter.test.ts`
- Test: `server/routes/roomDiscoveryRouter.test.ts`
- Test: `server/routes/roomAdmissionRouter.test.ts`
- Test: `server/routes/roomOwnerInspectionRouter.test.ts`

**Interfaces:**
- Consumes: `roomIdentifierService.ts`, `resolve_room_authoritative`.
- Produces:
  - `POST /createRoom` generating UUID and public ID, executing `create_room_authoritative`.
  - `GET /roomInfo/:roomId` with rate-limiting, returning `{ roomId: UUID, publicId: string, ... }`.
  - `POST /verifyPasscode` accepting either identifier, returning `{ valid: true, admissionToken, sessionId, roomId: UUID, publicId: string }`.
  - `GET /listRooms` returning `publicId` and filtering across both IDs.
  - `GET /roomDetails` accepting either identifier.

- [ ] **Step 1: Write failing tests across router test suites**
1. In `server/routes/roomConfigRouter.test.ts`:
   Verify `createRoom` returns `{ name: roomId, roomId: UUID, publicId: 10-digit }`.
2. In `server/routes/roomDiscoveryRouter.test.ts`:
   Verify `GET /roomInfo/8492019485` returns 200 with `{ roomId: "<uuid>", publicId: "8492019485" }`.
   Verify `GET /roomInfo/9b1deb4d-...` returns 200 with matching attributes.
   Verify rate limit rejection on rapid consecutive requests for nonexistent public codes (enumeration defense).
3. In `server/routes/roomAdmissionRouter.test.ts`:
   Verify `POST /verifyPasscode` accepts 10-digit public ID and issues token containing canonical UUID.
4. In `server/routes/roomOwnerInspectionRouter.test.ts`:
   Verify `GET /listRooms?search=8492019485` returns the matched room.

- [ ] **Step 2: Run tests to verify they fail**
Run:
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomConfigRouter.test.ts"`
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomDiscoveryRouter.test.ts"`
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomAdmissionRouter.test.ts"`
Expected: FAIL on new identifier and rate-limiting assertions.

- [ ] **Step 3: Implement router updates**
1. In `server/routes/roomConfigRouter.ts`:
   - Generate canonical UUID: `const roomId = generateCanonicalRoomId(cfg.SHARD);`
   - Generate 10-digit public ID: `const publicId = generatePublicRoomId();`
   - Call `public.create_room_authoritative(decoded.uid, roomId, publicId, ...)`
   - Register in memory: `const newRoom = new Room(io, roomId, publicId);`
   - Return `res.json({ name: roomId, roomId, publicId });`
2. In `server/routes/roomDiscoveryRouter.ts`:
   - Classify identifier: `const { type, cleanValue } = classifyIdentifier(req.params.roomId);`
   - Query using `SELECT * FROM public.resolve_room_authoritative($1)`.
   - Protect endpoint with rate-limiting target `{ ip, identifier: cleanValue }`.
   - Return `{ roomId: row.roomId, publicId: row.public_id, ... }`.
3. In `server/routes/roomAdmissionRouter.ts`:
   - In `/verifyPasscode` and `/room-admission/restore`:
     Query using `resolve_room_authoritative`.
     Bind signed token strictly to `row.roomId` (the native UUID).
     Return `{ valid: true, admissionToken: token, sessionId, roomId: row.roomId, publicId: row.public_id }`.
4. In `server/routes/roomOwnerInspectionRouter.ts`:
   - In `/listRooms`:
     Add `r.public_id AS "publicId"` to select list.
     Add search predicate: `OR r.public_id LIKE $idx`.
   - In `/roomDetails`:
     Use `resolve_room_authoritative` joined with `WHERE owner_id = $2`.
5. In `server/invitations/invitationRouter.ts`:
   - Include `publicId: r.public_id` in invite preview payloads and verification responses.

- [ ] **Step 4: Run tests to verify they pass**
Run all router test suites:
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomConfigRouter.test.ts"`
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomDiscoveryRouter.test.ts"`
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomAdmissionRouter.test.ts"`
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomOwnerInspectionRouter.test.ts"`
Expected: PASS (all router tests green).

- [ ] **Step 5: Commit**
```bash
git add server/routes/roomConfigRouter.ts server/routes/roomDiscoveryRouter.ts server/routes/roomAdmissionRouter.ts server/routes/roomOwnerInspectionRouter.ts server/invitations/invitationRouter.ts server/routes/*.test.ts
git commit -m "feat(api): modernize routers with dual-identifier support and enumeration protection

- Structured Summary:
  - createRoom endpoint generates UUID and 10-digit publicId.
  - roomInfo, verifyPasscode, listRooms, and roomDetails query via resolve_room_authoritative.
  - Integrated sliding-window rate limiting on discovery against public ID enumeration.
  - Admission tokens strictly bound to canonical UUIDs.
- Architectural Rationale:
  - Fully closes enumeration vulnerabilities while providing robust multi-identifier resolution across APIs.
- Verification Notes:
  - Verified with comprehensive route test suites."
```

---

### Task 5: Client Route Normalization, Live Formatting & Share Utilities

**Files:**
- Modify: `src/utils/notificationAction.ts:380-481`
- Modify: `src/utils/utils.ts:720-805`
- Test: `src/utils/notificationAction.test.ts`
- Test: `src/utils/invite.test.ts`

**Interfaces:**
- Consumes: User inputs (raw, pasted URLs, formatted codes).
- Produces:
  - `parseRoomInput(raw: string)`: returns normalized 10-digit code or canonical UUID.
  - `parseJoinRoute(value: string)`: normalizes 10-digit codes (strips `-` and spaces).
  - `formatPublicRoomId(code?: string): string`: converts `8492019485` to `849-201-9485`.
  - `getRoomUrl(identifier: string)`: returns `/join/${cleanIdentifier}`.
  - `getInviteMessage(canonicalId: string, passcode?: string, publicId?: string)`: creates human-readable invite text.

- [ ] **Step 1: Write failing tests in `notificationAction.test.ts` and `invite.test.ts`**
Add tests asserting:
1. `parseRoomInput("849-201-9485") === "8492019485"`
2. `parseRoomInput("https://cowatch.tv/join/849-201-9485") === "8492019485"`
3. `parseRoomInput("https://cowatch.tv/watch/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d") === "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"`
4. `getInviteMessage("uuid-1", "pass123", "8492019485")` includes `Room Code: 849-201-9485` and `https://.../join/8492019485`.

- [ ] **Step 2: Run tests to verify they fail**
Run: `& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "src/utils/notificationAction.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement normalization and formatting in client utilities**
1. In `src/utils/utils.ts`:
   - Add `formatPublicRoomId(code?: string): string`:
     ```ts
     export function formatPublicRoomId(code?: string): string {
       if (!code || typeof code !== "string") return "";
       const digits = code.replace(/[\s-]/g, "");
       if (digits.length !== 10) return code;
       return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
     }
     ```
   - Update `parseRoomInput(raw: string)`:
     Strip surrounding whitespace and hyphens for digit-only inputs.
     If sanitized input is exactly 10 digits (`/^\d{10}$/`), return the 10-digit string.
     If input matches UUID regex, return lowercase UUID.
   - Update `getInviteMessage`:
     ```ts
     export function getInviteMessage(
       roomId: string,
       passcode?: string,
       publicId?: string,
       roomTitle?: string
     ): string {
       const displayCode = publicId ? formatPublicRoomId(publicId) : roomId.replace(/^\//, '');
       const cleanUuid = roomId.replace(/^\//, '');
       const url = getRoomUrl(cleanUuid);
       const titleSection = roomTitle && roomTitle.trim() ? `Room: "${roomTitle.trim()}"\n` : "";

       if (passcode) {
         return `Hey! Join my watch party on CoWatch:\n\n${titleSection}Link: ${url}\n\nRoom Code:\n\`${displayCode}\`\n\nPasscode:\n\`${passcode}\``;
       }
       return `Hey! Join my watch party on CoWatch:\n\n${titleSection}Link: ${url}\n\nRoom Code:\n\`${displayCode}\``;
     }
     ```
2. In `src/utils/notificationAction.ts`:
   - In `parseJoinRoute`: normalize input matching `^\d{3}-\d{3}-\d{4}$` or `^\d{10}$` to unhyphenated 10 digits.

- [ ] **Step 4: Run tests to verify they pass**
Run:
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "src/utils/notificationAction.test.ts"`
`& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "src/utils/invite.test.ts"`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**
```bash
git add src/utils/utils.ts src/utils/notificationAction.ts src/utils/notificationAction.test.ts src/utils/invite.test.ts
git commit -m "feat(client): implement 10-digit code live formatting and normalization

- Structured Summary:
  - Added formatPublicRoomId helper for 3-3-4 segment display.
  - Enhanced parseRoomInput and parseJoinRoute with hyphen stripping and UUID detection.
  - Updated getInviteMessage to prioritize human-readable 10-digit codes.
- Architectural Rationale:
  - Guarantees seamless link sharing and paste normalization across web client surfaces.
- Verification Notes:
  - Passed notificationAction and invite test suites."
```

---

### Task 6: Modern UI / UX Overhaul (Create, Join, Header, MyRooms)

**Files:**
- Modify: `src/components/Create/Create.tsx:340-365`
- Modify: `src/components/Join/Join.tsx:40-60`, `src/components/Join/Join.tsx:900-930`, `src/components/Join/Join.tsx:1075-1100`
- Modify: `src/components/TopBar/RoomHeader.tsx:80-140`
- Modify: `src/components/TopBar/TopBar.tsx:100-165`
- Modify: `src/components/MyRooms/RoomCard.tsx:130-190`, `src/components/MyRooms/RoomCard.tsx:860-880`
- Modify: `src/components/MyRooms/RoomDetails.tsx:400-425`, `src/components/MyRooms/RoomDetails.tsx:540-560`

**Interfaces:**
- Consumes: `{ roomId: string, publicId?: string }` from backend APIs.
- Produces:
  - `Create`: Receives `{ roomId, publicId }`, directs to `/watch/${roomId}`.
  - `Join`: Formatted input with automatic `3-3-4` grouping on type/paste, preview badge showing `Room Code: 849-201-9485`, seamless transition to `/watch/${canonicalRoomId}`.
  - `RoomHeader`: Prominent Room Code pill (`849-201-9485`), 1-click copy, host-only invite message generation. Strict non-host isolation maintained.
  - `MyRooms`: Room cards and details prominently feature Room Code badge with 1-click copy; canonical UUID shown in technical details.

- [ ] **Step 1: Update `Create.tsx` and `TopBar.tsx` for dual identifier flow**
- In `src/components/TopBar/TopBar.tsx`:
  Update `CreateRoomResponse` to `{ name: string; roomId: string; publicId: string; }`.
  Redirect user to `/watch/${roomId}` (the canonical UUID).

- [ ] **Step 2: Overhaul `Join.tsx` for ultra-realistic room code experience**
- In `src/components/Join/Join.tsx`:
  - Extend `RoomInfo` with `publicId?: string`.
  - In generic `/join` form:
    - Input label: "Room Code or Invite Link".
    - Placeholder: "e.g. 849-201-9485 or paste link".
    - Input change handler: auto-formats 10 digits to `###-###-####` as the user types or pastes.
  - In room admission preview (`stage === "passcode"`):
    - Replace raw slug with formatted code badge:
      ```tsx
      <Badge size="lg" variant="light" color="violet">
        Room Code: {formatPublicRoomId(roomInfo.publicId || roomInfo.roomId)}
      </Badge>
      ```
  - On successful passcode verification:
    - Transition to `/watch/${encodeURIComponent(roomInfo.roomId)}` using the canonical UUID.

- [ ] **Step 3: Update `RoomHeader.tsx` with room code pill and host isolation**
- In `src/components/TopBar/RoomHeader.tsx`:
  - Accept prop `publicId?: string`.
  - Render formatted public room code (`formatPublicRoomId(publicId || cleanRoomId)`) inside a sleek Mantine pill in the left header section.
  - "Copy Room ID" copies the 10-digit public room code.
  - Host invite message: calls `getInviteMessage(cleanRoomId, resolvedPasscode, publicId)`.
  - Enforce user invariant: If caller is non-host/guest, host controls, passcodes, and invitation buttons remain completely unrendered.

- [ ] **Step 4: Update `RoomCard.tsx` and `RoomDetails.tsx`**
- In `src/components/MyRooms/RoomCard.tsx`:
  - Display "Room Code: `formatPublicRoomId(room.publicId)`" as a badge.
  - "Copy Link" copies `/join/${room.publicId || room.roomId}`.
- In `src/components/MyRooms/RoomDetails.tsx`:
  - Display Room Code badge with 1-click copy icon.
  - Display "Canonical Room ID: `<uuid>`" in the technical details section with copy support.

- [ ] **Step 5: Typecheck client code**
Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit**
```bash
git add src/components/Create/Create.tsx src/components/Join/Join.tsx src/components/TopBar/RoomHeader.tsx src/components/TopBar/TopBar.tsx src/components/MyRooms/RoomCard.tsx src/components/MyRooms/RoomDetails.tsx
git commit -m "feat(ui): deliver modern 10-digit room code UX across Join, Header, and MyRooms

- Structured Summary:
  - Integrated 3-3-4 live formatting on Join code input.
  - Added formatted Room Code badge with 1-click copy on RoomHeader, RoomCard, and RoomDetails.
  - Preserved strict host privilege isolation for passcodes and management controls.
  - Directed active watch sessions to canonical UUID paths.
- Architectural Rationale:
  - Delivers a polished, consumer-grade watch party entry and sharing experience matching top modern platforms.
- Verification Notes:
  - Passed client typecheck."
```

---

### Task 7: Full System Certification & Build Verification

**Files:**
- Test: All backend test suites, shard routing suite, client build.

- [ ] **Step 1: Execute all backend and integration test suites**
Run:
```powershell
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/room/roomIdentifierService.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomConfigRouter.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomDiscoveryRouter.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomAdmissionRouter.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/routes/roomOwnerInspectionRouter.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "server/infrastructure/shardRoutingTopology.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "src/utils/notificationAction.test.ts"
& "C:\nvm\v24.22.1\node.exe" "node_modules\tsx\dist\cli.mjs" "src/utils/invite.test.ts"
```
Expected: All suites PASS with 0 failures.

- [ ] **Step 2: Run production client and server build**
Run:
```powershell
npm run build
```
Expected: `vite build`, `npm run typecheck`, and `typecheckServer` succeed with zero errors.

- [ ] **Step 3: Verification commit**
```bash
git add -A
git commit -m "chore(certification): complete certification for ultra-realistic uuid and 10-digit room id architecture

- Structured Summary:
  - Verified database schema migration, domain identifier service, API routers, and client UI.
  - Successfully executed full test matrix and completed production Vite/TypeScript builds.
- Architectural Rationale:
  - Fully certifies transition to enterprise-grade UUID canonical persistence and 10-digit public room codes.
- Verification Notes:
  - All test suites green, zero typecheck errors, clean build."
```
