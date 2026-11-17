-- ============================================================================
-- CoWatch WatchParty: Room Identity Architecture Migration (ROLLBACK / DOWN)
-- Migration File: sql/migrations/20261118_room_identity_architecture_down.sql
-- Baseline Commit: 7fd3cbb03578a5879cb0e89fe9301f0382fcec9c
-- Target System: PostgreSQL 14+ / Supabase Production Catalog
--
-- SAFETY & DATA PRESERVATION CONTRACT:
-- 1. Preserves all room data and relationships across all seven child tables.
-- 2. Idempotent & State-Aware: Executes cleanly from any stage (pre-cutover or post-cutover).
-- 3. Pre-Reconciliation: If new rooms or child records were created post-cutover,
--    it reconciles legacy "roomId" and room_id values before restoring legacy constraints.
-- 4. Re-establishes legacy foreign keys referencing rooms("roomId") using NOT VALID + VALIDATE.
-- 5. Performs atomic primary key restoration using RESTRICT (NO CASCADE).
-- 6. Detaches new triggers, procedures, and functions.
-- 7. Drops new concurrent indexes in autocommit mode.
-- 8. Safe Column Disposition: Drops NOT NULL constraints on new columns, preserving
--    data in place without destructive DROP COLUMN unless explicitly opted-in.
-- ============================================================================

-- ############################################################################
-- STAGE R1: RECONCILIATION & DATA PRESERVATION PRE-CHECKS
-- Execution: Transactional DDL & Data Reconciliation
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- R1.1 Populate legacy "roomId" for any rooms created post-cutover that may only have id/legacy_room_id
UPDATE public.rooms
SET "roomId" = COALESCE(legacy_room_id, id::text)
WHERE "roomId" IS NULL;

-- R1.2 Populate child table legacy room_id references for any rows created post-cutover
UPDATE public.room_admissions c
SET room_id = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c.room_id IS NULL;

UPDATE public.room_bans c
SET room_id = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c.room_id IS NULL;

UPDATE public.room_invitations c
SET room_id = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c.room_id IS NULL;

UPDATE public.room_lifecycle_events c
SET "roomId" = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c."roomId" IS NULL;

UPDATE public.room_media_sessions c
SET room_id = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c.room_id IS NULL;

UPDATE public.room_messages c
SET room_id = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c.room_id IS NULL;

UPDATE public.room_quota_events c
SET room_id = r."roomId"
FROM public.rooms r
WHERE c.room_uuid = r.id
  AND c.room_id IS NULL;

-- R1.3 Assert Zero NULLs and Zero Duplicates in "roomId" before restoring legacy PK
DO $$
DECLARE
  v_null_count bigint;
  v_dup_count bigint;
  v_orphaned_children bigint;
