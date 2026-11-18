-- ============================================================================
-- CoWatch WatchParty: Room Identity Architecture Migration - Phase 6 (CUTOVER ROLLBACK)
-- Migration File: sql/migrations/20261118_room_identity_phase6_cutover_down.sql
-- Target System: PostgreSQL 14+ / Supabase Production Catalog
--
-- PURPOSE:
-- Symmetrical rollback for Phase 6 cutover migration.
-- 1. Restores rooms legacy text columns ("roomId", legacy_room_id).
-- 2. Restores child table legacy text columns (room_id / "roomId").
-- 3. Backfills legacy text columns from canonical UUIDs.
-- 4. Restores original unique constraints and indexes on legacy columns.
-- 5. Restores dual-write synchronization triggers and trigger functions.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ############################################################################
-- STAGE 1: RESTORE ROOMS LEGACY TEXT COLUMNS & INDEXES
-- ############################################################################

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS "roomId" text,
  ADD COLUMN IF NOT EXISTS legacy_room_id text;

-- Backfill from canonical UUID
UPDATE public.rooms
SET "roomId" = id::text,
    legacy_room_id = id::text
WHERE "roomId" IS NULL;

ALTER TABLE public.rooms ALTER COLUMN "roomId" SET NOT NULL;
ALTER TABLE public.rooms ADD CONSTRAINT uq_rooms_legacy_room_id UNIQUE (legacy_room_id);
CREATE INDEX IF NOT EXISTS "room_roomId_idx" ON public.rooms USING gin ("roomId" gin_trgm_ops);


-- ############################################################################
-- STAGE 2: RESTORE CHILD TABLE LEGACY TEXT COLUMNS
-- ############################################################################

ALTER TABLE public.room_admissions ADD COLUMN IF NOT EXISTS room_id text;
UPDATE public.room_admissions SET room_id = room_uuid::text WHERE room_id IS NULL;
ALTER TABLE public.room_admissions ALTER COLUMN room_id SET NOT NULL;

ALTER TABLE public.room_bans ADD COLUMN IF NOT EXISTS room_id text;
UPDATE public.room_bans SET room_id = room_uuid::text WHERE room_id IS NULL;
ALTER TABLE public.room_bans ALTER COLUMN room_id SET NOT NULL;

ALTER TABLE public.room_invitations ADD COLUMN IF NOT EXISTS room_id text;
UPDATE public.room_invitations SET room_id = room_uuid::text WHERE room_id IS NULL;
ALTER TABLE public.room_invitations ALTER COLUMN room_id SET NOT NULL;

ALTER TABLE public.room_lifecycle_events ADD COLUMN IF NOT EXISTS "roomId" text;
UPDATE public.room_lifecycle_events SET "roomId" = room_uuid::text WHERE "roomId" IS NULL;
ALTER TABLE public.room_lifecycle_events ALTER COLUMN "roomId" SET NOT NULL;

ALTER TABLE public.room_media_sessions ADD COLUMN IF NOT EXISTS room_id text;
UPDATE public.room_media_sessions SET room_id = room_uuid::text WHERE room_id IS NULL;
ALTER TABLE public.room_media_sessions ALTER COLUMN room_id SET NOT NULL;

ALTER TABLE public.room_messages ADD COLUMN IF NOT EXISTS room_id text;
UPDATE public.room_messages SET room_id = room_uuid::text WHERE room_id IS NULL;
ALTER TABLE public.room_messages ALTER COLUMN room_id SET NOT NULL;

ALTER TABLE public.room_quota_events ADD COLUMN IF NOT EXISTS room_id text;
UPDATE public.room_quota_events SET room_id = room_uuid::text WHERE room_id IS NULL AND room_uuid IS NOT NULL;


-- ############################################################################
-- STAGE 3: RESTORE ORIGINAL CONSTRAINTS & INDEXES
-- ############################################################################

-- 3.1 room_admissions
ALTER TABLE public.room_admissions DROP CONSTRAINT IF EXISTS room_admissions_room_uuid_user_unique;
ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_room_user_unique UNIQUE (room_id, user_id);
DROP INDEX IF EXISTS public.idx_room_admissions_lookup;
CREATE INDEX IF NOT EXISTS idx_room_admissions_lookup ON public.room_admissions (room_id, user_id) WHERE (revoked_at IS NULL);

-- 3.2 room_bans
ALTER TABLE public.room_bans DROP CONSTRAINT IF EXISTS room_bans_room_uuid_client_identity_unique;
ALTER TABLE public.room_bans ADD CONSTRAINT room_bans_room_identity_unique UNIQUE (room_id, client_identity);
CREATE INDEX IF NOT EXISTS idx_room_bans_client_identity ON public.room_bans (room_id, client_identity);
CREATE INDEX IF NOT EXISTS idx_room_bans_room_id ON public.room_bans (room_id);
DROP INDEX IF EXISTS public.idx_room_bans_user_id;
CREATE INDEX IF NOT EXISTS idx_room_bans_user_id ON public.room_bans (room_id, user_id) WHERE (user_id IS NOT NULL);

-- 3.3 room_invitations
CREATE INDEX IF NOT EXISTS idx_room_invitations_room_id ON public.room_invitations (room_id);

-- 3.4 room_lifecycle_events
CREATE INDEX IF NOT EXISTS idx_room_lifecycle_events_room_id ON public.room_lifecycle_events ("roomId");

-- 3.5 room_media_sessions
CREATE INDEX IF NOT EXISTS idx_room_media_sessions_room_id ON public.room_media_sessions (room_id);

