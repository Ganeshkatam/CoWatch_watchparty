-- ============================================================================
-- CoWatch WatchParty: Room Identity Architecture Migration (FORWARD)
-- Migration File: sql/migrations/20261118_room_identity_architecture_up.sql
-- Baseline Commit: 7fd3cbb03578a5879cb0e89fe9301f0382fcec9c
-- Target System: PostgreSQL 14+ / Supabase Production Catalog
--
-- STRUCTURE (SEVEN DISCRETE STAGES):
-- Stage 1: Add nullable identity columns & migration checkpoint table
-- Stage 2: Advisory-lock helpers, ID allocation, parent & 7 child triggers
-- Stage 3: Concurrent unique indexes (Autocommit / non-transactional)
-- Stage 4: Resumable parent-room keyset backfill & completion barrier
-- Stage 5: Resumable child-tables keyset backfill & completion barriers
-- Stage 6: Constraint pre-validation (CHECK NOT NULL & NOT VALID FKs)
-- Stage 7: Atomic primary-key & foreign-key cutover (RESTRICT, NO CASCADE)
-- ============================================================================

-- ############################################################################
-- STAGE 1: ADD NULLABLE IDENTITY COLUMNS & MIGRATION CHECKPOINT TABLE
-- Execution: Transactional DDL
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- 1.1 Add nullable identity columns to public.rooms
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS joining_id text,
  ADD COLUMN IF NOT EXISTS legacy_room_id text;

-- 1.2 Add nullable room_uuid columns to all seven child tables
ALTER TABLE public.room_admissions
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

ALTER TABLE public.room_bans
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

ALTER TABLE public.room_invitations
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

ALTER TABLE public.room_lifecycle_events
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

ALTER TABLE public.room_media_sessions
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

ALTER TABLE public.room_messages
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

ALTER TABLE public.room_quota_events
  ADD COLUMN IF NOT EXISTS room_uuid uuid;

-- 1.3 Create durable migration checkpoint table
CREATE TABLE IF NOT EXISTS public.room_migration_checkpoint (
  target_table text PRIMARY KEY,
  last_processed_id text,
  batch_size integer DEFAULT 1000 NOT NULL,
  total_rows_processed bigint DEFAULT 0 NOT NULL,
  trailing_reconciliation_count integer DEFAULT 0 NOT NULL,
  is_completed boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  completed_at timestamptz,
  final_verified_row_count bigint
);

-- 1.4 Seed initial checkpoint records for rooms and all seven child tables
INSERT INTO public.room_migration_checkpoint (target_table, batch_size)
VALUES
  ('public.rooms', 1000),
  ('public.room_admissions', 1000),
  ('public.room_bans', 1000),
  ('public.room_invitations', 1000),
  ('public.room_lifecycle_events', 1000),
  ('public.room_media_sessions', 1000),
  ('public.room_messages', 1000),
  ('public.room_quota_events', 1000)
ON CONFLICT (target_table) DO NOTHING;

-- 1.5 Lock down checkpoint table permissions
REVOKE ALL ON TABLE public.room_migration_checkpoint FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.room_migration_checkpoint TO postgres, service_role;

COMMIT;

-- ############################################################################
-- STAGE 2: ADVISORY-LOCK HELPERS, ID ALLOCATION & SYNCHRONIZATION TRIGGERS
-- Execution: Transactional DDL
-- ############################################################################

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- 2.1 Advisory-Lock Key Derivation Helper (Domain 2: Room Joining-ID Allocation)
-- 64-bit layout: bit 63 = 0, bits 56..62 = Domain (1..127), bits 0..55 = Payload (0..2^56-1)
CREATE OR REPLACE FUNCTION public.cowatch_advisory_lock_key(
  p_domain smallint,
  p_payload bigint
)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_domain IS NULL OR p_payload IS NULL THEN
    RAISE EXCEPTION 'Domain and payload must not be NULL' USING ERRCODE = '22004';
  END IF;

  IF p_domain < 1 OR p_domain > 127 THEN
    RAISE EXCEPTION 'Domain % out of valid range [1, 127]', p_domain USING ERRCODE = '22023';
  END IF;

  IF p_payload < 0 OR p_payload > 72057594037927935 THEN
    RAISE EXCEPTION 'Payload % out of valid range [0, 2^56 - 1]', p_payload USING ERRCODE = '22023';
  END IF;

  RETURN ((p_domain::bigint << 56) | p_payload);
END;
$$;

-- 2.2 Universal Isolation Guard
CREATE OR REPLACE FUNCTION public.assert_read_committed_isolation()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_iso text;
BEGIN
  v_iso := current_setting('transaction_isolation');
  IF v_iso IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'CoWatch joining-ID allocation requires READ COMMITTED isolation (current: %)', v_iso
      USING ERRCODE = '25000';
  END IF;
END;
$$;

