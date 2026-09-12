-- =============================================================================
-- NOTIFY-001: Product Notifications & Transactional Email
-- Phase A: Database Schema, Authorization Boundary, Preference Backfill
-- =============================================================================
-- Invariants enforced by this migration:
--   1. Notification INSERT/DELETE is server-only (service_role). No client DML.
--   2. Authenticated clients may only read their own notifications (RLS SELECT).
--   3. mark-read mutations are exclusively server-authoritative via RPC/REST.
--   4. email_outbox is fully opaque to all client roles.
--   5. notification_type_registry is the sole source of truth for type validity
--      and email eligibility.
--   6. Idempotency is enforced at the database level via unique(user_id, event_id, type).
--   7. Every existing profile has exactly one notification_preferences row before
--      server-only insert enforcement goes live (backfill before trigger).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 1: notification_type_registry (sole authority for types + email eligibility)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_type_registry (
  type             text PRIMARY KEY,
  description      text NOT NULL,
  email_eligible   boolean NOT NULL DEFAULT false,
  in_app_eligible  boolean NOT NULL DEFAULT true,
  category         text NOT NULL DEFAULT 'system'
    CHECK (category IN ('room', 'moderation', 'infrastructure', 'system')),
  created_at       timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_type_registry IS
  'Authoritative catalog of notification types. email_eligible drives outbox insertion. '
  'TypeScript enum and template registry must match this table (enforced by CI test).';

-- Seed all canonical notification types
INSERT INTO public.notification_type_registry (type, description, email_eligible, in_app_eligible, category) VALUES
  ('ROOM_INVITATION',    'User was invited to join a room',                          true,  true,  'room'),
  ('ROOM_HOST_TRANSFER', 'Host role was transferred to this user',                   false, true,  'room'),
  ('ROOM_STARTED',       'A room the user is a member of has started',               true,  true,  'room'),
  ('ROOM_ENDING',        'A room is expiring soon (advance notice)',                  false, true,  'room'),
  ('ROOM_ENDED',         'A room the user owned or participated in has ended',        false, true,  'room'),
  ('MODERATION_ACTION',  'User was removed from or warned about a room',             false, true,  'moderation'),
  ('VBROWSER_FAILURE',   'Virtual browser session encountered an error',              false, true,  'infrastructure'),
  ('SYSTEM_ANNOUNCEMENT','Platform-wide announcement from the CoWatch team',          true,  true,  'system')
ON CONFLICT (type) DO UPDATE SET
  description      = excluded.description,
  email_eligible   = excluded.email_eligible,
  in_app_eligible  = excluded.in_app_eligible,
  category         = excluded.category;

-- ---------------------------------------------------------------------------
-- SECTION 2: notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type             text NOT NULL REFERENCES public.notification_type_registry(type),
  title            text NOT NULL CHECK (btrim(title) <> ''),
  body             text NOT NULL CHECK (btrim(body) <> ''),
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  read_at          timestamp with time zone,
  expires_at       timestamp with time zone,
  -- event_id: caller-assigned deterministic event key (e.g. "ROOM_ENDING:{roomId}:{expiryEpoch}")
  -- Combined with user_id and type to enforce at-most-once delivery per event per user
  event_id         text NOT NULL DEFAULT '',
  CONSTRAINT notifications_read_at_after_created CHECK (read_at IS NULL OR read_at >= created_at),
  CONSTRAINT notifications_expires_at_after_created CHECK (expires_at IS NULL OR expires_at > created_at),
  -- Idempotency: one notification per (user, event, type)
  CONSTRAINT notifications_user_event_type_unique UNIQUE (user_id, event_id, type)
);

COMMENT ON TABLE public.notifications IS
  'In-app notification inbox. INSERT and DELETE are server-only (service_role). '
  'read_at mutations are RPC-only; clients may only SELECT their own rows.';
COMMENT ON COLUMN public.notifications.event_id IS
  'Deterministic caller-assigned event key used for idempotency. '
  'Pattern: "{TYPE}:{subjectId}:{discriminator}". '
  'Empty string is reserved for one-off system announcements.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (user_id, read_at, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SECTION 3: notification_preferences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- master email gate: when false, no emails regardless of category toggles
  email_enabled        boolean NOT NULL DEFAULT true,
  -- per-category email toggles (evaluated only when email_enabled = true)
  room_invitations     boolean NOT NULL DEFAULT true,
  room_events          boolean NOT NULL DEFAULT false,
  moderation_events    boolean NOT NULL DEFAULT false,
  system_announcements boolean NOT NULL DEFAULT true,
  updated_at           timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-user notification delivery preferences. Row is provisioned on signup via '
  'handle_new_user() and via idempotent backfill for existing profiles. '
  'Direct client INSERT is blocked by trigger; UPDATE is RLS-gated to own row.';