-- 3.6 room_messages
ALTER TABLE public.room_messages DROP CONSTRAINT IF EXISTS room_messages_room_uuid_user_client_msg_unique;
ALTER TABLE public.room_messages ADD CONSTRAINT room_messages_client_message_id_key UNIQUE (room_id, user_id, client_message_id);
DROP INDEX IF EXISTS public.room_messages_room_created_id_idx;
CREATE INDEX IF NOT EXISTS room_messages_room_created_id_idx ON public.room_messages (room_id, created_at DESC, id DESC);

-- 3.7 room_quota_events
CREATE INDEX IF NOT EXISTS idx_room_quota_events_room_id ON public.room_quota_events (room_id);


-- ############################################################################
-- STAGE 4: RESTORE DUAL-WRITE SYNCHRONIZATION TRIGGER FUNCTIONS & TRIGGERS
-- ############################################################################

-- 4.1 sync_room_identities_trigger
CREATE OR REPLACE FUNCTION public.sync_room_identities_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  IF NEW.joining_id IS NULL OR trim(NEW.joining_id) = '' THEN
    NEW.joining_id := public.allocate_room_joining_id();
  END IF;

  IF NEW.legacy_room_id IS NULL AND NEW."roomId" IS NOT NULL THEN
    NEW.legacy_room_id := NEW."roomId";
  ELSIF NEW."roomId" IS NULL AND NEW.legacy_room_id IS NOT NULL THEN
    NEW."roomId" := NEW.legacy_room_id;
  ELSIF NEW."roomId" IS NULL AND NEW.legacy_room_id IS NULL THEN
    NEW."roomId" := NEW.id::text;
    NEW.legacy_room_id := NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_room_identities
BEFORE INSERT OR UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.sync_room_identities_trigger();

-- 4.2 sync_child_room_uuid_trigger
CREATE OR REPLACE FUNCTION public.sync_child_room_uuid_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF NEW.room_uuid IS NULL AND NEW.room_id IS NOT NULL THEN
    SELECT id INTO v_uuid FROM public.rooms WHERE "roomId" = NEW.room_id OR legacy_room_id = NEW.room_id LIMIT 1;
    IF v_uuid IS NOT NULL THEN
      NEW.room_uuid := v_uuid;
    END IF;
  ELSIF NEW.room_id IS NULL AND NEW.room_uuid IS NOT NULL THEN
    SELECT "roomId" INTO NEW.room_id FROM public.rooms WHERE id = NEW.room_uuid LIMIT 1;
    IF NEW.room_id IS NULL THEN
      NEW.room_id := NEW.room_uuid::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_room_admissions_uuid
BEFORE INSERT OR UPDATE ON public.room_admissions
FOR EACH ROW
EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

CREATE TRIGGER trg_sync_room_bans_uuid
BEFORE INSERT OR UPDATE ON public.room_bans
FOR EACH ROW
EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

CREATE TRIGGER trg_sync_room_invitations_uuid
BEFORE INSERT OR UPDATE ON public.room_invitations
FOR EACH ROW
EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

CREATE TRIGGER trg_sync_room_media_sessions_uuid
BEFORE INSERT OR UPDATE ON public.room_media_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

CREATE TRIGGER trg_sync_room_messages_uuid
BEFORE INSERT OR UPDATE ON public.room_messages
FOR EACH ROW
EXECUTE FUNCTION public.sync_child_room_uuid_trigger();

-- 4.3 sync_room_lifecycle_events_uuid_trigger
CREATE OR REPLACE FUNCTION public.sync_room_lifecycle_events_uuid_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF NEW.room_uuid IS NULL AND NEW."roomId" IS NOT NULL THEN
    SELECT id INTO v_uuid FROM public.rooms WHERE "roomId" = NEW."roomId" OR legacy_room_id = NEW."roomId" LIMIT 1;
    IF v_uuid IS NOT NULL THEN
      NEW.room_uuid := v_uuid;
    END IF;
  ELSIF NEW."roomId" IS NULL AND NEW.room_uuid IS NOT NULL THEN
    SELECT "roomId" INTO NEW."roomId" FROM public.rooms WHERE id = NEW.room_uuid LIMIT 1;
    IF NEW."roomId" IS NULL THEN
      NEW."roomId" := NEW.room_uuid::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_room_lifecycle_events_uuid
BEFORE INSERT OR UPDATE ON public.room_lifecycle_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_room_lifecycle_events_uuid_trigger();

-- 4.4 sync_room_quota_events_uuid_trigger
CREATE OR REPLACE FUNCTION public.sync_room_quota_events_uuid_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF NEW.room_uuid IS NULL AND NEW.room_id IS NOT NULL THEN
    SELECT id INTO v_uuid FROM public.rooms WHERE "roomId" = NEW.room_id OR legacy_room_id = NEW.room_id LIMIT 1;
    IF v_uuid IS NOT NULL THEN
      NEW.room_uuid := v_uuid;
    END IF;
  ELSIF NEW.room_id IS NULL AND NEW.room_uuid IS NOT NULL THEN
    SELECT "roomId" INTO NEW.room_id FROM public.rooms WHERE id = NEW.room_uuid LIMIT 1;
    IF NEW.room_id IS NULL THEN
      NEW.room_id := NEW.room_uuid::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_room_quota_events_uuid
BEFORE INSERT OR UPDATE ON public.room_quota_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_room_quota_events_uuid_trigger();

COMMIT;

-- ============================================================================
-- END OF ROLLBACK CUTOVER MIGRATION (sql/migrations/20261118_room_identity_phase6_cutover_down.sql)
-- ============================================================================
