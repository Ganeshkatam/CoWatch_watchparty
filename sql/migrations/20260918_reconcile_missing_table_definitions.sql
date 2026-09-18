-- ============================================================================
-- Migration: 20260918_reconcile_missing_table_definitions.sql
-- Description: Historical Reconciliation and Schema Verification Migration
-- 
-- Explicitly reconciles and establishes authoritative DDL, referential constraints,
-- indexes, RLS policies, and role grants for the four tables created out-of-band
-- during feature development:
--   1. public.announcements
--   2. public.feedback
--   3. public.room_admissions
--   4. public.room_bans
--
-- Each table section provides:
--   a) Base table creation for fresh/replay environments
--   b) Column and default reconciliation
--   c) Foreign key, check, and unique constraint reconciliation
--   d) Index reconciliation
--   e) Row Level Security (RLS) enforcement
--   f) Authoritative RLS policy reconciliation
--   g) Role privilege reconciliation
--   h) Strict active verification block (DO $$) preventing silent drift
--
-- Also patches delete_unconfirmed_users() to eliminate obsolete legacy table
-- references and enforce an empty search path (search_path TO '').
--
-- This migration is an incremental reconciliation step, preserving all
-- preceding 45 historical migration records. Standalone cold-boot environments
-- should use sql/schema.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE: public.announcements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  level text NOT NULL,
  action_label text,
  action_url text,
  is_active boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Column and default reconciliation
ALTER TABLE public.announcements 
  ADD COLUMN IF NOT EXISTS action_label text,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS published_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Constraint reconciliation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.announcements'::regclass AND conname = 'announcements_level_check'
  ) THEN
    ALTER TABLE public.announcements 
      ADD CONSTRAINT announcements_level_check 
      CHECK (level = ANY (ARRAY['info'::text, 'success'::text, 'warning'::text, 'critical'::text]));
  END IF;
END $$;

-- Index reconciliation
CREATE INDEX IF NOT EXISTS idx_announcements_active_published
  ON public.announcements (is_active, published_at DESC);

-- RLS reconciliation
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active announcements" ON public.announcements;
CREATE POLICY "Public read active announcements"
  ON public.announcements
  FOR SELECT
  TO public
  USING ((is_active = true) AND (published_at <= now()));

-- Privilege reconciliation
REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.announcements TO anon, authenticated;
GRANT ALL ON TABLE public.announcements TO postgres, service_role;

-- Active Drift Verification
DO $$
DECLARE
  v_col_count integer;
  v_con_count integer;
  v_idx_count integer;
  v_pol_count integer;
BEGIN
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'announcements'
    AND column_name IN ('id', 'title', 'body', 'level', 'action_label', 'action_url', 'is_active', 'published_at', 'created_at', 'updated_at');
  IF v_col_count < 10 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.announcements missing expected columns (found %)', v_col_count;
  END IF;

  SELECT count(*) INTO v_con_count
  FROM pg_constraint
  WHERE conrelid = 'public.announcements'::regclass AND conname = 'announcements_level_check';
  IF v_con_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: announcements_level_check constraint missing';
  END IF;

  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'announcements' AND indexname = 'idx_announcements_active_published';
  IF v_idx_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: idx_announcements_active_published index missing';
  END IF;

  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'announcements' AND policyname = 'Public read active announcements';
  IF v_pol_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: policy "Public read active announcements" missing';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. TABLE: public.feedback
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL,
  rating integer,
  message text NOT NULL,
  context text NOT NULL,
  app_version text DEFAULT '1.0.3',
  platform text DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new',
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes text,
  reviewed_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  idempotency_key text
);