-- 2.3 Explicit Joining-ID Claim Routine (Scoped Timeout Restoration Across All Exits)
CREATE OR REPLACE FUNCTION public.claim_explicit_joining_id(
  p_joining_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_num bigint;
  v_lock_key bigint;
  v_orig_lock_timeout text;
BEGIN
  IF p_joining_id IS NULL OR p_joining_id !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'Invalid joining ID format: %. Must be exactly 10 digits.', p_joining_id
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_read_committed_isolation();

  v_candidate_num := p_joining_id::bigint;
  v_lock_key := public.cowatch_advisory_lock_key(2::smallint, v_candidate_num);
  v_orig_lock_timeout := current_setting('lock_timeout');

  BEGIN
    PERFORM set_config('lock_timeout', '2s', true);
    PERFORM pg_advisory_xact_lock(v_lock_key);
    PERFORM set_config('lock_timeout', v_orig_lock_timeout, true);
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected OR query_canceled OR OTHERS THEN
      PERFORM set_config('lock_timeout', v_orig_lock_timeout, true);
      RAISE;
  END;

  IF EXISTS (SELECT 1 FROM public.rooms WHERE joining_id = p_joining_id) THEN
    RAISE EXCEPTION 'Joining ID % is already assigned to an existing room', p_joining_id
      USING ERRCODE = '23505';
  END IF;
END;
$$;

-- 2.4 Cryptographic Rejection-Sampling Joining-ID Allocation Routine
CREATE OR REPLACE FUNCTION public.allocate_room_joining_id()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_bytes bytea;
  v_raw_val bigint;
  v_candidate_num bigint;
  v_candidate_str text;
  v_lock_key bigint;
  v_orig_lock_timeout text;
  v_attempts integer := 0;
BEGIN
  PERFORM public.assert_read_committed_isolation();

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 100 THEN
      RAISE EXCEPTION 'Failed to allocate unique joining_id after 100 attempts'
        USING ERRCODE = '54000';
    END IF;

    -- Cryptographically secure 5-byte sample: Range [0, 2^40 - 1] = [0, 1,099,511,627,775]
    v_bytes := gen_random_bytes(5);
    v_raw_val := ((get_byte(v_bytes, 0)::bigint << 32) |
                  (get_byte(v_bytes, 1)::bigint << 24) |
                  (get_byte(v_bytes, 2)::bigint << 16) |
                  (get_byte(v_bytes, 3)::bigint << 8)  |
                  (get_byte(v_bytes, 4)::bigint));

    -- Rejection sampling threshold: L = 109 * 10^10 = 1,090,000,000,000
    IF v_raw_val < 1090000000000 THEN
      v_candidate_num := v_raw_val % 10000000000;
      v_candidate_str := lpad(v_candidate_num::text, 10, '0');

      v_lock_key := public.cowatch_advisory_lock_key(2::smallint, v_candidate_num);
      v_orig_lock_timeout := current_setting('lock_timeout');

      BEGIN
        PERFORM set_config('lock_timeout', '2s', true);
        PERFORM pg_advisory_xact_lock(v_lock_key);
        PERFORM set_config('lock_timeout', v_orig_lock_timeout, true);
      EXCEPTION
        WHEN lock_not_available OR deadlock_detected OR query_canceled OR OTHERS THEN
          PERFORM set_config('lock_timeout', v_orig_lock_timeout, true);
          RAISE;
      END;

      IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE joining_id = v_candidate_str) THEN
        RETURN v_candidate_str;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 2.5 Parent Table Identity Synchronization Trigger
CREATE OR REPLACE FUNCTION public.sync_room_identities_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- --------------------------------------------------------------------------
  -- INSERT PATH
  -- --------------------------------------------------------------------------
  IF TG_OP = 'INSERT' THEN
    -- Assign canonical UUID v4 if not explicitly provided
    IF NEW.id IS NULL THEN
      NEW.id := gen_random_uuid();
    END IF;

    -- Synchronize legacy moniker alias
    IF NEW.legacy_room_id IS NULL AND NEW."roomId" IS NOT NULL THEN
      NEW.legacy_room_id := NEW."roomId";
    ELSIF NEW."roomId" IS NULL AND NEW.legacy_room_id IS NOT NULL THEN
      NEW."roomId" := NEW.legacy_room_id;
    END IF;

    -- Allocate or claim 10-digit joining ID
    IF NEW.joining_id IS NULL THEN
      NEW.joining_id := public.allocate_room_joining_id();
    ELSE
      PERFORM public.claim_explicit_joining_id(NEW.joining_id);
    END IF;

    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------------
  -- UPDATE PATH
  -- --------------------------------------------------------------------------
  IF TG_OP = 'UPDATE' THEN
    -- FAST PATH: If identity fields are unmodified, return immediately with zero locking
    IF NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.joining_id IS NOT DISTINCT FROM OLD.joining_id
       AND NEW.legacy_room_id IS NOT DISTINCT FROM OLD.legacy_room_id
       AND NEW."roomId" IS NOT DISTINCT FROM OLD."roomId" THEN
      RETURN NEW;
    END IF;

    -- STRICT IMMUTABILITY ENFORCEMENT for previously assigned identities
    IF OLD.id IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Room UUID (id) is immutable once assigned' USING ERRCODE = '23514';
    END IF;

    IF OLD.joining_id IS NOT NULL AND NEW.joining_id IS DISTINCT FROM OLD.joining_id THEN
      RAISE EXCEPTION 'Room joining_id is immutable once assigned' USING ERRCODE = '23514';
    END IF;

    IF OLD.legacy_room_id IS NOT NULL AND NEW.legacy_room_id IS DISTINCT FROM OLD.legacy_room_id THEN
      RAISE EXCEPTION 'Room legacy_room_id is immutable once assigned' USING ERRCODE = '23514';
    END IF;

    IF OLD."roomId" IS NOT NULL AND NEW."roomId" IS DISTINCT FROM OLD."roomId" THEN
      RAISE EXCEPTION 'Room "roomId" is immutable once assigned' USING ERRCODE = '23514';
    END IF;

    -- INITIAL ASSIGNMENT (Transition from NULL to populated value during backfill/reconciliation)
    IF OLD.id IS NULL AND NEW.id IS NULL THEN
      NEW.id := gen_random_uuid();
    END IF;

    IF OLD.legacy_room_id IS NULL AND NEW.legacy_room_id IS NULL THEN
      NEW.legacy_room_id := COALESCE(NEW."roomId", OLD."roomId");
    END IF;

    -- If joining_id transitioning from NULL to explicit value, validate and claim under advisory lock
    IF OLD.joining_id IS NULL AND NEW.joining_id IS NOT NULL THEN
      PERFORM public.claim_explicit_joining_id(NEW.joining_id);
    END IF;
    -- Note: If OLD.joining_id IS NULL and NEW.joining_id IS NULL, UPDATE does NOT auto-allocate;
    -- it remains NULL until explicitly backfilled or assigned.

    -- Maintain bidirectional moniker consistency
    IF NEW.legacy_room_id IS NOT NULL AND NEW."roomId" IS NULL THEN
      NEW."roomId" := NEW.legacy_room_id;
    ELSIF NEW."roomId" IS NOT NULL AND NEW.legacy_room_id IS NULL THEN
      NEW.legacy_room_id := NEW."roomId";
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_room_identities ON public.rooms;
CREATE TRIGGER trg_sync_room_identities
  BEFORE INSERT OR UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_room_identities_trigger();