-- ---------------------------------------------------------------------------
-- SECTION 4: email_outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- nullable: outbox row may outlive its notification row
  notification_id      uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_key         text NOT NULL CHECK (btrim(template_key) <> ''),
  -- recipient_email is always resolved server-side from auth.users; never from client payload
  recipient_email      text NOT NULL CHECK (btrim(recipient_email) <> ''),
  payload              jsonb NOT NULL DEFAULT '{}',
  status               text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED', 'CANCELLED')),
  attempt_count        integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  -- When PENDING/RETRY: the earliest time the worker may next attempt delivery
  available_at         timestamp with time zone NOT NULL DEFAULT now(),
  last_attempt_at      timestamp with time zone,
  sent_at              timestamp with time zone,
  -- Provider-specific message ID for deduplication / delivery tracking
  provider_message_id  text,
  -- Provider idempotency key sent to upstream (Resend, etc.)
  provider_idempotency_key text UNIQUE,
  last_error_code      text,
  created_at           timestamp with time zone NOT NULL DEFAULT now(),
  updated_at           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_sent_at_after_attempt CHECK (sent_at IS NULL OR last_attempt_at IS NOT NULL)
);

COMMENT ON TABLE public.email_outbox IS
  'Email delivery queue. Fully opaque to client roles (anon, authenticated). '
  'Atomic job claiming uses FOR UPDATE SKIP LOCKED to prevent races. '
  'recipient_email is always resolved server-side from auth.users.';

-- Indexes for outbox worker claiming and monitoring
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending_claim
  ON public.email_outbox (available_at, created_at)
  WHERE status IN ('PENDING', 'RETRY');

CREATE INDEX IF NOT EXISTS idx_email_outbox_stalled
  ON public.email_outbox (last_attempt_at)
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS idx_email_outbox_user_id
  ON public.email_outbox (user_id);

CREATE INDEX IF NOT EXISTS idx_email_outbox_notification_id
  ON public.email_outbox (notification_id)
  WHERE notification_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SECTION 5: Triggers
-- ---------------------------------------------------------------------------

-- 5.1 Auto-update updated_at on email_outbox
CREATE OR REPLACE FUNCTION public.email_outbox_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_outbox_set_updated_at ON public.email_outbox;
CREATE TRIGGER email_outbox_set_updated_at
  BEFORE UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.email_outbox_set_updated_at();

-- 5.2 Auto-update updated_at on notification_preferences
DROP TRIGGER IF EXISTS notification_preferences_set_updated_at ON public.notification_preferences;
CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5.3 Enforce server-only INSERT on notification_preferences
-- This trigger fires BEFORE any direct INSERT by client roles, blocking it.
-- service_role (used by the server) bypasses RLS and is not blocked because
-- it holds the BYPASSRLS attribute in Supabase-managed Postgres.
CREATE OR REPLACE FUNCTION public.enforce_notification_preferences_server_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Block INSERT attempted by non-server roles. In Supabase the executing role
  -- for authenticated clients is "authenticated"; service_role never hits RLS triggers.
  IF current_setting('role', true) = 'authenticated' OR current_setting('role', true) = 'anon' THEN
    RAISE EXCEPTION 'NOTIFICATION_PREFERENCES_INSERT_FORBIDDEN'
      USING HINT = 'Preference rows are provisioned automatically by the server.',
            ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_notification_preferences_server_insert ON public.notification_preferences;
CREATE TRIGGER trg_enforce_notification_preferences_server_insert
  BEFORE INSERT ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_preferences_server_insert();

-- 5.4 Enforce server-only INSERT/DELETE/UPDATE on notifications
-- Clients have SELECT only via RLS. Prevent direct client mutation via trigger guard.
CREATE OR REPLACE FUNCTION public.enforce_notifications_server_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'NOTIFICATIONS_MUTATION_FORBIDDEN'
      USING HINT = 'Notifications are mutated exclusively via server-authoritative RPC.',
            ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_notifications_insert ON public.notifications;
CREATE TRIGGER trg_enforce_notifications_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notifications_server_only();

DROP TRIGGER IF EXISTS trg_enforce_notifications_update ON public.notifications;
CREATE TRIGGER trg_enforce_notifications_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notifications_server_only();

DROP TRIGGER IF EXISTS trg_enforce_notifications_delete ON public.notifications;
CREATE TRIGGER trg_enforce_notifications_delete
  BEFORE DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notifications_server_only();