-- Column and default reconciliation
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS app_version text DEFAULT '1.0.3',
  ADD COLUMN IF NOT EXISTS platform text DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Constraint reconciliation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_type_check') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_type_check 
      CHECK (type = ANY (ARRAY['bug'::text, 'suggestion'::text, 'problem'::text, 'experience'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_context_check') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_context_check 
      CHECK (context = ANY (ARRAY['room'::text, 'playback'::text, 'host'::text, 'participants'::text, 'chat'::text, 'video'::text, 'virtual-browser'::text, 'connection'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_rating_check') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_rating_check 
      CHECK (rating >= 1 AND rating <= 5);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_message_check') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_message_check 
      CHECK (char_length(message) >= 1 AND char_length(message) <= 2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_status_check') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_status_check 
      CHECK (status = ANY (ARRAY['new'::text, 'reviewed'::text, 'actioned'::text, 'dismissed'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_user_id_fkey') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feedback'::regclass AND conname = 'feedback_reviewer_id_fkey') THEN
    ALTER TABLE public.feedback ADD CONSTRAINT feedback_reviewer_id_fkey 
      FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index reconciliation
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON public.feedback (type);
CREATE INDEX IF NOT EXISTS idx_feedback_context ON public.feedback (context);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON public.feedback (rating);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_idempotency_key ON public.feedback (idempotency_key) WHERE (idempotency_key IS NOT NULL);

-- RLS reconciliation
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_insert_hardened" ON public.feedback;
CREATE POLICY "feedback_insert_hardened"
  ON public.feedback
  FOR INSERT
  TO public
  WITH CHECK (
    (user_id IS NULL)
    OR
    (((SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = (SELECT auth.uid() AS uid)))
  );

DROP POLICY IF EXISTS "feedback_select_owner_only" ON public.feedback;
CREATE POLICY "feedback_select_owner_only"
  ON public.feedback
  FOR SELECT
  TO public
  USING (
    ((SELECT auth.uid() AS uid) IS NOT NULL)
    AND
    (user_id = (SELECT auth.uid() AS uid))
  );

-- Privilege reconciliation
REVOKE ALL ON TABLE public.feedback FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON TABLE public.feedback TO anon, authenticated;
GRANT ALL ON TABLE public.feedback TO postgres, service_role;

-- Active Drift Verification
DO $$
DECLARE
  v_col_count integer;
  v_fkey_count integer;
  v_idx_count integer;
  v_pol_count integer;
BEGIN
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'feedback'
    AND column_name IN ('id', 'user_id', 'type', 'rating', 'message', 'context', 'app_version', 'platform', 'created_at', 'status', 'reviewer_id', 'review_notes', 'reviewed_at', 'updated_at', 'idempotency_key');
  IF v_col_count < 15 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.feedback missing expected columns (found %)', v_col_count;
  END IF;

  SELECT count(*) INTO v_fkey_count
  FROM pg_constraint
  WHERE conrelid = 'public.feedback'::regclass 
    AND conname IN ('feedback_user_id_fkey', 'feedback_reviewer_id_fkey');
  IF v_fkey_count < 2 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.feedback foreign keys missing';
  END IF;

  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'feedback'
    AND indexname IN ('idx_feedback_created_at', 'idx_feedback_user_id', 'idx_feedback_status', 'idx_feedback_type', 'idx_feedback_context', 'idx_feedback_rating', 'idx_feedback_idempotency_key');
  IF v_idx_count < 7 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.feedback indexes missing (found %)', v_idx_count;
  END IF;

  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'feedback'
    AND policyname IN ('feedback_insert_hardened', 'feedback_select_owner_only');
  IF v_pol_count < 2 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.feedback policies missing';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 3. TABLE: public.room_admissions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  admission_method text NOT NULL DEFAULT 'passcode',
  admitted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_admissions_room_user_unique UNIQUE (room_id, user_id)
);

-- Column and default reconciliation
ALTER TABLE public.room_admissions
  ADD COLUMN IF NOT EXISTS admission_method text NOT NULL DEFAULT 'passcode',
  ADD COLUMN IF NOT EXISTS admitted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Constraint reconciliation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_admissions'::regclass AND conname = 'room_admissions_admission_method_check') THEN
    ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_admission_method_check
      CHECK (admission_method = ANY (ARRAY['passcode'::text, 'invite'::text, 'host'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_admissions'::regclass AND conname = 'room_admissions_room_id_fkey') THEN
    ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_admissions'::regclass AND conname = 'room_admissions_user_id_fkey') THEN
    ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_admissions'::regclass AND conname = 'room_admissions_room_user_unique') THEN
    ALTER TABLE public.room_admissions ADD CONSTRAINT room_admissions_room_user_unique
      UNIQUE (room_id, user_id);
  END IF;
END $$;

-- Index reconciliation
CREATE INDEX IF NOT EXISTS idx_room_admissions_lookup
  ON public.room_admissions (room_id, user_id)
  WHERE (revoked_at IS NULL);

-- RLS reconciliation
ALTER TABLE public.room_admissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own room admissions" ON public.room_admissions;
CREATE POLICY "Users can read their own room admissions"
  ON public.room_admissions
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid() AS uid) = user_id);

-- Privilege reconciliation (Server-authoritative: only postgres and service_role)
REVOKE ALL ON TABLE public.room_admissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.room_admissions TO postgres, service_role;

-- Active Drift Verification
DO $$
DECLARE
  v_col_count integer;
  v_fkey_count integer;
  v_idx_count integer;
  v_pol_count integer;
  v_anon_grants integer;
BEGIN
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'room_admissions'
    AND column_name IN ('id', 'room_id', 'user_id', 'admission_method', 'admitted_at', 'revoked_at', 'revoked_reason', 'created_at');
  IF v_col_count < 8 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_admissions missing expected columns (found %)', v_col_count;
  END IF;

  SELECT count(*) INTO v_fkey_count
  FROM pg_constraint
  WHERE conrelid = 'public.room_admissions'::regclass 
    AND conname IN ('room_admissions_room_id_fkey', 'room_admissions_user_id_fkey', 'room_admissions_room_user_unique');
  IF v_fkey_count < 3 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_admissions foreign keys or unique constraint missing';
  END IF;

  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'room_admissions' AND indexname = 'idx_room_admissions_lookup';
  IF v_idx_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: idx_room_admissions_lookup index missing';
  END IF;

  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'room_admissions' AND policyname = 'Users can read their own room admissions';
  IF v_pol_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: policy "Users can read their own room admissions" missing';
  END IF;

  SELECT count(*) INTO v_anon_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'room_admissions' AND grantee IN ('anon', 'authenticated');
  IF v_anon_grants > 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_admissions has unauthorized client grants';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 4. TABLE: public.room_bans
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  client_identity text NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  banned_by text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT room_bans_room_identity_unique UNIQUE (room_id, client_identity)
);

-- Column and default reconciliation
ALTER TABLE public.room_bans
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS banned_by text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Constraint reconciliation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_bans'::regclass AND conname = 'room_bans_room_id_fkey') THEN
    ALTER TABLE public.room_bans ADD CONSTRAINT room_bans_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES public.rooms("roomId") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_bans'::regclass AND conname = 'room_bans_user_id_fkey') THEN
    ALTER TABLE public.room_bans ADD CONSTRAINT room_bans_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.room_bans'::regclass AND conname = 'room_bans_room_identity_unique') THEN
    ALTER TABLE public.room_bans ADD CONSTRAINT room_bans_room_identity_unique
      UNIQUE (room_id, client_identity);
  END IF;
END $$;

-- Index reconciliation
CREATE INDEX IF NOT EXISTS idx_room_bans_room_id ON public.room_bans (room_id);
CREATE INDEX IF NOT EXISTS idx_room_bans_client_identity ON public.room_bans (room_id, client_identity);
CREATE INDEX IF NOT EXISTS idx_room_bans_user_id ON public.room_bans (room_id, user_id) WHERE (user_id IS NOT NULL);

-- RLS reconciliation
ALTER TABLE public.room_bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "room_bans_deny_client_access" ON public.room_bans;
CREATE POLICY "room_bans_deny_client_access"
  ON public.room_bans
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- Privilege reconciliation (Server-only table: only postgres and service_role)
REVOKE ALL ON TABLE public.room_bans FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.room_bans TO postgres, service_role;

-- Active Drift Verification
DO $$
DECLARE
  v_col_count integer;
  v_fkey_count integer;
  v_idx_count integer;
  v_pol_count integer;
  v_anon_grants integer;
BEGIN
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns 
  WHERE table_schema = 'public' AND table_name = 'room_bans'
    AND column_name IN ('id', 'room_id', 'client_identity', 'user_id', 'banned_by', 'reason', 'created_at');
  IF v_col_count < 7 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_bans missing expected columns (found %)', v_col_count;
  END IF;

  SELECT count(*) INTO v_fkey_count
  FROM pg_constraint
  WHERE conrelid = 'public.room_bans'::regclass 
    AND conname IN ('room_bans_room_id_fkey', 'room_bans_user_id_fkey', 'room_bans_room_identity_unique');
  IF v_fkey_count < 3 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_bans foreign keys or unique constraint missing';
  END IF;

  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'room_bans'
    AND indexname IN ('idx_room_bans_room_id', 'idx_room_bans_client_identity', 'idx_room_bans_user_id');
  IF v_idx_count < 3 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_bans indexes missing (found %)', v_idx_count;
  END IF;

  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'room_bans'
    AND policyname = 'room_bans_deny_client_access';
  IF v_pol_count = 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_bans deny policy missing';
  END IF;

  SELECT count(*) INTO v_anon_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'room_bans' AND grantee IN ('anon', 'authenticated');
  IF v_anon_grants > 0 THEN
    RAISE EXCEPTION 'Reconciliation assertion failed: public.room_bans has unauthorized client grants';
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 5. ROUTINE REPAIR: public.delete_unconfirmed_users()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_unconfirmed_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN 
    SELECT id FROM auth.users 
    WHERE email_confirmed_at IS NULL AND created_at < now() - interval '7 days'
  LOOP
    -- 1. Explicitly clean up rooms using authoritative table and column names
    DELETE FROM public.rooms WHERE owner_id = rec.id;
    
    -- 2. Delete linked accounts (if table exists)
    BEGIN
      EXECUTE 'DELETE FROM public.link_account WHERE uid = $1' USING rec.id::text;
    EXCEPTION
      WHEN undefined_table THEN
        -- Do nothing
    END;

    -- 3. Delete avatars from storage
    DELETE FROM storage.objects 
    WHERE bucket_id = 'avatars' 
      AND (name LIKE rec.id::text || '/%');
      
    -- 4. Delete the user (cascades to profiles, limits, usage, admissions, invitations)
    DELETE FROM auth.users WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unconfirmed_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unconfirmed_users() TO postgres, service_role;

-- Routine Verification
DO $$
DECLARE
  v_secdef boolean;
  v_path text[];
BEGIN
  SELECT prosecdef, proconfig INTO v_secdef, v_path
  FROM pg_proc
  WHERE proname = 'delete_unconfirmed_users' AND pronamespace = 'public'::regnamespace;

  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Assertion failed: delete_unconfirmed_users is not SECURITY DEFINER';
  END IF;

  IF v_path IS NULL OR NOT ('search_path=""' = ANY(v_path)) THEN
    RAISE EXCEPTION 'Assertion failed: delete_unconfirmed_users does not enforce empty search_path';
  END IF;
END $$;