-- 2.6 Child Table Dual-Write Synchronization Triggers (Standard room_id tables)
CREATE OR REPLACE FUNCTION public.sync_child_room_uuid_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_uuid uuid;
  v_legacy_id text;
BEGIN
  -- FAST PATH: Unmodified identity fields on UPDATE
  IF TG_OP = 'UPDATE' THEN
    IF NEW.room_id IS NOT DISTINCT FROM OLD.room_id
       AND NEW.room_uuid IS NOT DISTINCT FROM OLD.room_uuid THEN
      RETURN NEW;
    END IF;

    -- Immutability: child records cannot be reassigned across rooms
    IF OLD.room_uuid IS NOT NULL AND NEW.room_uuid IS DISTINCT FROM OLD.room_uuid THEN
      RAISE EXCEPTION 'Child room_uuid reference is immutable once assigned' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Case 1: room_id provided, room_uuid is NULL
  IF NEW.room_id IS NOT NULL AND NEW.room_uuid IS NULL THEN
    SELECT id INTO v_room_uuid
    FROM public.rooms
    WHERE "roomId" = NEW.room_id OR legacy_room_id = NEW.room_id;

    IF v_room_uuid IS NOT NULL THEN
      NEW.room_uuid := v_room_uuid;
    END IF;
    -- If parent not found, allow execution to proceed to FK validation which raises 23503

  -- Case 2: room_uuid provided, room_id is NULL
  ELSIF NEW.room_uuid IS NOT NULL AND NEW.room_id IS NULL THEN
    SELECT "roomId" INTO v_legacy_id
    FROM public.rooms
    WHERE id = NEW.room_uuid;

    IF v_legacy_id IS NOT NULL THEN
      NEW.room_id := v_legacy_id;
    END IF;

  -- Case 3: Both provided - verify consistency
  ELSIF NEW.room_id IS NOT NULL AND NEW.room_uuid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.rooms
      WHERE id = NEW.room_uuid AND ("roomId" = NEW.room_id OR legacy_room_id = NEW.room_id)
    ) THEN
      RAISE EXCEPTION 'Conflicting room identities provided: room_id=%, room_uuid=%', NEW.room_id, NEW.room_uuid
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2.7 Child Table Synchronization Trigger (Specialized for room_lifecycle_events with quoted "roomId")
CREATE OR REPLACE FUNCTION public.sync_room_lifecycle_events_uuid_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_uuid uuid;
  v_legacy_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."roomId" IS NOT DISTINCT FROM OLD."roomId"
       AND NEW.room_uuid IS NOT DISTINCT FROM OLD.room_uuid THEN
      RETURN NEW;
    END IF;

    IF OLD.room_uuid IS NOT NULL AND NEW.room_uuid IS DISTINCT FROM OLD.room_uuid THEN
      RAISE EXCEPTION 'room_lifecycle_events room_uuid reference is immutable once assigned' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."roomId" IS NOT NULL AND NEW.room_uuid IS NULL THEN
    SELECT id INTO v_room_uuid
    FROM public.rooms
    WHERE "roomId" = NEW."roomId" OR legacy_room_id = NEW."roomId";

    IF v_room_uuid IS NOT NULL THEN
      NEW.room_uuid := v_room_uuid;
    END IF;

  ELSIF NEW.room_uuid IS NOT NULL AND NEW."roomId" IS NULL THEN
    SELECT "roomId" INTO v_legacy_id
    FROM public.rooms
    WHERE id = NEW.room_uuid;

    IF v_legacy_id IS NOT NULL THEN
      NEW."roomId" := v_legacy_id;
    END IF;

  ELSIF NEW."roomId" IS NOT NULL AND NEW.room_uuid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.rooms
      WHERE id = NEW.room_uuid AND ("roomId" = NEW."roomId" OR legacy_room_id = NEW."roomId")
    ) THEN
      RAISE EXCEPTION 'Conflicting room identities in room_lifecycle_events: "roomId"=%, room_uuid=%', NEW."roomId", NEW.room_uuid
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2.8 Child Table Synchronization Trigger (Specialized for room_quota_events with nullable room_id)
CREATE OR REPLACE FUNCTION public.sync_room_quota_events_uuid_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_uuid uuid;
  v_legacy_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.room_id IS NOT DISTINCT FROM OLD.room_id
       AND NEW.room_uuid IS NOT DISTINCT FROM OLD.room_uuid THEN
      RETURN NEW;
    END IF;
  END IF;

  -- If both are NULL, allow (quota event not tied to a specific room)
  IF NEW.room_id IS NULL AND NEW.room_uuid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.room_id IS NOT NULL AND NEW.room_uuid IS NULL THEN
    SELECT id INTO v_room_uuid
    FROM public.rooms
    WHERE "roomId" = NEW.room_id OR legacy_room_id = NEW.room_id;

    IF v_room_uuid IS NOT NULL THEN
      NEW.room_uuid := v_room_uuid;
    END IF;

  ELSIF NEW.room_uuid IS NOT NULL AND NEW.room_id IS NULL THEN
    SELECT "roomId" INTO v_legacy_id
    FROM public.rooms
    WHERE id = NEW.room_uuid;

    IF v_legacy_id IS NOT NULL THEN
      NEW.room_id := v_legacy_id;
    END IF;

  ELSIF NEW.room_id IS NOT NULL AND NEW.room_uuid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.rooms
      WHERE id = NEW.room_uuid AND ("roomId" = NEW.room_id OR legacy_room_id = NEW.room_id)
    ) THEN
      RAISE EXCEPTION 'Conflicting room identities in room_quota_events: room_id=%, room_uuid=%', NEW.room_id, NEW.room_uuid
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2.9 Attach dual-write synchronization triggers to all seven child tables
DROP TRIGGER IF EXISTS trg_sync_room_admissions_uuid ON public.room_admissions;
CREATE TRIGGER trg_sync_room_admissions_uuid
  BEFORE INSERT OR UPDATE ON public.room_admissions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