-- ---------------------------------------------------------------------------
-- SECTION 6: Authoritative RPC Functions (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

-- 6.1 Provision notification_preferences (idempotent, called by handle_new_user + backfill)
CREATE OR REPLACE FUNCTION public.provision_notification_preferences(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- 6.2 Mark a single notification read (server RPC only, validates ownership)
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_user_id       uuid,
  p_notification_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.notifications
  SET read_at = clock_timestamp()
  WHERE id = p_notification_id
    AND user_id = p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- 6.3 Mark all notifications read for a user
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.notifications
  SET read_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- 6.4 Get unread notification count for a user
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.notifications
  WHERE user_id = p_user_id
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- SECTION 7: Update handle_new_user() — add Step 5: provision notification preferences
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default_plan text;
BEGIN
  -- 1. Resolve configured default subscription plan
  v_default_plan := public.get_default_subscription_plan_id();

  -- 2. Provision profile
  INSERT INTO public.profiles (id, username, avatar_url, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'username',
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture'
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      NEW.raw_user_meta_data ->> 'username',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    avatar_url   = COALESCE(public.profiles.avatar_url, excluded.avatar_url),
    display_name = COALESCE(public.profiles.display_name, excluded.display_name);

  -- 3. Explicitly assign onboarding default plan
  INSERT INTO public.account_room_limits (account_id, plan_id, enabled, created_at, updated_at)
  VALUES (NEW.id, v_default_plan, true, clock_timestamp(), clock_timestamp())
  ON CONFLICT (account_id) DO NOTHING;

  -- 4. Provision usage ledger record
  INSERT INTO public.account_room_usage (account_id, total_rooms, watch_rooms, permanent_rooms, updated_at)
  VALUES (NEW.id, 0, 0, 0, clock_timestamp())
  ON CONFLICT (account_id) DO NOTHING;

  -- 5. Provision notification preferences (idempotent, opt-in defaults)
  PERFORM public.provision_notification_preferences(NEW.id);

  RETURN NEW;
END;
$$;

-- Ensure execution permissions remain locked
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- SECTION 8: Backfill existing profiles with notification_preferences rows
-- Must run BEFORE the server-only insert trigger becomes active on existing rows.
-- The trigger only blocks authenticated/anon roles; this runs as postgres/service_role.
-- ---------------------------------------------------------------------------

INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SECTION 9: Row Level Security
-- ---------------------------------------------------------------------------

-- 9.1 Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_type_registry ENABLE ROW LEVEL SECURITY;

-- 9.2 notifications policies
-- Clients: SELECT own rows only. INSERT/UPDATE/DELETE blocked (trigger + no policy).
DROP POLICY IF EXISTS "Users select own notifications" ON public.notifications;
CREATE POLICY "Users select own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- No UPDATE policy for authenticated — REVOKE UPDATE and trigger enforces this.
-- service_role bypasses RLS entirely.

-- 9.3 notification_preferences policies
DROP POLICY IF EXISTS "Users select own preferences" ON public.notification_preferences;
CREATE POLICY "Users select own preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own preferences" ON public.notification_preferences;
CREATE POLICY "Users update own preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 9.4 email_outbox: no client policies (fully server-only)
-- No policies created — default deny for all roles.

-- 9.5 notification_type_registry: public read (catalog data)
DROP POLICY IF EXISTS "Public read notification types" ON public.notification_type_registry;
CREATE POLICY "Public read notification types" ON public.notification_type_registry
  FOR SELECT TO authenticated, anon USING (true);

-- ---------------------------------------------------------------------------
-- SECTION 10: Permission Grants & Security Lockdown
-- ---------------------------------------------------------------------------

-- notifications: clients get SELECT only; no INSERT, UPDATE, DELETE
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.notifications TO authenticated;

-- notification_preferences: clients get SELECT + UPDATE (own row, RLS-gated)
REVOKE ALL ON TABLE public.notification_preferences FROM anon, authenticated, PUBLIC;
GRANT SELECT, UPDATE ON TABLE public.notification_preferences TO authenticated;

-- email_outbox: fully server-only
REVOKE ALL ON TABLE public.email_outbox FROM anon, authenticated, PUBLIC;

-- notification_type_registry: public read catalog
REVOKE ALL ON TABLE public.notification_type_registry FROM anon, authenticated, PUBLIC;
GRANT SELECT ON TABLE public.notification_type_registry TO authenticated, anon;

-- service_role: ALL on all notification tables
GRANT ALL ON TABLE public.notifications TO service_role;
GRANT ALL ON TABLE public.notification_preferences TO service_role;
GRANT ALL ON TABLE public.email_outbox TO service_role;
GRANT ALL ON TABLE public.notification_type_registry TO service_role;

-- RPC functions: server-only (postgres + service_role)
REVOKE EXECUTE ON FUNCTION public.provision_notification_preferences FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_notification_preferences TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.mark_notification_read FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count TO postgres, service_role;

-- Trigger guard functions: locked
REVOKE EXECUTE ON FUNCTION public.enforce_notification_preferences_server_insert FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_notifications_server_only FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_outbox_set_updated_at FROM PUBLIC, anon, authenticated;

-- Default privileges: lock down future tables in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated, PUBLIC;
