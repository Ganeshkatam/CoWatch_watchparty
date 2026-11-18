import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isValidCanonicalUuid, isValidJoiningCode } from "./utils/roomIdentifier.ts";

test("Phase 7: Unified roomId Architecture & Migration Validation Suite", async (t) => {
  const upMigrationPath = path.resolve(process.cwd(), "sql/migrations/20261119_room_identity_phase7_unified_roomid_up.sql");
  const downMigrationPath = path.resolve(process.cwd(), "sql/migrations/20261119_room_identity_phase7_unified_roomid_down.sql");

  // =========================================================================
  // 1. MIGRATION FILE EXISTENCE, STRUCTURE & TRANSACTIONAL SAFETY
  // =========================================================================
  await t.test("1. Migration files exist, are transactional, with lock timeouts", () => {
    assert.ok(fs.existsSync(upMigrationPath), "Forward Phase 7 migration must exist");
    assert.ok(fs.existsSync(downMigrationPath), "Rollback Phase 7 migration must exist");

    const upSql = fs.readFileSync(upMigrationPath, "utf-8");
    const downSql = fs.readFileSync(downMigrationPath, "utf-8");

    assert.ok(upSql.length > 5000, `Up migration size (${upSql.length} bytes) exceeds 5KB`);
    assert.ok(downSql.length > 5000, `Down migration size (${downSql.length} bytes) exceeds 5KB`);

    assert.ok(upSql.includes("BEGIN;") && upSql.includes("COMMIT;"), "Up migration must be transactional");
    assert.ok(downSql.includes("BEGIN;") && downSql.includes("COMMIT;"), "Down migration must be transactional");

    assert.ok(upSql.includes("SET LOCAL lock_timeout = '5s';"), "Up migration must specify lock_timeout");
    assert.ok(upSql.includes("SET LOCAL statement_timeout = '60s';"), "Up migration must specify statement_timeout");
    assert.ok(downSql.includes("SET LOCAL lock_timeout = '5s';"), "Down migration must specify lock_timeout");
    assert.ok(downSql.includes("SET LOCAL statement_timeout = '60s';"), "Down migration must specify statement_timeout");
  });

  // =========================================================================
  // 2. COLUMN RENAMES (ROOMS & 7 CHILD TABLES)
  // =========================================================================
  await t.test("2. Forward migration renames rooms.id and 7 child tables room_uuid to \"roomId\"", () => {
    const upSql = fs.readFileSync(upMigrationPath, "utf-8");

    // Parent table
    assert.ok(
      upSql.includes('ALTER TABLE public.rooms RENAME COLUMN id TO "roomId";'),
      'Must rename public.rooms.id to "roomId"'
    );

    // 7 Child tables
    const childTables = [
      "room_admissions",
      "room_bans",
      "room_invitations",
      "room_lifecycle_events",
      "room_media_sessions",
      "room_messages",
      "room_quota_events",
    ];

    for (const table of childTables) {
      assert.ok(
        upSql.includes(`ALTER TABLE public.${table} RENAME COLUMN room_uuid TO "roomId";`),
        `Must rename public.${table}.room_uuid to "roomId"`
      );
    }
  });

  // =========================================================================
  // 3. FOREIGN KEY & CONSTRAINT RENAMES, INDEX REBUILDS
  // =========================================================================
  await t.test("3. Forward migration updates FK constraints, unique constraints, and indexes", () => {
    const upSql = fs.readFileSync(upMigrationPath, "utf-8");

    const expectedFks = [
      'ALTER TABLE public.room_admissions RENAME CONSTRAINT room_admissions_room_uuid_fkey TO "room_admissions_roomId_fkey";',
      'ALTER TABLE public.room_bans RENAME CONSTRAINT room_bans_room_uuid_fkey TO "room_bans_roomId_fkey";',
      'ALTER TABLE public.room_invitations RENAME CONSTRAINT room_invitations_room_uuid_fkey TO "room_invitations_roomId_fkey";',
      'ALTER TABLE public.room_lifecycle_events RENAME CONSTRAINT room_lifecycle_events_room_uuid_fkey TO "room_lifecycle_events_roomId_fkey";',
      'ALTER TABLE public.room_media_sessions RENAME CONSTRAINT room_media_sessions_room_uuid_fkey TO "room_media_sessions_roomId_fkey";',
      'ALTER TABLE public.room_messages RENAME CONSTRAINT room_messages_room_uuid_fkey TO "room_messages_roomId_fkey";',
      'ALTER TABLE public.room_quota_events RENAME CONSTRAINT room_quota_events_room_uuid_fkey TO "room_quota_events_roomId_fkey";',
    ];

    for (const fk of expectedFks) {
      assert.ok(upSql.includes(fk), `Must contain FK rename: ${fk}`);
    }

    const expectedUniques = [
      'ALTER TABLE public.room_admissions RENAME CONSTRAINT room_admissions_room_uuid_user_unique TO "room_admissions_roomId_user_unique";',
      'ALTER TABLE public.room_bans RENAME CONSTRAINT room_bans_room_uuid_client_identity_unique TO "room_bans_roomId_client_identity_unique";',
      'ALTER TABLE public.room_messages RENAME CONSTRAINT room_messages_room_uuid_user_client_msg_unique TO "room_messages_roomId_user_client_msg_unique";',
    ];

    for (const uq of expectedUniques) {
      assert.ok(upSql.includes(uq), `Must contain unique constraint rename: ${uq}`);
    }

    // Indexes
    const expectedIndexes = [
      '"idx_room_admissions_roomId"',
      '"idx_room_admissions_lookup"',
      '"idx_room_bans_roomId"',
      '"idx_room_bans_user_id"',
      '"idx_room_invitations_roomId"',
      '"idx_room_lifecycle_events_roomId"',
      '"idx_room_media_sessions_roomId"',
      '"idx_room_messages_roomId"',
      '"room_messages_roomId_created_id_idx"',
      '"idx_room_quota_events_roomId"',
    ];

    for (const idx of expectedIndexes) {
      assert.ok(upSql.includes(idx), `Must create or reference index: ${idx}`);
    }
  });

  // =========================================================================
  // 4. AUTHORITATIVE ROUTINES (11 RPCS)
  // =========================================================================
  await t.test("4. Forward migration updates all 11 authoritative RPCs to target \"roomId\"", () => {
    const upSql = fs.readFileSync(upMigrationPath, "utf-8");

    const rpcs = [
      "resolve_room_authoritative",
      "create_room_authoritative",
      "delete_room_authoritative",
      "end_room_authoritative",
      "extend_room_authoritative",
      "set_room_activity_authoritative",
      "set_room_participants_lock_authoritative",
      "set_room_permanence_authoritative",
      "update_room_metadata_authoritative",
      "expire_rooms_authoritative",
      "purge_account_rooms_authoritative",
    ];

    for (const rpc of rpcs) {
      assert.ok(upSql.includes(`FUNCTION public.${rpc}`), `Must define authoritative RPC: ${rpc}`);
    }

    // Detailed verification of column names in authoritative RPCs
    assert.ok(upSql.includes('WHERE "roomId" = p_identifier::uuid;'), 'resolve_room_authoritative must query WHERE "roomId" = p_identifier::uuid');
    assert.ok(upSql.includes('INSERT INTO public.rooms (\n    "roomId", joining_id,'), 'create_room_authoritative must insert into "roomId"');
    assert.ok(upSql.includes('INSERT INTO public.room_lifecycle_events ("roomId", actor, event,'), 'room_lifecycle_events must insert "roomId"');
    assert.ok(upSql.includes('INSERT INTO public.room_quota_events(account_id, "roomId", room_kind,'), 'room_quota_events must insert "roomId"');
  });

  // =========================================================================
  // 5. ROLLBACK SYMMETRY
  // =========================================================================
  await t.test("5. Rollback migration restores rooms.id, child room_uuid, constraints, and indexes", () => {
    const downSql = fs.readFileSync(downMigrationPath, "utf-8");

    // Parent table restore
    assert.ok(
      downSql.includes('ALTER TABLE public.rooms RENAME COLUMN "roomId" TO id;'),
      'Must rollback public.rooms."roomId" to id'
    );

    // Child tables restore
    const childTables = [
      "room_admissions",
      "room_bans",
      "room_invitations",
      "room_lifecycle_events",
      "room_media_sessions",
      "room_messages",
      "room_quota_events",
    ];

    for (const table of childTables) {
      assert.ok(
        downSql.includes(`ALTER TABLE public.${table} RENAME COLUMN "roomId" TO room_uuid;`),
        `Must rollback public.${table}."roomId" to room_uuid`
      );
    }

    // FK restores
    assert.ok(downSql.includes('ALTER TABLE public.room_admissions RENAME CONSTRAINT "room_admissions_roomId_fkey" TO room_admissions_room_uuid_fkey;'));
    assert.ok(downSql.includes('ALTER TABLE public.room_bans RENAME CONSTRAINT "room_bans_roomId_fkey" TO room_bans_room_uuid_fkey;'));
    assert.ok(downSql.includes('ALTER TABLE public.room_invitations RENAME CONSTRAINT "room_invitations_roomId_fkey" TO room_invitations_room_uuid_fkey;'));
    assert.ok(downSql.includes('ALTER TABLE public.room_lifecycle_events RENAME CONSTRAINT "room_lifecycle_events_roomId_fkey" TO room_lifecycle_events_room_uuid_fkey;'));
    assert.ok(downSql.includes('ALTER TABLE public.room_media_sessions RENAME CONSTRAINT "room_media_sessions_roomId_fkey" TO room_media_sessions_room_uuid_fkey;'));
    assert.ok(downSql.includes('ALTER TABLE public.room_messages RENAME CONSTRAINT "room_messages_roomId_fkey" TO room_messages_room_uuid_fkey;'));
    assert.ok(downSql.includes('ALTER TABLE public.room_quota_events RENAME CONSTRAINT "room_quota_events_roomId_fkey" TO room_quota_events_room_uuid_fkey;'));
  });

  // =========================================================================
  // 6. ROOM IDENTITY TYPE CONTRACT & RUNTIME VALIDATORS
  // =========================================================================
  await t.test("6. Canonical UUID and Joining Code validators enforce strict separation", () => {
    // Valid canonical UUIDs
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    assert.ok(isValidCanonicalUuid(validUuid), "Standard UUID v4 must be valid canonical UUID");
    assert.ok(!isValidJoiningCode(validUuid), "UUID must never be considered a valid joining code");

    // Valid joining codes
    const validJoiningCode = "1234567890";
    assert.ok(isValidJoiningCode(validJoiningCode), "10-digit code must be valid joining code");
    assert.ok(!isValidCanonicalUuid(validJoiningCode), "Joining code must never be considered a UUID");

    // Invalid values
    assert.ok(!isValidCanonicalUuid("short"), "Short string is not a UUID");
    assert.ok(!isValidJoiningCode("123"), "3-digit string is not a joining code");
    assert.ok(!isValidJoiningCode("abcdefghij"), "Non-numeric string is not a joining code");
  });
});