DROP TRIGGER IF EXISTS trg_sync_room_bans_uuid ON public.room_bans;
CREATE TRIGGER trg_sync_room_bans_uuid
  BEFORE INSERT OR UPDATE ON public.room_bans
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

DROP TRIGGER IF EXISTS trg_sync_room_invitations_uuid ON public.room_invitations;
CREATE TRIGGER trg_sync_room_invitations_uuid
  BEFORE INSERT OR UPDATE ON public.room_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

DROP TRIGGER IF EXISTS trg_sync_room_lifecycle_events_uuid ON public.room_lifecycle_events;
CREATE TRIGGER trg_sync_room_lifecycle_events_uuid
  BEFORE INSERT OR UPDATE ON public.room_lifecycle_events
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_room_lifecycle_events_uuid_trigger();

DROP TRIGGER IF EXISTS trg_sync_room_media_sessions_uuid ON public.room_media_sessions;
CREATE TRIGGER trg_sync_room_media_sessions_uuid
  BEFORE INSERT OR UPDATE ON public.room_media_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

DROP TRIGGER IF EXISTS trg_sync_room_messages_uuid ON public.room_messages;
CREATE TRIGGER trg_sync_room_messages_uuid
  BEFORE INSERT OR UPDATE ON public.room_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

DROP TRIGGER IF EXISTS trg_sync_room_quota_events_uuid ON public.room_quota_events;
CREATE TRIGGER trg_sync_room_quota_events_uuid
  BEFORE INSERT OR UPDATE ON public.room_quota_events
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_room_quota_events_uuid_trigger();

