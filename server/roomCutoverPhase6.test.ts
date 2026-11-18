import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isValidCanonicalUuid, isValidJoiningCode } from "./utils/roomIdentifier.ts";

test("Phase 6: Database Cutover & Architectural Invariants Suite", async (t) => {
  const upMigrationPath = path.resolve(process.cwd(), "sql/migrations/20261118_room_identity_phase6_cutover_up.sql");
  const downMigrationPath = path.resolve(process.cwd(), "sql/migrations/20261118_room_identity_phase6_cutover_down.sql");

  // =========================================================================
  // 1. MIGRATION FILE EXISTENCE & INTEGRITY
  // =========================================================================
  await t.test("1. Migration files exist, are transactional, and exceed minimum size", () => {
    assert.ok(fs.existsSync(upMigrationPath), "Forward cutover migration must exist");
    assert.ok(fs.existsSync(downMigrationPath), "Rollback cutover migration must exist");

    const upSql = fs.readFileSync(upMigrationPath, "utf-8");
    const downSql = fs.readFileSync(downMigrationPath, "utf-8");

    assert.ok(upSql.length > 5000, `Up migration size (${upSql.length} bytes) exceeds 5KB`);
    assert.ok(downSql.length > 3000, `Down migration size (${downSql.length} bytes) exceeds 3KB`);

    assert.ok(upSql.startsWith("--") && upSql.includes("BEGIN;") && upSql.includes("COMMIT;"), "Up migration is transactional");
    assert.ok(downSql.startsWith("--") && downSql.includes("BEGIN;") && downSql.includes("COMMIT;"), "Down migration is transactional");
  });

  // =========================================================================
  // 2. DDL CLEANUP INVARIANTS: DROPPING TRIGGERS, PROCEDURES & LEGACY COLUMNS
  // =========================================================================
  await t.test("2. Forward migration drops triggers, trigger functions, procedures, and legacy columns", () => {
    const upSql = fs.readFileSync(upMigrationPath, "utf-8");

    // All 8 sync triggers must be dropped
    const triggers = [
      "trg_sync_room_identities",
      "trg_sync_room_admissions_uuid",
      "trg_sync_room_bans_uuid",
      "trg_sync_room_invitations_uuid",
      "trg_sync_room_lifecycle_events_uuid",
      "trg_sync_room_media_sessions_uuid",
      "trg_sync_room_messages_uuid",
      "trg_sync_room_quota_events_uuid",
    ];
    for (const trg of triggers) {
      assert.ok(upSql.includes(`DROP TRIGGER IF EXISTS ${trg}`), `Must drop trigger ${trg}`);
    }

    // All 4 trigger functions and 2 backfill procedures must be dropped
    assert.ok(upSql.includes("DROP FUNCTION IF EXISTS public.sync_room_identities_trigger();"));
    assert.ok(upSql.includes("DROP FUNCTION IF EXISTS public.sync_child_room_uuid_trigger();"));
    assert.ok(upSql.includes("DROP FUNCTION IF EXISTS public.sync_room_lifecycle_events_uuid_trigger();"));
    assert.ok(upSql.includes("DROP FUNCTION IF EXISTS public.sync_room_quota_events_uuid_trigger();"));
    assert.ok(upSql.includes("DROP PROCEDURE IF EXISTS public.backfill_rooms_identity(integer);"));
    assert.ok(upSql.includes("DROP PROCEDURE IF EXISTS public.backfill_child_table_room_uuid(text, integer);"));

    // Child table text columns must be dropped
    assert.ok(upSql.includes("ALTER TABLE public.room_admissions DROP COLUMN IF EXISTS room_id;"));
    assert.ok(upSql.includes("ALTER TABLE public.room_bans DROP COLUMN IF EXISTS room_id;"));
    assert.ok(upSql.includes("ALTER TABLE public.room_invitations DROP COLUMN IF EXISTS room_id;"));
    assert.ok(upSql.includes('ALTER TABLE public.room_lifecycle_events DROP COLUMN IF EXISTS "roomId";'));
    assert.ok(upSql.includes("ALTER TABLE public.room_media_sessions DROP COLUMN IF EXISTS room_id;"));
    assert.ok(upSql.includes("ALTER TABLE public.room_messages DROP COLUMN IF EXISTS room_id;"));
    assert.ok(upSql.includes("ALTER TABLE public.room_quota_events DROP COLUMN IF EXISTS room_id;"));

    // Rooms legacy text columns and indexes must be dropped
    assert.ok(upSql.includes('DROP INDEX IF EXISTS public."room_roomId_idx";'));
    assert.ok(upSql.includes("ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS uq_rooms_legacy_room_id;"));
    assert.ok(upSql.includes("ALTER TABLE public.rooms DROP COLUMN IF EXISTS legacy_room_id;"));
    assert.ok(upSql.includes('ALTER TABLE public.rooms DROP COLUMN IF EXISTS "roomId";'));
  });

  // =========================================================================
  // 3. CONSTRAINTS & NOT NULL ENFORCEMENT ON CHILD TABLES
  // =========================================================================
  await t.test("3. Forward migration enforces NOT NULL and replacement unique constraints on room_uuid", () => {
    const upSql = fs.readFileSync(upMigrationPath, "utf-8");

    // NOT NULL enforcement on 6 child tables
    const notNullTables = [
      "public.room_admissions",
      "public.room_bans",
      "public.room_invitations",
      "public.room_lifecycle_events",
      "public.room_media_sessions",
      "public.room_messages",
    ];
    for (const tbl of notNullTables) {
      assert.ok(upSql.includes(`ALTER TABLE ${tbl} ALTER COLUMN room_uuid SET NOT NULL;`), `${tbl} must have room_uuid NOT NULL`);
    }

    // Replacement unique constraints
    assert.ok(upSql.includes("ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_room_uuid_user_unique UNIQUE (room_uuid, user_id);"));
    assert.ok(upSql.includes("ALTER TABLE public.room_bans ADD CONSTRAINT room_bans_room_uuid_client_identity_unique UNIQUE (room_uuid, client_identity);"));
    assert.ok(upSql.includes("ALTER TABLE public.room_messages ADD CONSTRAINT room_messages_room_uuid_user_client_msg_unique UNIQUE (room_uuid, user_id, client_message_id);"));

    // Rebuilt indexes
    assert.ok(upSql.includes("CREATE INDEX IF NOT EXISTS idx_room_admissions_lookup ON public.room_admissions (room_uuid, user_id) WHERE (revoked_at IS NULL);"));
    assert.ok(upSql.includes("CREATE INDEX IF NOT EXISTS idx_room_bans_user_id ON public.room_bans (room_uuid, user_id) WHERE (user_id IS NOT NULL);"));
    assert.ok(upSql.includes("CREATE INDEX IF NOT EXISTS room_messages_room_created_id_idx ON public.room_messages (room_uuid, created_at DESC, id DESC);"));
  });

  // =========================================================================
  // 4. AUTHORITATIVE ROUTINES & RESOLVER INVARIANTS
  // =========================================================================
  await t.test("4. Authoritative procedures operate on canonical UUID and drop legacy columns", () => {
    const upSql = fs.readFileSync(upMigrationPath, "utf-8");

    // 4.1 resolve_room_authoritative
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.resolve_room_authoritative("));
    assert.ok(upSql.includes("WHERE joining_id = p_identifier"));
    assert.ok(upSql.includes("WHERE id = p_identifier::uuid"));

    // 4.2 create_room_authoritative inserts into rooms without legacy columns
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.create_room_authoritative(\n  p_account_id uuid,\n  p_room_id uuid"));
    assert.ok(upSql.includes("INSERT INTO public.rooms (\n    id, joining_id,"));
    assert.ok(!upSql.includes('INSERT INTO public.rooms (\n    id, joining_id, legacy_room_id, "roomId"'));

    // 4.3 Quota and lifecycle events do not reference text columns
    assert.ok(upSql.includes("INSERT INTO public.room_quota_events(account_id, room_uuid, room_kind, event_type, metadata)"));
    assert.ok(upSql.includes('INSERT INTO public.room_lifecycle_events (room_uuid, actor, event, "newStatus", "newExpiresAt", reason)'));

    // 4.4 Delegating text wrappers
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.create_room_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.delete_room_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.end_room_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.extend_room_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.set_room_activity_authoritative(\n  p_room_id text,\n  p_status text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.set_room_participants_lock_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.set_room_permanence_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
    assert.ok(upSql.includes("CREATE OR REPLACE FUNCTION public.update_room_metadata_authoritative(\n  p_account_id uuid,\n  p_room_id text"));
  });

  // =========================================================================
  // 5. ROLLBACK SYMMETRY
  // =========================================================================
  await t.test("5. Rollback migration restores legacy columns, backfills, constraints and triggers", () => {
    const downSql = fs.readFileSync(downMigrationPath, "utf-8");

    // Restores rooms legacy columns
    assert.ok(downSql.includes('ADD COLUMN IF NOT EXISTS "roomId" text'));
    assert.ok(downSql.includes("ADD COLUMN IF NOT EXISTS legacy_room_id text"));
    assert.ok(downSql.includes('UPDATE public.rooms\nSET "roomId" = id::text,\n    legacy_room_id = id::text'));

    // Restores child tables legacy columns
    assert.ok(downSql.includes("ALTER TABLE public.room_admissions ADD COLUMN IF NOT EXISTS room_id text;"));
    assert.ok(downSql.includes("ALTER TABLE public.room_bans ADD COLUMN IF NOT EXISTS room_id text;"));
    assert.ok(downSql.includes("ALTER TABLE public.room_invitations ADD COLUMN IF NOT EXISTS room_id text;"));
    assert.ok(downSql.includes('ALTER TABLE public.room_lifecycle_events ADD COLUMN IF NOT EXISTS "roomId" text;'));
    assert.ok(downSql.includes("ALTER TABLE public.room_media_sessions ADD COLUMN IF NOT EXISTS room_id text;"));
    assert.ok(downSql.includes("ALTER TABLE public.room_messages ADD COLUMN IF NOT EXISTS room_id text;"));
    assert.ok(downSql.includes("ALTER TABLE public.room_quota_events ADD COLUMN IF NOT EXISTS room_id text;"));

    // Restores sync triggers
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_identities"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_admissions_uuid"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_bans_uuid"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_invitations_uuid"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_media_sessions_uuid"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_messages_uuid"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_lifecycle_events_uuid"));
    assert.ok(downSql.includes("CREATE TRIGGER trg_sync_room_quota_events_uuid"));
  });

  // =========================================================================
  // 6. SERVER RUNTIME SOURCE VALIDATION: NO LEGACY COLUMN REFERENCES
  // =========================================================================
  await t.test("6. Server runtime codebase does not execute queries on dropped legacy columns", () => {
    const serverFiles = [
      "server/lifecycle/roomReconstruction.ts",
      "server/lifecycle/roomManager.ts",
      "server/lifecycle/admissionCoordinator.ts",
      "server/routes/roomDiscoveryRouter.ts",
      "server/routes/roomAdmissionRouter.ts",
      "server/routes/roomConfigRouter.ts",
      "server/routes/roomLifecycleRouter.ts",
      "server/routes/roomOwnerInspectionRouter.ts",
      "server/routes/iceServersRouter.ts",
      "server/invitations/invitationRouter.ts",
      "server/room/roomModerationCoordinator.ts",
      "server/room.ts",
    ];

    for (const relPath of serverFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);
      const content = fs.readFileSync(fullPath, "utf-8");

      // Verify no queries targeting legacy text columns (room_id or legacy_room_id).
      // Note: Phase 7 unified "roomId" as the canonical UUID PK and FK across PostgreSQL.
      assert.ok(
        !content.includes("WHERE room_id =") && !content.includes("WHERE room_id="),
        `${relPath} must not query WHERE room_id =`
      );
      assert.ok(
        !content.includes("WHERE legacy_room_id =") && !content.includes("WHERE legacy_room_id="),
        `${relPath} must not query WHERE legacy_room_id =`
      );
    }
  });
});