BEGIN
  -- Assert no NULLs in rooms."roomId"
  SELECT count(*) INTO v_null_count
  FROM public.rooms
  WHERE "roomId" IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Rollback halted: % rooms have NULL "roomId"', v_null_count
      USING ERRCODE = '22004';
  END IF;

  -- Assert no duplicates in rooms."roomId"
  SELECT count(*) INTO v_dup_count FROM (
    SELECT "roomId"
    FROM public.rooms
    GROUP BY "roomId"
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Rollback halted: % duplicate "roomId" values exist in public.rooms', v_dup_count
      USING ERRCODE = '23505';
  END IF;

  -- Assert child tables have zero orphaned legacy references
  SELECT (
    (SELECT count(*) FROM public.room_admissions a LEFT JOIN public.rooms r ON r."roomId" = a.room_id WHERE r."roomId" IS NULL) +
    (SELECT count(*) FROM public.room_bans b LEFT JOIN public.rooms r ON r."roomId" = b.room_id WHERE r."roomId" IS NULL) +
    (SELECT count(*) FROM public.room_invitations i LEFT JOIN public.rooms r ON r."roomId" = i.room_id WHERE r."roomId" IS NULL) +
    (SELECT count(*) FROM public.room_lifecycle_events l LEFT JOIN public.rooms r ON r."roomId" = l."roomId" WHERE r."roomId" IS NULL) +
    (SELECT count(*) FROM public.room_media_sessions m LEFT JOIN public.rooms r ON r."roomId" = m.room_id WHERE r."roomId" IS NULL) +
    (SELECT count(*) FROM public.room_messages msg LEFT JOIN public.rooms r ON r."roomId" = msg.room_id WHERE r."roomId" IS NULL) +
    (SELECT count(*) FROM public.room_quota_events q LEFT JOIN public.rooms r ON r."roomId" = q.room_id WHERE q.room_id IS NOT NULL AND r."roomId" IS NULL)
  ) INTO v_orphaned_children;

  IF v_orphaned_children > 0 THEN
    RAISE EXCEPTION 'Rollback halted: % orphaned child rows detected with unmapped legacy room_id', v_orphaned_children
      USING ERRCODE = '23503';
  END IF;
END $$;

COMMIT;

-- ############################################################################
-- STAGE R2: RE-ESTABLISH LEGACY FOREIGN KEYS (NOT VALID -> VALIDATE)
-- Execution: Non-blocking DDL
-- ############################################################################

-- R2.1 Add legacy foreign keys as NOT VALID if missing (e.g. if dropped in Stage 7)
DO $$
BEGIN
  -- 1. room_admissions
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_admissions_room_id_fkey') THEN
    ALTER TABLE public.room_admissions
      ADD CONSTRAINT room_admissions_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE NOT VALID;
  END IF;

  -- 2. room_bans
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_bans_room_id_fkey') THEN
    ALTER TABLE public.room_bans
      ADD CONSTRAINT room_bans_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE NOT VALID;
  END IF;

  -- 3. room_invitations
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_invitations_room_id_fkey') THEN
    ALTER TABLE public.room_invitations
      ADD CONSTRAINT room_invitations_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE NOT VALID;
  END IF;

  -- 4. room_lifecycle_events (quoted "roomId")
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_lifecycle_events_room_fk') THEN
    ALTER TABLE public.room_lifecycle_events
      ADD CONSTRAINT room_lifecycle_events_room_fk
      FOREIGN KEY ("roomId") REFERENCES public.rooms("roomId") ON DELETE CASCADE NOT VALID;
  END IF;

  -- 5. room_media_sessions
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_media_sessions_room_id_fkey') THEN
    ALTER TABLE public.room_media_sessions
      ADD CONSTRAINT room_media_sessions_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE NOT VALID;
  END IF;

  -- 6. room_messages
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_messages_room_id_fkey') THEN
    ALTER TABLE public.room_messages
      ADD CONSTRAINT room_messages_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE NOT VALID;
  END IF;

  -- 7. room_quota_events
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_quota_events_room_id_fkey') THEN
    ALTER TABLE public.room_quota_events
      ADD CONSTRAINT room_quota_events_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- R2.2 Validate all legacy foreign key constraints
ALTER TABLE public.room_admissions VALIDATE CONSTRAINT room_admissions_room_id_fkey;
ALTER TABLE public.room_bans VALIDATE CONSTRAINT room_bans_room_id_fkey;
ALTER TABLE public.room_invitations VALIDATE CONSTRAINT room_invitations_room_id_fkey;
ALTER TABLE public.room_lifecycle_events VALIDATE CONSTRAINT room_lifecycle_events_room_fk;
ALTER TABLE public.room_media_sessions VALIDATE CONSTRAINT room_media_sessions_room_id_fkey;
ALTER TABLE public.room_messages VALIDATE CONSTRAINT room_messages_room_id_fkey;
ALTER TABLE public.room_quota_events VALIDATE CONSTRAINT room_quota_events_room_id_fkey;

-- ############################################################################
-- STAGE R3: ATOMIC PRIMARY KEY & REPLACEMENT FOREIGN KEY ROLLBACK
-- Execution: Single Fast Atomic Transaction (RESTRICT, NO CASCADE)
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '2s';

-- 1. Drop the 7 replacement foreign keys explicitly
ALTER TABLE public.room_admissions DROP CONSTRAINT IF EXISTS room_admissions_room_uuid_fkey;
ALTER TABLE public.room_bans DROP CONSTRAINT IF EXISTS room_bans_room_uuid_fkey;
ALTER TABLE public.room_invitations DROP CONSTRAINT IF EXISTS room_invitations_room_uuid_fkey;
ALTER TABLE public.room_lifecycle_events DROP CONSTRAINT IF EXISTS room_lifecycle_events_room_uuid_fkey;
ALTER TABLE public.room_media_sessions DROP CONSTRAINT IF EXISTS room_media_sessions_room_uuid_fkey;
ALTER TABLE public.room_messages DROP CONSTRAINT IF EXISTS room_messages_room_uuid_fkey;
ALTER TABLE public.room_quota_events DROP CONSTRAINT IF EXISTS room_quota_events_room_uuid_fkey;

-- 2. Drop unique constraints on candidate handles
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS uq_rooms_joining_id;
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS uq_rooms_legacy_room_id;

-- 3. Restore legacy primary key on "roomId" if cutover executed
DO $$
DECLARE
  v_pk_attname text;
BEGIN
  SELECT a.attname INTO v_pk_attname
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.rooms'::regclass
    AND c.contype = 'p';

  IF v_pk_attname = 'id' THEN
    ALTER TABLE public.rooms DROP CONSTRAINT room_pkey;
    ALTER TABLE public.rooms ADD CONSTRAINT room_pkey PRIMARY KEY ("roomId");
  END IF;
END $$;

COMMIT;

-- ############################################################################
-- STAGE R4: DETACH SYNCHRONIZATION TRIGGERS & PROCEDURES
-- Execution: Transactional DDL
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '2s';

-- R4.1 Drop child synchronization triggers
DROP TRIGGER IF EXISTS trg_sync_room_admissions_uuid ON public.room_admissions;
DROP TRIGGER IF EXISTS trg_sync_room_bans_uuid ON public.room_bans;
DROP TRIGGER IF EXISTS trg_sync_room_invitations_uuid ON public.room_invitations;
DROP TRIGGER IF EXISTS trg_sync_room_lifecycle_events_uuid ON public.room_lifecycle_events;
DROP TRIGGER IF EXISTS trg_sync_room_media_sessions_uuid ON public.room_media_sessions;
DROP TRIGGER IF EXISTS trg_sync_room_messages_uuid ON public.room_messages;
DROP TRIGGER IF EXISTS trg_sync_room_quota_events_uuid ON public.room_quota_events;

-- R4.2 Drop parent identity trigger
DROP TRIGGER IF EXISTS trg_sync_room_identities ON public.rooms;

-- R4.3 Drop synchronization and allocation functions
DROP FUNCTION IF EXISTS public.sync_room_quota_events_uuid_trigger();
DROP FUNCTION IF EXISTS public.sync_room_lifecycle_events_uuid_trigger();
DROP FUNCTION IF EXISTS public.sync_child_room_uuid_trigger();
DROP FUNCTION IF EXISTS public.sync_room_identities_trigger();
DROP FUNCTION IF EXISTS public.allocate_room_joining_id();
DROP FUNCTION IF EXISTS public.claim_explicit_joining_id(text);
DROP FUNCTION IF EXISTS public.assert_read_committed_isolation();
DROP FUNCTION IF EXISTS public.cowatch_advisory_lock_key(smallint, bigint);

-- R4.4 Drop backfill stored procedures
DROP PROCEDURE IF EXISTS public.backfill_all_child_tables(integer);
DROP PROCEDURE IF EXISTS public.backfill_child_table_room_uuid(text, integer);
DROP PROCEDURE IF EXISTS public.backfill_rooms_identity(integer);

-- R4.5 Drop temporary check constraints from Stage 6 if any remain
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS chk_rooms_id_not_null;
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS chk_rooms_joining_id_not_null;
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS chk_rooms_legacy_room_id_not_null;
ALTER TABLE public.room_admissions DROP CONSTRAINT IF EXISTS chk_admissions_uuid_not_null;
ALTER TABLE public.room_bans DROP CONSTRAINT IF EXISTS chk_bans_uuid_not_null;
ALTER TABLE public.room_invitations DROP CONSTRAINT IF EXISTS chk_invitations_uuid_not_null;
ALTER TABLE public.room_lifecycle_events DROP CONSTRAINT IF EXISTS chk_lifecycle_uuid_not_null;
ALTER TABLE public.room_media_sessions DROP CONSTRAINT IF EXISTS chk_media_uuid_not_null;
ALTER TABLE public.room_messages DROP CONSTRAINT IF EXISTS chk_messages_uuid_not_null;

COMMIT;

-- ############################################################################
-- STAGE R5: DROP NEW INDEXES CONCURRENTLY
-- Execution: Non-transactional / Autocommit mode
-- ############################################################################

DROP INDEX CONCURRENTLY IF EXISTS public.idx_rooms_id_unique;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_rooms_legacy_room_id_unique;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_rooms_joining_id_unique;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_admissions_room_uuid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_bans_room_uuid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_invitations_room_uuid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_lifecycle_events_room_uuid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_media_sessions_room_uuid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_messages_room_uuid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_room_quota_events_room_uuid;

-- ############################################################################
-- STAGE R6: SAFE COLUMN DISPOSITION & CHECKPOINT PURGE
-- Execution: Transactional DDL
-- Policy: Drops NOT NULL constraints so the application runs smoothly on legacy
--         monikers. Retains columns in place to prevent accidental data loss.
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '2s';

-- R6.1 Relax NOT NULL constraints on new columns so live legacy inserts succeed
ALTER TABLE public.rooms
  ALTER COLUMN id DROP NOT NULL,
  ALTER COLUMN joining_id DROP NOT NULL,
  ALTER COLUMN legacy_room_id DROP NOT NULL;

ALTER TABLE public.room_admissions
  ALTER COLUMN room_uuid DROP NOT NULL;

ALTER TABLE public.room_bans
  ALTER COLUMN room_uuid DROP NOT NULL;

ALTER TABLE public.room_invitations
  ALTER COLUMN room_uuid DROP NOT NULL;

ALTER TABLE public.room_lifecycle_events
  ALTER COLUMN room_uuid DROP NOT NULL;

ALTER TABLE public.room_media_sessions
  ALTER COLUMN room_uuid DROP NOT NULL;

ALTER TABLE public.room_messages
  ALTER COLUMN room_uuid DROP NOT NULL;

-- R6.2 Reset migration checkpoint table
DROP TABLE IF EXISTS public.room_migration_checkpoint;

COMMIT;