-- 2.10 Permissions: Revoke public execution, grant service_role and postgres
REVOKE ALL ON FUNCTION public.cowatch_advisory_lock_key(smallint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cowatch_advisory_lock_key(smallint, bigint) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.assert_read_committed_isolation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_read_committed_isolation() TO postgres, service_role;

REVOKE ALL ON FUNCTION public.claim_explicit_joining_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_explicit_joining_id(text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.allocate_room_joining_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_room_joining_id() TO postgres, service_role;

COMMIT;

-- ############################################################################
-- STAGE 3: CONCURRENT UNIQUE INDEXES
-- Execution: Non-transactional / Autocommit mode
-- Note: CREATE INDEX CONCURRENTLY cannot execute inside a multi-statement transaction.
-- ############################################################################

-- 3.1 Parent Table Unique Indexes (Full unique index permits multiple NULLs during migration)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_id_unique
  ON public.rooms (id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_legacy_room_id_unique
  ON public.rooms (legacy_room_id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_joining_id_unique
  ON public.rooms (joining_id);

-- 3.2 Child Table Foreign-Key Backing Indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_admissions_room_uuid
  ON public.room_admissions (room_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_bans_room_uuid
  ON public.room_bans (room_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_invitations_room_uuid
  ON public.room_invitations (room_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_lifecycle_events_room_uuid
  ON public.room_lifecycle_events (room_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_media_sessions_room_uuid
  ON public.room_media_sessions (room_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_messages_room_uuid
  ON public.room_messages (room_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_quota_events_room_uuid
  ON public.room_quota_events (room_uuid);

-- 3.3 Trinary Index Validation & Cleanup Routine
DO $$
DECLARE
  v_rec record;
  v_is_valid boolean;
  v_is_ready boolean;
  v_is_unique boolean;
  v_has_pred boolean;
BEGIN
  FOR v_rec IN
    SELECT unnest(ARRAY[
      'idx_rooms_id_unique',
      'idx_rooms_legacy_room_id_unique',
      'idx_rooms_joining_id_unique',
      'idx_room_admissions_room_uuid',
      'idx_room_bans_room_uuid',
      'idx_room_invitations_room_uuid',
      'idx_room_lifecycle_events_room_uuid',
      'idx_room_media_sessions_room_uuid',
      'idx_room_messages_room_uuid',
      'idx_room_quota_events_room_uuid'
    ]) AS index_name
  LOOP
    SELECT i.indisvalid, i.indisready, i.indisunique, (i.indpred IS NOT NULL)
    INTO v_is_valid, v_is_ready, v_is_unique, v_has_pred
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_rec.index_name;

    IF v_is_valid IS NULL THEN
      RAISE EXCEPTION 'Index % was not created successfully', v_rec.index_name USING ERRCODE = '42704';
    ELSIF v_is_valid = false OR v_is_ready = false THEN
      RAISE EXCEPTION 'Index % is marked INVALID in system catalog. Drop concurrently and rebuild.', v_rec.index_name USING ERRCODE = '55000';
    ELSIF v_rec.index_name LIKE '%_unique' AND (v_is_unique = false OR v_has_pred = true) THEN
      RAISE EXCEPTION 'Index % failed unique or non-partial invariant', v_rec.index_name USING ERRCODE = '42809';
    END IF;
  END LOOP;
END $$;

-- ############################################################################
-- STAGE 4: RESUMABLE PARENT-ROOM KEYSET BACKFILL & COMPLETION BARRIER
-- Execution: Procedural Batches with Transactional Barrier
-- ############################################################################

CREATE OR REPLACE PROCEDURE public.backfill_rooms_identity(
  p_batch_size integer DEFAULT 1000
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_last_id text;
  v_batch_count integer;
  v_batch_max_id text;
  v_room_rec record;
  v_new_id uuid;
  v_new_joining text;
  v_unpopulated_count bigint;
BEGIN
  -- Retrieve checkpoint cursor
  SELECT last_processed_id INTO v_last_id
  FROM public.room_migration_checkpoint
  WHERE target_table = 'public.rooms';

  -- PHASE 1: Forward Keyset Cursor Batches
  LOOP
    v_batch_count := 0;
    v_batch_max_id := NULL;

    FOR v_room_rec IN
      SELECT "roomId", id, joining_id, legacy_room_id
      FROM public.rooms
      WHERE (v_last_id IS NULL OR "roomId" > v_last_id)
      ORDER BY "roomId" ASC
      LIMIT p_batch_size
    LOOP
      v_batch_count := v_batch_count + 1;
      v_batch_max_id := v_room_rec."roomId";

      -- Compute identities if missing
      v_new_id := COALESCE(v_room_rec.id, gen_random_uuid());
      v_new_joining := v_room_rec.joining_id;
      IF v_new_joining IS NULL THEN
        v_new_joining := public.allocate_room_joining_id();
      END IF;

      UPDATE public.rooms
      SET id = v_new_id,
          legacy_room_id = COALESCE(legacy_room_id, "roomId"),
          joining_id = v_new_joining
      WHERE "roomId" = v_room_rec."roomId";
    END LOOP;

    EXIT WHEN v_batch_count = 0;

    v_last_id := v_batch_max_id;
    UPDATE public.room_migration_checkpoint
    SET last_processed_id = v_last_id,
        total_rows_processed = total_rows_processed + v_batch_count,
        updated_at = clock_timestamp()
    WHERE target_table = 'public.rooms';
  END LOOP;

  -- PHASE 2: Unconstrained Trailing Reconciliation Sweep (zero lower bound)
  LOOP
    v_batch_count := 0;

    FOR v_room_rec IN
      SELECT "roomId", id, joining_id, legacy_room_id
      FROM public.rooms
      WHERE id IS NULL OR joining_id IS NULL OR legacy_room_id IS NULL
      ORDER BY "roomId" ASC
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    LOOP
      v_batch_count := v_batch_count + 1;

      v_new_id := COALESCE(v_room_rec.id, gen_random_uuid());
      v_new_joining := v_room_rec.joining_id;
      IF v_new_joining IS NULL THEN
        v_new_joining := public.allocate_room_joining_id();
      END IF;

      UPDATE public.rooms
      SET id = v_new_id,
          legacy_room_id = COALESCE(legacy_room_id, "roomId"),
          joining_id = v_new_joining
      WHERE "roomId" = v_room_rec."roomId";
    END LOOP;

    EXIT WHEN v_batch_count = 0;

    UPDATE public.room_migration_checkpoint
    SET total_rows_processed = total_rows_processed + v_batch_count,
        trailing_reconciliation_count = trailing_reconciliation_count + 1,
        updated_at = clock_timestamp()
    WHERE target_table = 'public.rooms';
  END LOOP;

  -- PHASE 3: Transactional Completion Barrier
  -- Acquire SHARE ROW EXCLUSIVE lock (Permits concurrent SELECT, blocks concurrent INSERT/UPDATE/DELETE)
  SET LOCAL lock_timeout = '2s';
  LOCK TABLE public.rooms IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_unpopulated_count
  FROM public.rooms
  WHERE id IS NULL OR joining_id IS NULL OR legacy_room_id IS NULL;

  IF v_unpopulated_count > 0 THEN
    RAISE EXCEPTION 'Completion barrier failed: % unpopulated rooms remain under exclusive lock', v_unpopulated_count
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.room_migration_checkpoint
  SET is_completed = true,
      completed_at = clock_timestamp(),
      final_verified_row_count = (SELECT count(*) FROM public.rooms),
      updated_at = clock_timestamp()
  WHERE target_table = 'public.rooms';
END;
$$;

-- Revoke public execution, grant service_role and postgres
REVOKE ALL ON PROCEDURE public.backfill_rooms_identity(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.backfill_rooms_identity(integer) TO postgres, service_role;

-- 4.4 Execute parent-room backfill immediately to completion
CALL public.backfill_rooms_identity(1000);

-- ############################################################################
-- STAGE 5: RESUMABLE CHILD-TABLES KEYSET BACKFILL & COMPLETION BARRIERS
-- Execution: Procedural Batches with Transactional Barrier
-- ############################################################################

CREATE OR REPLACE PROCEDURE public.backfill_child_table_room_uuid(
  p_child_table text,
  p_batch_size integer DEFAULT 1000
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_last_uuid text;
  v_batch_count integer;
  v_batch_max_id text;
  v_unpopulated_count bigint;
BEGIN
  SELECT last_processed_id INTO v_last_uuid
  FROM public.room_migration_checkpoint
  WHERE target_table = p_child_table;

  -- Keyset cursor batch updates
  LOOP
    v_batch_count := 0;

    -- Dynamic execution tailored to child table schema
    IF p_child_table = 'public.room_lifecycle_events' THEN
      WITH batch AS (
        SELECT c.id AS pk, r.id AS parent_uuid
        FROM public.room_lifecycle_events c
        JOIN public.rooms r ON r."roomId" = c."roomId" OR r.legacy_room_id = c."roomId"
        WHERE (v_last_uuid IS NULL OR c.id > v_last_uuid::uuid)
          AND c.room_uuid IS NULL
        ORDER BY c.id ASC
        LIMIT p_batch_size
      ),
      updated AS (
        UPDATE public.room_lifecycle_events t
        SET room_uuid = b.parent_uuid
        FROM batch b
        WHERE t.id = b.pk
        RETURNING t.id
      )
      SELECT count(*), (SELECT id::text FROM updated ORDER BY id DESC LIMIT 1) INTO v_batch_count, v_batch_max_id FROM updated;

    ELSIF p_child_table = 'public.room_media_sessions' THEN
      WITH batch AS (
        SELECT c.media_id AS pk, r.id AS parent_uuid
        FROM public.room_media_sessions c
        JOIN public.rooms r ON r."roomId" = c.room_id OR r.legacy_room_id = c.room_id
        WHERE (v_last_uuid IS NULL OR c.media_id > v_last_uuid::uuid)
          AND c.room_uuid IS NULL
        ORDER BY c.media_id ASC
        LIMIT p_batch_size
      ),
      updated AS (
        UPDATE public.room_media_sessions t
        SET room_uuid = b.parent_uuid
        FROM batch b
        WHERE t.media_id = b.pk
        RETURNING t.media_id
      )
      SELECT count(*), (SELECT media_id::text FROM updated ORDER BY media_id DESC LIMIT 1) INTO v_batch_count, v_batch_max_id FROM updated;

    ELSIF p_child_table = 'public.room_quota_events' THEN
      WITH batch AS (
        SELECT c.id AS pk, r.id AS parent_uuid
        FROM public.room_quota_events c
        JOIN public.rooms r ON r."roomId" = c.room_id OR r.legacy_room_id = c.room_id
        WHERE (v_last_uuid IS NULL OR c.id > v_last_uuid::uuid)
          AND c.room_id IS NOT NULL
          AND c.room_uuid IS NULL
        ORDER BY c.id ASC
        LIMIT p_batch_size
      ),
      updated AS (
        UPDATE public.room_quota_events t
        SET room_uuid = b.parent_uuid
        FROM batch b
        WHERE t.id = b.pk
        RETURNING t.id
      )
      SELECT count(*), (SELECT id::text FROM updated ORDER BY id DESC LIMIT 1) INTO v_batch_count, v_batch_max_id FROM updated;

    ELSE
      -- Generic pattern for room_admissions, room_bans, room_invitations, room_messages
      EXECUTE format($q$
        WITH batch AS (
          SELECT c.id AS pk, r.id AS parent_uuid
          FROM %s c
          JOIN public.rooms r ON r."roomId" = c.room_id OR r.legacy_room_id = c.room_id
          WHERE ($1 IS NULL OR c.id > $1::uuid)
            AND c.room_uuid IS NULL
          ORDER BY c.id ASC
          LIMIT $2
        ),
        updated AS (
          UPDATE %s t
          SET room_uuid = b.parent_uuid
          FROM batch b
          WHERE t.id = b.pk
          RETURNING t.id
        )
        SELECT count(*), (SELECT id::text FROM updated ORDER BY id DESC LIMIT 1) FROM updated;
      $q$, p_child_table, p_child_table)
      USING v_last_uuid, p_batch_size
      INTO v_batch_count, v_batch_max_id;
    END IF;

    EXIT WHEN v_batch_count = 0;

    v_last_uuid := v_batch_max_id;
    UPDATE public.room_migration_checkpoint
    SET last_processed_id = v_last_uuid,
        total_rows_processed = total_rows_processed + v_batch_count,
        updated_at = clock_timestamp()
    WHERE target_table = p_child_table;
  END LOOP;

  -- Trailing Reconciliation Sweep
  LOOP
    v_batch_count := 0;

    IF p_child_table = 'public.room_lifecycle_events' THEN
      WITH batch AS (
        SELECT c.id AS pk, r.id AS parent_uuid
        FROM public.room_lifecycle_events c
        JOIN public.rooms r ON r."roomId" = c."roomId" OR r.legacy_room_id = c."roomId"
        WHERE c.room_uuid IS NULL
        ORDER BY c.id ASC
        LIMIT p_batch_size
        FOR UPDATE OF c SKIP LOCKED
      ),
      updated AS (
        UPDATE public.room_lifecycle_events t
        SET room_uuid = b.parent_uuid
        FROM batch b
        WHERE t.id = b.pk
        RETURNING t.id
      )
      SELECT count(*) INTO v_batch_count FROM updated;

    ELSIF p_child_table = 'public.room_media_sessions' THEN
      WITH batch AS (
        SELECT c.media_id AS pk, r.id AS parent_uuid
        FROM public.room_media_sessions c
        JOIN public.rooms r ON r."roomId" = c.room_id OR r.legacy_room_id = c.room_id
        WHERE c.room_uuid IS NULL
        ORDER BY c.media_id ASC
        LIMIT p_batch_size
        FOR UPDATE OF c SKIP LOCKED
      ),
      updated AS (
        UPDATE public.room_media_sessions t
        SET room_uuid = b.parent_uuid
        FROM batch b
        WHERE t.media_id = b.pk
        RETURNING t.media_id
      )
      SELECT count(*) INTO v_batch_count FROM updated;

    ELSIF p_child_table = 'public.room_quota_events' THEN
      WITH batch AS (
        SELECT c.id AS pk, r.id AS parent_uuid
        FROM public.room_quota_events c
        JOIN public.rooms r ON r."roomId" = c.room_id OR r.legacy_room_id = c.room_id
        WHERE c.room_id IS NOT NULL AND c.room_uuid IS NULL
        ORDER BY c.id ASC
        LIMIT p_batch_size
        FOR UPDATE OF c SKIP LOCKED
      ),
      updated AS (
        UPDATE public.room_quota_events t
        SET room_uuid = b.parent_uuid
        FROM batch b
        WHERE t.id = b.pk
        RETURNING t.id
      )
      SELECT count(*) INTO v_batch_count FROM updated;

    ELSE
      EXECUTE format($q$
        WITH batch AS (
          SELECT c.id AS pk, r.id AS parent_uuid
          FROM %s c
          JOIN public.rooms r ON r."roomId" = c.room_id OR r.legacy_room_id = c.room_id
          WHERE c.room_uuid IS NULL
          ORDER BY c.id ASC
          LIMIT $1
          FOR UPDATE OF c SKIP LOCKED
        ),
        updated AS (
          UPDATE %s t
          SET room_uuid = b.parent_uuid
          FROM batch b
          WHERE t.id = b.pk
          RETURNING t.id
        )
        SELECT count(*) FROM updated;
      $q$, p_child_table, p_child_table)
      USING p_batch_size
      INTO v_batch_count;
    END IF;

    EXIT WHEN v_batch_count = 0;

    UPDATE public.room_migration_checkpoint
    SET total_rows_processed = total_rows_processed + v_batch_count,
        trailing_reconciliation_count = trailing_reconciliation_count + 1,
        updated_at = clock_timestamp()
    WHERE target_table = p_child_table;
  END LOOP;

  -- Completion Barrier for Child Table
  SET LOCAL lock_timeout = '2s';
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', p_child_table);

  IF p_child_table = 'public.room_quota_events' THEN
    SELECT count(*) INTO v_unpopulated_count
    FROM public.room_quota_events
    WHERE room_id IS NOT NULL AND room_uuid IS NULL;
  ELSIF p_child_table = 'public.room_lifecycle_events' THEN
    SELECT count(*) INTO v_unpopulated_count
    FROM public.room_lifecycle_events
    WHERE room_uuid IS NULL;
  ELSE
    EXECUTE format('SELECT count(*) FROM %s WHERE room_uuid IS NULL', p_child_table)
    INTO v_unpopulated_count;
  END IF;

  IF v_unpopulated_count > 0 THEN
    RAISE EXCEPTION 'Child backfill barrier failed for %: % unpopulated records remain', p_child_table, v_unpopulated_count
      USING ERRCODE = '22000';
  END IF;

  UPDATE public.room_migration_checkpoint
  SET is_completed = true,
      completed_at = clock_timestamp(),
      final_verified_row_count = (SELECT count(*) FROM public.rooms),
      updated_at = clock_timestamp()
  WHERE target_table = p_child_table;
END;
$$;

-- Master procedure to backfill all seven child tables in documented sequence
CREATE OR REPLACE PROCEDURE public.backfill_all_child_tables(
  p_batch_size integer DEFAULT 1000
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CALL public.backfill_child_table_room_uuid('public.room_admissions', p_batch_size);
  CALL public.backfill_child_table_room_uuid('public.room_bans', p_batch_size);
  CALL public.backfill_child_table_room_uuid('public.room_invitations', p_batch_size);
  CALL public.backfill_child_table_room_uuid('public.room_lifecycle_events', p_batch_size);
  CALL public.backfill_child_table_room_uuid('public.room_media_sessions', p_batch_size);
  CALL public.backfill_child_table_room_uuid('public.room_messages', p_batch_size);
  CALL public.backfill_child_table_room_uuid('public.room_quota_events', p_batch_size);
END;
$$;

REVOKE ALL ON PROCEDURE public.backfill_child_table_room_uuid(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.backfill_child_table_room_uuid(text, integer) TO postgres, service_role;

REVOKE ALL ON PROCEDURE public.backfill_all_child_tables(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.backfill_all_child_tables(integer) TO postgres, service_role;

-- 5.3 Execute child-tables backfills across all seven referencing tables to completion
CALL public.backfill_all_child_tables(1000);

-- ############################################################################
-- STAGE 6: VALIDATE AND ENFORCE CONSTRAINTS
-- Execution: Non-blocking DDL (NOT VALID -> VALIDATE CONSTRAINT)
-- ############################################################################

-- 6.1 Parent Identity Columns NOT NULL Enforcement
-- Use temporary CHECK NOT VALID + VALIDATE to avoid table scans during ALTER COLUMN SET NOT NULL
ALTER TABLE public.rooms
  ADD CONSTRAINT chk_rooms_id_not_null CHECK (id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT chk_rooms_joining_id_not_null CHECK (joining_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT chk_rooms_legacy_room_id_not_null CHECK (legacy_room_id IS NOT NULL) NOT VALID;

ALTER TABLE public.rooms VALIDATE CONSTRAINT chk_rooms_id_not_null;
ALTER TABLE public.rooms VALIDATE CONSTRAINT chk_rooms_joining_id_not_null;
ALTER TABLE public.rooms VALIDATE CONSTRAINT chk_rooms_legacy_room_id_not_null;

BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.rooms ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.rooms ALTER COLUMN joining_id SET NOT NULL;
ALTER TABLE public.rooms ALTER COLUMN legacy_room_id SET NOT NULL;
ALTER TABLE public.rooms DROP CONSTRAINT chk_rooms_id_not_null;
ALTER TABLE public.rooms DROP CONSTRAINT chk_rooms_joining_id_not_null;
ALTER TABLE public.rooms DROP CONSTRAINT chk_rooms_legacy_room_id_not_null;
COMMIT;

-- 6.2 Child Tables NOT NULL Enforcement on room_uuid (Except nullable room_quota_events)
ALTER TABLE public.room_admissions ADD CONSTRAINT chk_admissions_uuid_not_null CHECK (room_uuid IS NOT NULL) NOT VALID;
ALTER TABLE public.room_bans ADD CONSTRAINT chk_bans_uuid_not_null CHECK (room_uuid IS NOT NULL) NOT VALID;
ALTER TABLE public.room_invitations ADD CONSTRAINT chk_invitations_uuid_not_null CHECK (room_uuid IS NOT NULL) NOT VALID;
ALTER TABLE public.room_lifecycle_events ADD CONSTRAINT chk_lifecycle_uuid_not_null CHECK (room_uuid IS NOT NULL) NOT VALID;
ALTER TABLE public.room_media_sessions ADD CONSTRAINT chk_media_uuid_not_null CHECK (room_uuid IS NOT NULL) NOT VALID;
ALTER TABLE public.room_messages ADD CONSTRAINT chk_messages_uuid_not_null CHECK (room_uuid IS NOT NULL) NOT VALID;

ALTER TABLE public.room_admissions VALIDATE CONSTRAINT chk_admissions_uuid_not_null;
ALTER TABLE public.room_bans VALIDATE CONSTRAINT chk_bans_uuid_not_null;
ALTER TABLE public.room_invitations VALIDATE CONSTRAINT chk_invitations_uuid_not_null;
ALTER TABLE public.room_lifecycle_events VALIDATE CONSTRAINT chk_lifecycle_uuid_not_null;
ALTER TABLE public.room_media_sessions VALIDATE CONSTRAINT chk_media_uuid_not_null;
ALTER TABLE public.room_messages VALIDATE CONSTRAINT chk_messages_uuid_not_null;

BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.room_admissions ALTER COLUMN room_uuid SET NOT NULL;
ALTER TABLE public.room_bans ALTER COLUMN room_uuid SET NOT NULL;
ALTER TABLE public.room_invitations ALTER COLUMN room_uuid SET NOT NULL;
ALTER TABLE public.room_lifecycle_events ALTER COLUMN room_uuid SET NOT NULL;
ALTER TABLE public.room_media_sessions ALTER COLUMN room_uuid SET NOT NULL;
ALTER TABLE public.room_messages ALTER COLUMN room_uuid SET NOT NULL;

ALTER TABLE public.room_admissions DROP CONSTRAINT chk_admissions_uuid_not_null;
ALTER TABLE public.room_bans DROP CONSTRAINT chk_bans_uuid_not_null;
ALTER TABLE public.room_invitations DROP CONSTRAINT chk_invitations_uuid_not_null;
ALTER TABLE public.room_lifecycle_events DROP CONSTRAINT chk_lifecycle_uuid_not_null;
ALTER TABLE public.room_media_sessions DROP CONSTRAINT chk_media_uuid_not_null;
ALTER TABLE public.room_messages DROP CONSTRAINT chk_messages_uuid_not_null;
COMMIT;

-- 6.3 Add New Foreign Keys Referencing rooms(id) as NOT VALID
ALTER TABLE public.room_admissions
  ADD CONSTRAINT room_admissions_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.room_bans
  ADD CONSTRAINT room_bans_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.room_invitations
  ADD CONSTRAINT room_invitations_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.room_lifecycle_events
  ADD CONSTRAINT room_lifecycle_events_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.room_media_sessions
  ADD CONSTRAINT room_media_sessions_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.room_messages
  ADD CONSTRAINT room_messages_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE public.room_quota_events
  ADD CONSTRAINT room_quota_events_room_uuid_fkey
  FOREIGN KEY (room_uuid) REFERENCES public.rooms(id) ON DELETE SET NULL NOT VALID;

-- 6.4 Concurrently Validate All Seven New Foreign Key Constraints
ALTER TABLE public.room_admissions VALIDATE CONSTRAINT room_admissions_room_uuid_fkey;
ALTER TABLE public.room_bans VALIDATE CONSTRAINT room_bans_room_uuid_fkey;
ALTER TABLE public.room_invitations VALIDATE CONSTRAINT room_invitations_room_uuid_fkey;
ALTER TABLE public.room_lifecycle_events VALIDATE CONSTRAINT room_lifecycle_events_room_uuid_fkey;
ALTER TABLE public.room_media_sessions VALIDATE CONSTRAINT room_media_sessions_room_uuid_fkey;
ALTER TABLE public.room_messages VALIDATE CONSTRAINT room_messages_room_uuid_fkey;
ALTER TABLE public.room_quota_events VALIDATE CONSTRAINT room_quota_events_room_uuid_fkey;

-- ############################################################################
-- STAGE 7: PRIMARY-KEY & FOREIGN-KEY CUTOVER (ATOMIC, RESTRICT, NO CASCADE)
-- Execution: Single Fast Atomic Transaction
-- ############################################################################

DO $$
DECLARE
  v_missing_fks integer;
BEGIN
  -- Pre-Cutover Assertion: Ensure all seven new FKs exist and are fully validated
  SELECT count(*) INTO v_missing_fks
  FROM (
    VALUES
      ('room_admissions_room_uuid_fkey'),
      ('room_bans_room_uuid_fkey'),
      ('room_invitations_room_uuid_fkey'),
      ('room_lifecycle_events_room_uuid_fkey'),
      ('room_media_sessions_room_uuid_fkey'),
      ('room_messages_room_uuid_fkey'),
      ('room_quota_events_room_uuid_fkey')
  ) AS expected(con)
  LEFT JOIN pg_constraint c ON c.conname = expected.con AND c.convalidated = true
  WHERE c.oid IS NULL;

  IF v_missing_fks > 0 THEN
    RAISE EXCEPTION 'Pre-cutover guard failed: % replacement foreign keys are unvalidated or missing', v_missing_fks
      USING ERRCODE = '23503';
  END IF;
END $$;

BEGIN;
SET LOCAL lock_timeout = '2s';

-- 7.1 Explicitly drop ONLY the seven known legacy foreign keys by exact name
ALTER TABLE public.room_admissions
  DROP CONSTRAINT room_admissions_room_id_fkey;

ALTER TABLE public.room_bans
  DROP CONSTRAINT room_bans_room_id_fkey;

ALTER TABLE public.room_invitations
  DROP CONSTRAINT room_invitations_room_id_fkey;

ALTER TABLE public.room_lifecycle_events
  DROP CONSTRAINT room_lifecycle_events_room_fk;

ALTER TABLE public.room_media_sessions
  DROP CONSTRAINT room_media_sessions_room_id_fkey;

ALTER TABLE public.room_messages
  DROP CONSTRAINT room_messages_room_id_fkey;

ALTER TABLE public.room_quota_events
  DROP CONSTRAINT room_quota_events_room_id_fkey;

-- 7.2 Drop legacy primary key using strict RESTRICT semantics (NO CASCADE)
-- If any unexpected dependent object remains, PostgreSQL halts execution safely without damage
ALTER TABLE public.rooms
  DROP CONSTRAINT room_pkey;

-- 7.3 Attach new canonical primary key in O(1) time using pre-built unique index
ALTER TABLE public.rooms
  ADD CONSTRAINT room_pkey PRIMARY KEY USING INDEX idx_rooms_id_unique;

-- 7.4 Attach unique constraints on public handles using pre-built unique indexes
ALTER TABLE public.rooms
  ADD CONSTRAINT uq_rooms_joining_id UNIQUE USING INDEX idx_rooms_joining_id_unique;

ALTER TABLE public.rooms
  ADD CONSTRAINT uq_rooms_legacy_room_id UNIQUE USING INDEX idx_rooms_legacy_room_id_unique;

COMMIT;

-- ============================================================================
-- END OF FORWARD MIGRATION
-- ============================================================================
