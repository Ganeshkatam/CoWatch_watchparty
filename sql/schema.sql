-- ============================================================================
-- CoWatch WatchParty: Comprehensive Database Schema
-- Production-Ready Bootstrap Schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------

-- 2.1 Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamp with time zone DEFAULT now(),
  username text,
  display_name text,
  avatar_url text,
  pref_show_chat_column boolean NOT NULL DEFAULT true,
  pref_show_people_column boolean NOT NULL DEFAULT false,
  pref_disable_chat_sound boolean NOT NULL DEFAULT false,
  pref_camera_on boolean NOT NULL DEFAULT false,
  pref_mic_on boolean NOT NULL DEFAULT false,
  pref_appearance_mode text NOT NULL DEFAULT 'system' CHECK (pref_appearance_mode IN ('light', 'mantine', 'system')),
  CONSTRAINT profiles_display_name_length CHECK (display_name IS NULL OR (char_length(display_name) >= 1 AND char_length(display_name) <= 50))
);

COMMENT ON TABLE public.profiles IS 'User profiles linked to auth.users with user preferences and display info.';
COMMENT ON COLUMN public.profiles.id IS 'Unique user identifier linked to Supabase Auth.';
COMMENT ON COLUMN public.profiles.updated_at IS 'Timestamp of the last profile update.';
COMMENT ON COLUMN public.profiles.username IS 'User chosen username.';
COMMENT ON COLUMN public.profiles.display_name IS 'User display name.';
COMMENT ON COLUMN public.profiles.avatar_url IS 'URL to user avatar image.';
COMMENT ON COLUMN public.profiles.pref_show_chat_column IS 'Preference to show the chat column.';
COMMENT ON COLUMN public.profiles.pref_show_people_column IS 'Preference to show the people column.';
COMMENT ON COLUMN public.profiles.pref_disable_chat_sound IS 'Preference to disable chat notification sounds.';
COMMENT ON COLUMN public.profiles.pref_camera_on IS 'Preference to turn camera on by default.';
COMMENT ON COLUMN public.profiles.pref_mic_on IS 'Preference to turn microphone on by default.';
COMMENT ON COLUMN public.profiles.pref_appearance_mode IS 'Preference for UI theme mode.';

-- 2.2 Rooms Table
CREATE TABLE IF NOT EXISTS public.rooms (
  "roomId" text PRIMARY KEY,
  "creationTime" timestamp with time zone,
  passcode text,
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  "isChatDisabled" boolean NOT NULL DEFAULT false,
  "isSubRoom" boolean,
  coverPhoto text,
  data jsonb,
  "lastUpdateTime" timestamp with time zone,
  "roomTitle" text NOT NULL,
  "roomDescription" text,
  "mediaPath" text,
  status text NOT NULL DEFAULT 'active',
  "startedAt" timestamp with time zone NOT NULL,
  "expiresAt" timestamp with time zone,
  "endedAt" timestamp with time zone,
  "lastActiveAt" timestamp with time zone,
  "isPermanent" boolean NOT NULL DEFAULT false,
  owner_passcode text NOT NULL,
  "scheduledStartsAt" timestamp with time zone,
  passcode_fingerprint text NOT NULL,
  room_kind text NOT NULL DEFAULT 'watch',
  participants_locked boolean NOT NULL DEFAULT false,
  max_participants integer NOT NULL DEFAULT 10 CHECK (max_participants >= 2 AND max_participants <= 10),
  CONSTRAINT room_status_check CHECK (status IN ('scheduled', 'active', 'inactive', 'ended', 'expired')),
  CONSTRAINT room_title_not_empty CHECK (btrim("roomTitle") <> ''),
  CONSTRAINT rooms_expiration_policy_check CHECK (
    ("isPermanent" = true AND "expiresAt" IS NULL) OR
    ("isPermanent" = false AND "expiresAt" IS NOT NULL)
  ),
  CONSTRAINT rooms_passcode_fingerprint_key UNIQUE (passcode_fingerprint)
);

COMMENT ON TABLE public.rooms IS 'Rooms table storing active, permanent, and archived watch parties.';
COMMENT ON COLUMN public.rooms."roomId" IS 'Unique identifier for the room.';
COMMENT ON COLUMN public.rooms."creationTime" IS 'Timestamp when the room was first created.';
COMMENT ON COLUMN public.rooms.passcode IS 'Bcrypt hashed password for private rooms.';
COMMENT ON COLUMN public.rooms.owner_id IS 'User ID of the room owner.';
COMMENT ON COLUMN public.rooms."isChatDisabled" IS 'Whether chat is disabled for all users in the room.';
COMMENT ON COLUMN public.rooms."isSubRoom" IS 'Indicates if this is a sub-room (breakout room).';
COMMENT ON COLUMN public.rooms.data IS 'Additional flexible metadata for the room.';
COMMENT ON COLUMN public.rooms."lastUpdateTime" IS 'Timestamp of the last room activity or state change.';
COMMENT ON COLUMN public.rooms."roomTitle" IS 'Display title of the room.';
COMMENT ON COLUMN public.rooms."roomDescription" IS 'Text description of the room content.';
COMMENT ON COLUMN public.rooms."mediaPath" IS 'URL or path to the current media being played.';
COMMENT ON COLUMN public.rooms.status IS 'Current lifecycle status (scheduled, active, inactive, ended, expired).';
COMMENT ON COLUMN public.rooms."startedAt" IS 'Timestamp when the room became active.';
COMMENT ON COLUMN public.rooms."expiresAt" IS 'Timestamp when the room is scheduled to expire.';
COMMENT ON COLUMN public.rooms."endedAt" IS 'Timestamp when the room was explicitly ended.';
COMMENT ON COLUMN public.rooms."isPermanent" IS 'True if the room is permanent with no expiration.';
COMMENT ON COLUMN public.rooms.room_kind IS 'Category of room (watch or permanent).';
COMMENT ON COLUMN public.rooms.participants_locked IS 'Authoritative admission lock flag for LOCK-001.';

-- 2.3 Room Lifecycle Events (Audit Log)
CREATE TABLE IF NOT EXISTS public.room_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomId" text NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  actor text NOT NULL,
  event text NOT NULL,
  "previousStatus" text,
  "newStatus" text,
  "previousExpiresAt" timestamp with time zone,
  "newExpiresAt" timestamp with time zone,
  reason text,
  timestamp timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.room_lifecycle_events IS 'Audit log tracking status, lifetime, and admission events of rooms.';

-- 2.4 Room Messages Table
CREATE TABLE IF NOT EXISTS public.room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  message text NOT NULL,
  message_type text NOT NULL DEFAULT 'user' CHECK (message_type IN ('user', 'system')),
  event_type text,
  metadata jsonb,
  client_message_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone,
  CONSTRAINT room_messages_client_message_id_key UNIQUE (room_id, user_id, client_message_id),
  CONSTRAINT room_messages_updated_at_check CHECK (updated_at IS NULL OR updated_at >= created_at),
  CONSTRAINT room_messages_type_check CHECK (message_type IN ('user', 'system')),
  CONSTRAINT room_messages_event_check CHECK (
    (message_type = 'user' AND event_type IS NULL) OR
    (message_type = 'system' AND event_type IS NOT NULL)
  ),
  CONSTRAINT room_messages_not_empty CHECK (btrim(message) <> '')
);

COMMENT ON TABLE public.room_messages IS 'Persistent chat messages and system announcements within rooms.';

-- 2.5 Announcements Table
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  level text NOT NULL CHECK (level IN ('info', 'success', 'warning', 'critical')),
  action_label text,
  action_url text,
  is_active boolean NOT NULL DEFAULT true,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.announcements IS 'Global application announcements displayed on user dashboards.';

-- 2.6 Virtual Browser Providers
CREATE TABLE IF NOT EXISTS public.vbrowser_providers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('cloud', 'docker')),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'ENABLED', 'DISABLED', 'RETIRED')),
  max_concurrent_sessions integer,
  max_sessions_per_user integer,
  max_sessions_per_room integer,
  max_large_sessions integer,
  max_session_duration_seconds integer,
  max_large_session_duration_seconds integer,
  CONSTRAINT vbrowser_providers_id_not_empty CHECK (btrim(id) <> ''),
  CONSTRAINT vbrowser_providers_display_name_not_empty CHECK (btrim(display_name) <> '')
);

COMMENT ON TABLE public.vbrowser_providers IS 'Virtual browser infrastructure providers and capacity constraints.';

-- 2.7 Virtual Browser Pools
CREATE TABLE IF NOT EXISTS public.vbrowser_pools (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT,
  region text NOT NULL,
  is_large boolean NOT NULL DEFAULT false,
  min_size integer NOT NULL DEFAULT 0 CHECK (min_size >= 0),
  limit_size integer CHECK (limit_size IS NULL OR limit_size >= min_size),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'ENABLED', 'DISABLED', 'RETIRED')),
  max_sessions_per_user integer,
  max_sessions_per_room integer,
  max_large_sessions integer,
  max_session_duration_seconds integer,
  max_large_session_duration_seconds integer,
  CONSTRAINT vbrowser_pools_id_not_empty CHECK (btrim(id) <> '')
);

COMMENT ON TABLE public.vbrowser_pools IS 'Regional compute pools belonging to virtual browser providers.';

-- 2.8 Virtual Browser VM Instances
CREATE TABLE IF NOT EXISTS public.vbrowser (
  id bigserial PRIMARY KEY,
  pool text NOT NULL,
  vmid text NOT NULL,
  state text NOT NULL,
  "creationTime" timestamp with time zone NOT NULL,
  "heartbeatTime" timestamp with time zone,
  "assignTime" timestamp with time zone,
  "roomId" text,
  uid text,
  data json,
  retries integer DEFAULT 0,
  pass text,
  image text,
  provider_id text REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT,
  pool_id text REFERENCES public.vbrowser_pools(id) ON DELETE RESTRICT,
  expires_at timestamp with time zone,
  released_at timestamp with time zone
);

COMMENT ON TABLE public.vbrowser IS 'Individual virtual browser VM instance allocation registry.';

-- 2.9 Virtual Browser Reservations
CREATE TABLE IF NOT EXISTS public.vbrowser_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL REFERENCES public.vbrowser_providers(id),
  pool_id text NOT NULL REFERENCES public.vbrowser_pools(id),
  room_id text NOT NULL REFERENCES public.rooms("roomId"),
  user_id text NOT NULL,
  is_large boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'ALLOCATED', 'RELEASED', 'FAILED', 'EXPIRED')),
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  heartbeat_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  released_at timestamp with time zone,
  failure_reason text
);

COMMENT ON TABLE public.vbrowser_reservations IS 'Active session leases and capacity reservations for virtual browsers.';

-- 2.10 Subscription Plans (Product Tier Catalog - POLICY-001)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY CHECK (length(id) > 0 AND id ~ '^[a-z0-9_-]+$'),
  display_name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  max_total_rooms integer NOT NULL CHECK (max_total_rooms >= 0),
  max_watch_rooms integer NOT NULL CHECK (max_watch_rooms >= 0),
  max_permanent_rooms integer NOT NULL CHECK (max_permanent_rooms >= 0),
  max_participant_capacity integer NOT NULL CHECK (max_participant_capacity >= 2 AND max_participant_capacity <= 500),
  max_room_duration_hours integer NOT NULL DEFAULT 24 CHECK (max_room_duration_hours >= 1 AND max_room_duration_hours <= 720),
  is_vbrowser_allowed boolean NOT NULL DEFAULT false,
  max_vbrowser_concurrency integer NOT NULL DEFAULT 0 CHECK (max_vbrowser_concurrency >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT check_watch_lte_total CHECK (max_watch_rooms <= max_total_rooms),
  CONSTRAINT check_permanent_lte_total CHECK (max_permanent_rooms <= max_total_rooms),
  CONSTRAINT check_vbrowser_concurrency_allowed CHECK (is_vbrowser_allowed OR max_vbrowser_concurrency = 0)
);

COMMENT ON TABLE public.subscription_plans IS 'Authoritative product and tier catalog defining quota, capacity, and feature entitlements.';

-- 2.11 Account Room Limits (Account Entitlement Layer - POLICY-001)
CREATE TABLE IF NOT EXISTS public.account_room_limits (
  account_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.subscription_plans(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  override_total_rooms integer CHECK (override_total_rooms IS NULL OR override_total_rooms >= 0),
  override_watch_rooms integer CHECK (override_watch_rooms IS NULL OR override_watch_rooms >= 0),
  override_permanent_rooms integer CHECK (override_permanent_rooms IS NULL OR override_permanent_rooms >= 0),
  override_participant_capacity integer CHECK (override_participant_capacity IS NULL OR (override_participant_capacity >= 2 AND override_participant_capacity <= 500)),
  override_room_duration_hours integer CHECK (override_room_duration_hours IS NULL OR (override_room_duration_hours >= 1 AND override_room_duration_hours <= 720)),
  override_vbrowser_allowed boolean,
  override_vbrowser_concurrency integer CHECK (override_vbrowser_concurrency IS NULL OR override_vbrowser_concurrency >= 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT check_override_watch_lte_total CHECK (override_watch_rooms IS NULL OR override_total_rooms IS NULL OR override_watch_rooms <= override_total_rooms),
  CONSTRAINT check_override_permanent_lte_total CHECK (override_permanent_rooms IS NULL OR override_total_rooms IS NULL OR override_permanent_rooms <= override_total_rooms)
);

COMMENT ON TABLE public.account_room_limits IS 'Per-account subscription tier binding and optional administrative overrides.';

-- 2.12 Account Room Usage (Quota Model B Materialized Cache)
CREATE TABLE IF NOT EXISTS public.account_room_usage (
  account_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_rooms integer NOT NULL DEFAULT 0 CHECK (total_rooms >= 0),
  watch_rooms integer NOT NULL DEFAULT 0 CHECK (watch_rooms >= 0),
  permanent_rooms integer NOT NULL DEFAULT 0 CHECK (permanent_rooms >= 0),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_room_usage IS 'Materialized counter cache of active rooms per account under transactional locks.';

-- 2.12 Room Quota Events (Audit Log)
CREATE TABLE IF NOT EXISTS public.room_quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.profiles(id),
  room_id text REFERENCES public.rooms("roomId") ON DELETE SET NULL,
  room_kind text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED', 'DELETED', 'EXPIRED', 'ENDED', 'PERMANENCE_CHANGED', 'REJECTED', 'PURGED')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.room_quota_events IS 'Comprehensive audit log of room creation, termination, and quota events.';

-- 2.13 Active Users Table
CREATE TABLE IF NOT EXISTS public.active_user (
  uid text PRIMARY KEY,
  "lastActiveTime" timestamp with time zone
);

COMMENT ON TABLE public.active_user IS 'Tracks live socket activity timestamps for users.';

-- ----------------------------------------------------------------------------
-- 3. INDEXES
-- ----------------------------------------------------------------------------

-- Profiles
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);

-- Rooms
CREATE INDEX IF NOT EXISTS room_owner_id_idx ON public.rooms USING btree (owner_id);
CREATE INDEX IF NOT EXISTS "room_creationTime_idx" ON public.rooms USING btree ("creationTime");
CREATE INDEX IF NOT EXISTS "room_roomId_idx" ON public.rooms USING gin ("roomId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_room_expires_at ON public.rooms USING btree ("expiresAt") WHERE ("expiresAt" IS NOT NULL AND status = 'active');
CREATE INDEX IF NOT EXISTS rooms_inactivity_idx ON public.rooms USING btree ("lastActiveAt") WHERE (status = 'active');
CREATE INDEX IF NOT EXISTS idx_rooms_owner_quota_eval ON public.rooms USING btree (owner_id, status, "isPermanent", "expiresAt");

-- Room Lifecycle Events
CREATE INDEX IF NOT EXISTS idx_room_lifecycle_events_room_id ON public.room_lifecycle_events USING btree ("roomId");
CREATE INDEX IF NOT EXISTS idx_room_lifecycle_events_timestamp ON public.room_lifecycle_events USING btree (timestamp);

-- Room Messages
CREATE INDEX IF NOT EXISTS room_messages_room_created_id_idx ON public.room_messages USING btree (room_id, created_at DESC, id DESC);

-- Announcements
CREATE INDEX IF NOT EXISTS idx_announcements_active_published ON public.announcements USING btree (is_active, published_at DESC);

-- VBrowser Pools & Providers
CREATE INDEX IF NOT EXISTS vbrowser_pools_provider_id_idx ON public.vbrowser_pools USING btree (provider_id);
CREATE INDEX IF NOT EXISTS vbrowser_provider_id_idx ON public.vbrowser USING btree (provider_id);
CREATE INDEX IF NOT EXISTS vbrowser_pool_id_idx ON public.vbrowser USING btree (pool_id);
CREATE UNIQUE INDEX IF NOT EXISTS vbrowser_pool_vmid_idx ON public.vbrowser USING btree (pool, vmid);
CREATE INDEX IF NOT EXISTS vbrowser_pool_state_idx ON public.vbrowser USING btree (pool, state);
CREATE INDEX IF NOT EXISTS "vbrowser_roomId_idx" ON public.vbrowser USING btree ("roomId");
CREATE INDEX IF NOT EXISTS vbrowser_uid_idx ON public.vbrowser USING btree (uid);
CREATE INDEX IF NOT EXISTS vbrowser_active_lease_idx ON public.vbrowser USING btree (provider_id, pool_id, "heartbeatTime") WHERE (state = ANY (ARRAY['staging'::text, 'used'::text]) AND released_at IS NULL);

-- VBrowser Reservations
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_provider_idx ON public.vbrowser_reservations USING btree (provider_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_pool_idx ON public.vbrowser_reservations USING btree (pool_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_room_idx ON public.vbrowser_reservations USING btree (provider_id, room_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_user_idx ON public.vbrowser_reservations USING btree (provider_id, user_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_expiry_idx ON public.vbrowser_reservations USING btree (expires_at) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));

-- Room Quota Events
CREATE INDEX IF NOT EXISTS idx_room_quota_events_account ON public.room_quota_events USING btree (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_quota_events_room_id ON public.room_quota_events USING btree (room_id);

-- ----------------------------------------------------------------------------
-- 4. FUNCTIONS & PROCEDURES
-- ----------------------------------------------------------------------------

-- 4.1 Update Timestamp Trigger Function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4.2 Helper: Resolve Default Subscription Plan ID
CREATE OR REPLACE FUNCTION public.get_default_subscription_plan_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id text;
BEGIN
  SELECT id INTO v_plan_id
  FROM public.subscription_plans
  WHERE is_default = true AND is_active = true
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'DEFAULT_SUBSCRIPTION_PLAN_NOT_CONFIGURED';
  END IF;

  RETURN v_plan_id;
END;
$$;

-- 4.3 Centralized Entitlement Authority Resolver (POLICY-001)
CREATE OR REPLACE FUNCTION public.resolve_account_entitlement(p_account_id uuid)
RETURNS TABLE (
  account_id uuid,
  plan_id text,
  plan_display_name text,
  enabled boolean,
  max_total_rooms integer,
  max_watch_rooms integer,
  max_permanent_rooms integer,
  max_participant_capacity integer,
  max_room_duration_hours integer,
  is_vbrowser_allowed boolean,
  max_vbrowser_concurrency integer,
  has_overrides boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_rec RECORD;
  v_eff_total integer;
  v_eff_watch integer;
  v_eff_permanent integer;
  v_eff_capacity integer;
  v_eff_duration integer;
  v_eff_vbrowser_allowed boolean;
  v_eff_vbrowser_concurrency integer;
  v_has_overrides boolean;
BEGIN
  SELECT 
    l.account_id,
    l.plan_id,
    p.display_name AS plan_display_name,
    l.enabled,
    p.max_total_rooms AS base_total,
    p.max_watch_rooms AS base_watch,
    p.max_permanent_rooms AS base_permanent,
    p.max_participant_capacity AS base_capacity,
    p.max_room_duration_hours AS base_duration,
    p.is_vbrowser_allowed AS base_vbrowser_allowed,
    p.max_vbrowser_concurrency AS base_vbrowser_concurrency,
    l.override_total_rooms,
    l.override_watch_rooms,
    l.override_permanent_rooms,
    l.override_participant_capacity,
    l.override_room_duration_hours,
    l.override_vbrowser_allowed,
    l.override_vbrowser_concurrency
  INTO v_rec
  FROM public.account_room_limits l
  JOIN public.subscription_plans p ON l.plan_id = p.id
  WHERE l.account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_ENTITLEMENT_NOT_FOUND';
  END IF;

  v_eff_total := COALESCE(v_rec.override_total_rooms, v_rec.base_total);
  v_eff_watch := LEAST(COALESCE(v_rec.override_watch_rooms, v_rec.base_watch), v_eff_total);
  v_eff_permanent := LEAST(COALESCE(v_rec.override_permanent_rooms, v_rec.base_permanent), v_eff_total);
  v_eff_capacity := COALESCE(v_rec.override_participant_capacity, v_rec.base_capacity);
  v_eff_duration := COALESCE(v_rec.override_room_duration_hours, v_rec.base_duration);
  v_eff_vbrowser_allowed := COALESCE(v_rec.override_vbrowser_allowed, v_rec.base_vbrowser_allowed);
  v_eff_vbrowser_concurrency := CASE 
    WHEN NOT v_eff_vbrowser_allowed THEN 0
    ELSE COALESCE(v_rec.override_vbrowser_concurrency, v_rec.base_vbrowser_concurrency)
  END;

  v_has_overrides := (
    v_rec.override_total_rooms IS NOT NULL OR
    v_rec.override_watch_rooms IS NOT NULL OR
    v_rec.override_permanent_rooms IS NOT NULL OR
    v_rec.override_participant_capacity IS NOT NULL OR
    v_rec.override_room_duration_hours IS NOT NULL OR
    v_rec.override_vbrowser_allowed IS NOT NULL OR
    v_rec.override_vbrowser_concurrency IS NOT NULL
  );

  account_id := v_rec.account_id;
  plan_id := v_rec.plan_id;
  plan_display_name := v_rec.plan_display_name;
  enabled := v_rec.enabled;
  max_total_rooms := v_eff_total;
  max_watch_rooms := v_eff_watch;
  max_permanent_rooms := v_eff_permanent;
  max_participant_capacity := v_eff_capacity;
  max_room_duration_hours := v_eff_duration;
  is_vbrowser_allowed := v_eff_vbrowser_allowed;
  max_vbrowser_concurrency := v_eff_vbrowser_concurrency;
  has_overrides := v_has_overrides;

  RETURN NEXT;
END;
$$;

-- 4.4 Handle New Auth User Profile Creation (Neutral Identity Trigger)
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
  INSERT INTO public.profiles (
    id,
    username,
    avatar_url,
    display_name
  )
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
    avatar_url = COALESCE(public.profiles.avatar_url, excluded.avatar_url),
    display_name = COALESCE(public.profiles.display_name, excluded.display_name);

  -- 3. Explicitly assign onboarding default plan without numeric limits
  INSERT INTO public.account_room_limits (
    account_id,
    plan_id,
    enabled,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    v_default_plan,
    true,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (account_id) DO NOTHING;

  -- 4. Provision usage ledger record
  INSERT INTO public.account_room_usage (
    account_id,
    total_rooms,
    watch_rooms,
    permanent_rooms,
    updated_at
  )
  VALUES (
    NEW.id,
    0,
    0,
    0,
    clock_timestamp()
  )
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 4.3 Email Domain Validation Trigger Function
CREATE OR REPLACE FUNCTION public.check_user_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  normalized_email text;
  email_domain text;
BEGIN
  normalized_email := lower(trim(coalesce(NEW.email, '')));

  IF normalized_email = ''
     OR position('@' IN normalized_email) <= 1
     OR position('@' IN substring(normalized_email FROM position('@' IN normalized_email) + 1)) > 0
     OR normalized_email ~ '[[:space:]]'
  THEN
    RAISE EXCEPTION 'Email provider is not supported.';
  END IF;

  email_domain := split_part(normalized_email, '@', 2);

  IF email_domain NOT IN (
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'zoho.com',
    'proton.me',
    'protonmail.com'
  ) THEN
    RAISE EXCEPTION 'Email provider is not supported.';
  END IF;

  RETURN NEW;
END;
$$;

-- 4.4 Delete Unconfirmed Users Maintenance Procedure
CREATE OR REPLACE FUNCTION public.delete_unconfirmed_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN 
    SELECT id FROM auth.users 
    WHERE email_confirmed_at IS NULL AND created_at < now() - interval '7 days'
  LOOP
    DELETE FROM public.rooms WHERE owner_id = rec.id;
    
    DELETE FROM storage.objects 
    WHERE bucket_id = 'avatars' 
      AND (name LIKE rec.id::text || '/%');
      
    DELETE FROM auth.users WHERE id = rec.id;
  END LOOP;
END;
$$;

-- 4.5 Reserve Virtual Browser Capacity
CREATE OR REPLACE FUNCTION public.reserve_vbrowser_capacity(
  p_provider_id text,
  p_pool_id text,
  p_room_id text,
  p_user_id text,
  p_is_large boolean,
  p_config_provider_limit integer,
  p_config_pool_limit integer,
  p_lease_seconds integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  provider_row public.vbrowser_providers%ROWTYPE;
  pool_row public.vbrowser_pools%ROWTYPE;
  active_provider integer;
  active_pool integer;
  active_user integer;
  active_room integer;
  active_large integer;
  effective_provider integer;
  effective_pool integer;
  effective_user integer;
  effective_room integer;
  effective_large integer;
  reservation_id uuid;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_config_provider_limit < 0 OR p_config_pool_limit < 0 THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pool_id, 0));

  SELECT * INTO provider_row FROM public.vbrowser_providers WHERE id = p_provider_id FOR UPDATE;
  SELECT * INTO pool_row FROM public.vbrowser_pools WHERE id = p_pool_id FOR UPDATE;

  IF NOT FOUND OR pool_row.provider_id <> p_provider_id OR NOT provider_row.enabled OR provider_row.lifecycle <> 'ENABLED' OR NOT pool_row.enabled OR pool_row.lifecycle <> 'ENABLED' THEN
    RAISE EXCEPTION 'POLICY_MISSING_OR_DISABLED';
  END IF;

  IF provider_row.max_concurrent_sessions IS NULL OR provider_row.max_sessions_per_user IS NULL OR provider_row.max_sessions_per_room IS NULL OR provider_row.max_large_sessions IS NULL OR pool_row.limit_size IS NULL OR pool_row.max_sessions_per_user IS NULL OR pool_row.max_sessions_per_room IS NULL OR pool_row.max_large_sessions IS NULL THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;

  effective_provider := LEAST(provider_row.max_concurrent_sessions, p_config_provider_limit);
  effective_pool := LEAST(pool_row.limit_size, effective_provider, p_config_pool_limit);
  effective_user := LEAST(provider_row.max_sessions_per_user, pool_row.max_sessions_per_user);
  effective_room := LEAST(provider_row.max_sessions_per_room, pool_row.max_sessions_per_room);
  effective_large := LEAST(provider_row.max_large_sessions, pool_row.max_large_sessions);

  UPDATE public.vbrowser_reservations
  SET status = 'EXPIRED', released_at = now(), failure_reason = 'LEASE_EXPIRED'
  WHERE status IN ('RESERVED', 'ALLOCATED') AND expires_at <= now();

  SELECT count(*) INTO active_provider FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_pool FROM public.vbrowser_reservations WHERE pool_id = p_pool_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_user FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND user_id = p_user_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_room FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND room_id = p_room_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_large FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND is_large AND status IN ('RESERVED', 'ALLOCATED');

  IF active_provider >= effective_provider THEN RAISE EXCEPTION 'PROVIDER_CAPACITY_EXCEEDED'; END IF;
  IF active_pool >= effective_pool THEN RAISE EXCEPTION 'POOL_CAPACITY_EXCEEDED'; END IF;
  IF active_user >= effective_user THEN RAISE EXCEPTION 'USER_CAPACITY_EXCEEDED'; END IF;
  IF active_room >= effective_room THEN RAISE EXCEPTION 'ROOM_CAPACITY_EXCEEDED'; END IF;
  IF p_is_large AND active_large >= effective_large THEN RAISE EXCEPTION 'LARGE_CAPACITY_EXCEEDED'; END IF;

  INSERT INTO public.vbrowser_reservations (provider_id, pool_id, room_id, user_id, is_large, expires_at)
  VALUES (p_provider_id, p_pool_id, p_room_id, p_user_id, p_is_large, now() + make_interval(secs => p_lease_seconds))
  RETURNING id INTO reservation_id;

  RETURN reservation_id;
END;
$$;

-- 4.6 Authoritative Room Creation (Plan-Driven Quota & Duration Enforcement - POLICY-001)
CREATE OR REPLACE FUNCTION public.create_room_authoritative(
  p_account_id uuid,
  p_room_id text,
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
) RETURNS jsonb
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
BEGIN
  IF p_room_kind NOT IN ('watch', 'permanent') THEN
    RAISE EXCEPTION 'ROOM_KIND_INVALID';
  END IF;

  -- 1. Ensure usage row exists
  INSERT INTO public.account_room_usage (account_id, updated_at)
  VALUES (p_account_id, v_now)
  ON CONFLICT (account_id) DO NOTHING;

  -- 2. UNIFIED ATOMIC LOCK: Lock entitlement row AND usage row in order
  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 3. Resolve centralized effective entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', jsonb_build_object('reason', 'ACCOUNT_ROOMS_DISABLED', 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 4. Auto-expire overdue rooms for this account to immediately reclaim capacity
  UPDATE public.rooms
  SET status = 'expired', "endedAt" = v_now
  WHERE owner_id = p_account_id 
    AND status IN ('active', 'inactive') 
    AND "isPermanent" = false 
    AND "expiresAt" IS NOT NULL 
    AND "expiresAt" <= v_now;

  -- 5. Single-Pass Aggregate Room Count: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 6. Enforce Total Room Ceiling (Grandfathering: existing rooms preserved, new creation blocked if at/above limit)
  IF v_usage.total >= v_entitlement.max_total_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'TOTAL_ROOM_LIMIT_EXCEEDED', 'limit', v_entitlement.max_total_rooms, 'current', v_usage.total, 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 7. Enforce Room Kind Sub-Limit
  IF p_room_kind = 'watch' AND v_usage.watch >= v_entitlement.max_watch_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'watch', 'limit', v_entitlement.max_watch_rooms, 'current', v_usage.watch, 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'permanent', 'limit', v_entitlement.max_permanent_rooms, 'current', v_usage.permanent, 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 8. Enforce Participant Capacity Cap (Bounded by plan capacity)
  v_effective_capacity := COALESCE(p_requested_participants, v_entitlement.max_participant_capacity);
  IF v_effective_capacity < 2 OR v_effective_capacity > v_entitlement.max_participant_capacity THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_CAPACITY';
  END IF;

  -- 9. Enforce Expiration Duration (Server-side validation against plan max_room_duration_hours)
  IF v_is_permanent THEN
    v_effective_expires_at := NULL;
  ELSE
    IF p_expires_at IS NULL THEN
      v_effective_expires_at := v_now + make_interval(hours => v_entitlement.max_room_duration_hours);
    ELSE
      IF p_expires_at <= v_now THEN
        RAISE EXCEPTION 'INVALID_EXPIRATION_TIME';
      END IF;
      IF p_expires_at > v_now + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
        RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
      END IF;
      v_effective_expires_at := p_expires_at;
    END IF;
  END IF;

  -- 10. Insert Authoritative Room Row
  INSERT INTO public.rooms (
    "roomId", "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind, max_participants
  ) VALUES (
    p_room_id, v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, v_effective_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind, v_effective_capacity
  );

  -- 11. Update Materialized Usage Record
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total + 1,
      watch_rooms = v_usage.watch + CASE WHEN p_room_kind = 'watch' THEN 1 ELSE 0 END,
      permanent_rooms = v_usage.permanent + CASE WHEN p_room_kind = 'permanent' THEN 1 ELSE 0 END,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 12. Audit Record & Lifecycle Event
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, p_room_kind, 'CREATED', jsonb_build_object('total_rooms', v_usage.total + 1));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, p_account_id::text, 'room.created', 'inactive', v_effective_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'roomKind', p_room_kind,
    'totalRooms', v_usage.total + 1,
    'maxTotal', v_entitlement.max_total_rooms,
    'maxCapacity', v_effective_capacity,
    'maxParticipants', v_effective_capacity,
    'expiresAt', v_effective_expires_at
  );
END;
$$;

-- 4.7 Authoritative Room Deletion
CREATE OR REPLACE FUNCTION public.delete_room_authoritative(
  p_account_id uuid,
  p_room_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_usage RECORD;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'active' THEN
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_DELETE';
  END IF;

  -- 3. Delete Room Row (cascades chat/events)
  DELETE FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 4. Single-Pass Aggregate Recalculation: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 5. Update Usage Row
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 6. Audit Event
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, NULL, v_room.room_kind, 'DELETED', jsonb_build_object('room_id', p_room_id, 'total_rooms', v_usage.total));

  RETURN jsonb_build_object(
    'deletedRoomId', p_room_id,
    'roomKind', v_room.room_kind,
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;

-- 4.8 Authoritative Room Termination
CREATE OR REPLACE FUNCTION public.end_room_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_actor text DEFAULT 'host'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_usage RECORD;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status IN ('ended', 'expired') THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', v_room.status, 'alreadyConcluded', true);
  END IF;

  -- 3. Transition to ended state
  UPDATE public.rooms
  SET status = 'ended', "endedAt" = v_now
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 4. Single-Pass Aggregate Recalculation: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 5. Update Usage Row (Slot immediately reclaimed)
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 6. Audit & Lifecycle Logs
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, v_room.room_kind, 'ENDED', jsonb_build_object('total_rooms', v_usage.total));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_actor, 'room.ended', v_room.status, 'ended', v_room."expiresAt", v_room."expiresAt", 'session ended by host', v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', 'ended',
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;

-- 4.9 Authoritative Expiration Batch Scan
CREATE OR REPLACE FUNCTION public.expire_rooms_authoritative()
RETURNS TABLE(room_id text, owner_id uuid, room_kind text, previous_expires_at timestamp with time zone, ended_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_account RECORD;
  r RECORD;
  v_usage RECORD;
BEGIN
  -- 1. Discover distinct accounts with candidate expired rooms
  FOR v_account IN
    SELECT DISTINCT public.rooms.owner_id
    FROM public.rooms
    WHERE status IN ('active', 'inactive')
      AND "isPermanent" = false
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" <= v_now
  LOOP
    -- 2. UNIFIED LOCK: Lock account usage row FIRST
    PERFORM 1 
    FROM public.account_room_usage 
    WHERE account_room_usage.account_id = v_account.owner_id 
    FOR UPDATE;

    -- 3. Transition expired rooms for this account under lock
    FOR r IN
      UPDATE public.rooms
      SET status = 'expired', "endedAt" = v_now
      WHERE public.rooms.owner_id = v_account.owner_id
        AND public.rooms.status IN ('active', 'inactive') 
        AND public.rooms."isPermanent" = false 
        AND public.rooms."expiresAt" IS NOT NULL 
        AND public.rooms."expiresAt" <= v_now
      RETURNING public.rooms."roomId", public.rooms.owner_id, public.rooms.room_kind, public.rooms."expiresAt", public.rooms."endedAt"
    LOOP
      room_id := r."roomId";
      owner_id := r.owner_id;
      room_kind := r.room_kind;
      previous_expires_at := r."expiresAt";
      ended_at := r."endedAt";

      -- Audit Events
      INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
      VALUES (r.owner_id, r."roomId", r.room_kind, 'EXPIRED', '{}'::jsonb);

      INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
      VALUES (r."roomId", 'system', 'room.expired', 'active_or_inactive', 'expired', r."expiresAt", r."expiresAt", 'time limit reached', v_now);

      RETURN NEXT;
    END LOOP;

    -- 4. Recompute usage for this account in a single aggregate scan
    SELECT 
      count(*)::int AS total,
      count(*) FILTER (WHERE public.rooms.room_kind = 'watch')::int AS watch,
      count(*) FILTER (WHERE public.rooms.room_kind = 'permanent')::int AS permanent
    INTO v_usage
    FROM public.rooms
    WHERE public.rooms.owner_id = v_account.owner_id
      AND public.rooms.status IN ('scheduled', 'active', 'inactive')
      AND (public.rooms."isPermanent" = true OR public.rooms."expiresAt" > v_now);

    UPDATE public.account_room_usage
    SET total_rooms = v_usage.total,
        watch_rooms = v_usage.watch,
        permanent_rooms = v_usage.permanent,
        updated_at = v_now
    WHERE account_room_usage.account_id = v_account.owner_id;
  END LOOP;
END;
$$;

-- -- 4.10 Authoritative Room Extension (POLICY-001)
CREATE OR REPLACE FUNCTION public.extend_room_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_new_expires_at timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
  v_entitlement RECORD;
BEGIN
  -- 1. UNIFIED ATOMIC LOCK: Lock entitlement row AND usage row in order
  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Resolve centralized effective entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 3. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room."isPermanent" = true THEN
    RAISE EXCEPTION 'ROOM_IS_PERMANENT';
  END IF;

  IF v_room.status IN ('ended', 'expired') THEN
    RAISE EXCEPTION 'ROOM_ENDED_CANNOT_EXTEND';
  END IF;

  IF v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
    UPDATE public.rooms SET status = 'expired', "endedAt" = v_now WHERE public.rooms."roomId" = p_room_id;
    RAISE EXCEPTION 'ROOM_ALREADY_EXPIRED';
  END IF;

  IF p_new_expires_at <= v_room."expiresAt" THEN
    RAISE EXCEPTION 'INVALID_EXTENSION_TIME';
  END IF;

  -- Server-side max room duration enforcement
  IF p_new_expires_at > v_room."creationTime" + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
    RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
  END IF;

  -- 4. Atomically update expiresAt
  UPDATE public.rooms
  SET "expiresAt" = p_new_expires_at,
      "lastUpdateTime" = v_now
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id;

  -- 5. Audit
  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_account_id::text, 'room.extended', v_room.status, v_room.status, v_room."expiresAt", p_new_expires_at, 'user extended', v_now);

  RETURN p_new_expires_at;
END;
$$;

-- 4.11 Authoritative Account Purge
CREATE OR REPLACE FUNCTION public.purge_account_rooms_authoritative(
  p_account_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_deleted_ids text[] := ARRAY[]::text[];
  r RECORD;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = p_account_id 
  FOR UPDATE;

  -- 2. Audit and delete all rooms for this account
  FOR r IN
    SELECT public.rooms."roomId", public.rooms.room_kind, public.rooms.status
    FROM public.rooms
    WHERE public.rooms.owner_id = p_account_id
    FOR UPDATE
  LOOP
    v_deleted_ids := array_append(v_deleted_ids, r."roomId");

    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, r.room_kind, 'PURGED', jsonb_build_object('room_id', r."roomId", 'account_purge', true));

    INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", reason, timestamp)
    VALUES (r."roomId", p_account_id::text, 'room.deleted', r.status, 'deleted', 'account purged', v_now);
  END LOOP;

  DELETE FROM public.rooms WHERE public.rooms.owner_id = p_account_id;

  -- 3. Reset materialized usage to zero under lock
  UPDATE public.account_room_usage
  SET total_rooms = 0,
      watch_rooms = 0,
      permanent_rooms = 0,
      updated_at = v_now
  WHERE account_room_usage.account_id = p_account_id;

  RETURN v_deleted_ids;
END;
$$;

-- 4.12 Authoritative Room Activity Transition
CREATE OR REPLACE FUNCTION public.set_room_activity_authoritative(
  p_room_id text,
  p_status text,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
  v_usage RECORD;
  v_new_status text := p_status;
BEGIN
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = v_room.owner_id 
  FOR UPDATE;

  -- Re-read under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id
  FOR UPDATE;

  IF v_room.status IN ('ended') THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', v_room.status, 'unchanged', true);
  END IF;

  -- If temporary room has passed canonical expiresAt, transition to expired
  IF v_room."isPermanent" = false AND v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
    UPDATE public.rooms
    SET status = 'expired',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE public.rooms."roomId" = p_room_id;

    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (v_room.owner_id, p_room_id, v_room.room_kind, 'EXPIRED', '{"reason": "overdue_during_activity_change"}'::jsonb);

    INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
    VALUES (p_room_id, COALESCE(p_actor_id::text, 'system'), 'room.expired', v_room.status, 'expired', v_room."expiresAt", v_room."expiresAt", 'canonical expiry reached', v_now);

    v_new_status := 'expired';
  ELSE
    IF p_status = 'active' THEN
      UPDATE public.rooms
      SET status = 'active',
          "startedAt" = COALESCE("startedAt", v_now),
          "lastActiveAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE public.rooms."roomId" = p_room_id;
    ELSE
      UPDATE public.rooms
      SET status = 'inactive',
          "lastActiveAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE public.rooms."roomId" = p_room_id;
    END IF;

    IF v_room.status != p_status THEN
      INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
      VALUES (p_room_id, COALESCE(p_actor_id::text, 'system'), 'room.status_changed', v_room.status, p_status, v_room."expiresAt", v_room."expiresAt", 'activity transition', v_now);
    END IF;
  END IF;

  -- 2. Recompute materialized usage under lock
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE public.rooms.room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE public.rooms.room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE public.rooms.owner_id = v_room.owner_id
    AND public.rooms.status IN ('scheduled', 'active', 'inactive')
    AND (public.rooms."isPermanent" = true OR public.rooms."expiresAt" > v_now);

  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_room_usage.account_id = v_room.owner_id;

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', v_new_status,
    'expiresAt', v_room."expiresAt",
    'isPermanent', v_room."isPermanent"
  );
END;
$$;

-- 4.13 Authoritative Participant Lock Management (LOCK-001)
CREATE OR REPLACE FUNCTION public.set_room_participants_lock_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_locked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1
  FROM public.account_room_usage
  WHERE account_room_usage.account_id = p_account_id
  FOR UPDATE;

  -- 2. Lock and verify room ownership
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.owner_id != p_account_id THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  -- 3. Update field
  UPDATE public.rooms
  SET participants_locked = p_locked,
      "lastUpdateTime" = v_now
  WHERE public.rooms."roomId" = p_room_id;

  -- 4. Emit lifecycle audit event (no credentials logged)
  INSERT INTO public.room_lifecycle_events (
    "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
  )
  VALUES (
    p_room_id,
    p_account_id::text,
    CASE WHEN p_locked THEN 'room.participants_locked' ELSE 'room.participants_unlocked' END,
    v_room.status,
    v_room.status,
    CASE WHEN p_locked THEN 'participants locked' ELSE 'participants unlocked' END,
    v_now
  );

  -- 5. Return resulting state
  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'participants_locked', p_locked
  );
END;
$$;

-- -- 4.14 Authoritative Room Permanence Toggle (POLICY-001)
CREATE OR REPLACE FUNCTION public.set_room_permanence_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_is_permanent boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_entitlement RECORD;
  v_now timestamptz := clock_timestamp();
  v_new_kind text := CASE WHEN p_is_permanent THEN 'permanent' ELSE 'watch' END;
  v_new_expires timestamptz;
  v_usage RECORD;
BEGIN
  -- 1. UNIFIED ATOMIC LOCK: Lock entitlement row AND usage row in order
  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Resolve centralized effective entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 3. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'active' THEN
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_CHANGE_PERMANENCE';
  END IF;

  IF v_room."isPermanent" = p_is_permanent THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'isPermanent', p_is_permanent, 'unchanged', true);
  END IF;

  -- 4. Check quota for permanence change
  IF p_is_permanent THEN
    v_new_expires := NULL;

    SELECT count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
    INTO v_usage
    FROM public.rooms
    WHERE owner_id = p_account_id
      AND status IN ('scheduled', 'active', 'inactive')
      AND ("isPermanent" = true OR "expiresAt" > v_now);

    IF v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
      RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
    END IF;
  ELSE
    v_new_expires := v_now + make_interval(hours => v_entitlement.max_room_duration_hours);

    SELECT count(*) FILTER (WHERE room_kind = 'watch')::int AS watch
    INTO v_usage
    FROM public.rooms
    WHERE owner_id = p_account_id
      AND status IN ('scheduled', 'active', 'inactive')
      AND ("isPermanent" = true OR "expiresAt" > v_now);

    IF v_usage.watch >= v_entitlement.max_watch_rooms THEN
      RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
    END IF;
  END IF;

  -- 5. Update room row
  UPDATE public.rooms
  SET "isPermanent" = p_is_permanent,
      room_kind = v_new_kind,
      "isSubRoom" = p_is_permanent,
      "expiresAt" = v_new_expires
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 6. Recompute usage
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 7. Audit
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, v_new_kind, 'PERMANENCE_CHANGED', 
          jsonb_build_object('isPermanent', p_is_permanent, 'permanent_rooms', v_usage.permanent));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_account_id::text, 'room.permanence_changed', v_room.status, v_room.status, v_room."expiresAt", v_new_expires, 
          CASE WHEN p_is_permanent THEN 'converted to permanent' ELSE 'converted to temporary' END, v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'isPermanent', p_is_permanent,
    'roomKind', v_new_kind,
    'expiresAt', v_new_expires
  );
END;
$$;

-- 4.15 Authoritative Room Metadata & Settings Update
CREATE OR REPLACE FUNCTION public.update_room_metadata_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_title text,
  p_description text,
  p_is_chat_disabled boolean,
  p_cover_photo text,
  p_passcode_hash text,
  p_owner_passcode text,
  p_passcode_fingerprint text,
  p_clear_passcode boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_passcode_fingerprint IS NOT NULL AND NOT p_clear_passcode THEN
    PERFORM 1
    FROM public.rooms
    WHERE public.rooms.passcode_fingerprint = p_passcode_fingerprint
      AND public.rooms."roomId" != p_room_id;

    IF FOUND THEN
      RAISE EXCEPTION 'PASSCODE_TAKEN';
    END IF;
  END IF;

  UPDATE public.rooms
  SET "roomTitle" = COALESCE(p_title, "roomTitle"),
      "roomDescription" = CASE WHEN p_description IS NOT NULL THEN p_description ELSE "roomDescription" END,
      "isChatDisabled" = COALESCE(p_is_chat_disabled, "isChatDisabled"),
      coverPhoto = CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE coverPhoto END,
      passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_hash IS NOT NULL THEN p_passcode_hash ELSE passcode END,
      owner_passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_owner_passcode IS NOT NULL THEN p_owner_passcode ELSE owner_passcode END,
      passcode_fingerprint = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_fingerprint IS NOT NULL THEN p_passcode_fingerprint ELSE passcode_fingerprint END,
      "lastUpdateTime" = v_now
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id;

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", reason, timestamp)
  VALUES (p_room_id, p_account_id::text, 'room.metadata_updated', v_room.status, v_room.status, 'settings updated', v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'roomTitle', COALESCE(p_title, v_room."roomTitle"),
    'coverPhoto', CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE v_room.coverPhoto END
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. TRIGGERS
-- ----------------------------------------------------------------------------

-- Auth Users: Enforce domain restrictions BEFORE insert
DROP TRIGGER IF EXISTS trg_check_user_email_domain ON auth.users;
CREATE TRIGGER trg_check_user_email_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.check_user_email_domain();

-- Auth Users: Create profile on user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Profiles: Update updated_at
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- VBrowser Providers: Update updated_at
DROP TRIGGER IF EXISTS vbrowser_providers_set_updated_at ON public.vbrowser_providers;
CREATE TRIGGER vbrowser_providers_set_updated_at
  BEFORE UPDATE ON public.vbrowser_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- VBrowser Pools: Update updated_at
DROP TRIGGER IF EXISTS vbrowser_pools_set_updated_at ON public.vbrowser_pools;
CREATE TRIGGER vbrowser_pools_set_updated_at
  BEFORE UPDATE ON public.vbrowser_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) & POLICIES
-- ----------------------------------------------------------------------------

-- Enable RLS across all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_quota_events ENABLE ROW LEVEL SECURITY;

-- 6.1 Profiles Policies
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

-- 6.2 Rooms Policies
DROP POLICY IF EXISTS "Users can view their own rooms" ON public.rooms;
CREATE POLICY "Users can view their own rooms" ON public.rooms
  FOR SELECT TO public USING (auth.uid() = owner_id);

-- 6.3 Announcements Policies
DROP POLICY IF EXISTS "Public read active announcements" ON public.announcements;
CREATE POLICY "Public read active announcements" ON public.announcements
  FOR SELECT TO public USING (is_active = true AND published_at <= now());

-- 6.4 Account Limits & Usage Policies (Model B)
DROP POLICY IF EXISTS "Users view own room limits" ON public.account_room_limits;
CREATE POLICY "Users view own room limits" ON public.account_room_limits
  FOR SELECT TO authenticated USING (auth.uid() = account_id);

DROP POLICY IF EXISTS "Users view own room usage" ON public.account_room_usage;
CREATE POLICY "Users view own room usage" ON public.account_room_usage
  FOR SELECT TO authenticated USING (auth.uid() = account_id);

-- ----------------------------------------------------------------------------
-- 7. STORAGE BUCKETS & STORAGE POLICIES
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('avatars', 'avatars', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('room_covers', 'room_covers', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('app', 'app', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage Policies: Avatars
DROP POLICY IF EXISTS "Avatar images are publicly accessible." ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible." ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Auth Insert avatars" ON storage.objects;
CREATE POLICY "Auth Insert avatars" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Auth Update avatars" ON storage.objects;
CREATE POLICY "Auth Update avatars" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Auth Delete avatars" ON storage.objects;
CREATE POLICY "Auth Delete avatars" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Storage Policies: Room Covers
DROP POLICY IF EXISTS "Public Access to room_covers" ON storage.objects;
CREATE POLICY "Public Access to room_covers" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'room_covers');

DROP POLICY IF EXISTS "Auth Insert room_covers" ON storage.objects;
CREATE POLICY "Auth Insert room_covers" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'room_covers' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Auth Update room_covers" ON storage.objects;
CREATE POLICY "Auth Update room_covers" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'room_covers' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'room_covers' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Auth Delete room_covers" ON storage.objects;
CREATE POLICY "Auth Delete room_covers" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'room_covers' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Storage Policies: App Bucket
DROP POLICY IF EXISTS "Public Access to app bucket" ON storage.objects;
CREATE POLICY "Public Access to app bucket" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'app');

-- ----------------------------------------------------------------------------
-- 8. PERMISSIONS, GRANTS & SECURITY LOCKDOWN
-- ----------------------------------------------------------------------------

-- Revoke direct DML modifications on authoritative rooms and quota tables
REVOKE INSERT, UPDATE, DELETE ON TABLE public.rooms FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_room_limits FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_room_usage FROM anon, authenticated;
REVOKE ALL ON TABLE public.room_quota_events FROM anon, authenticated;

-- Allow read-only access where required by client RLS
GRANT SELECT ON TABLE public.rooms TO anon, authenticated;
GRANT SELECT ON TABLE public.account_room_limits TO authenticated;
GRANT SELECT ON TABLE public.account_room_usage TO authenticated;
GRANT SELECT ON TABLE public.announcements TO anon, authenticated;

-- Full permissions granted to service_role
GRANT ALL ON TABLE public.rooms TO service_role;
GRANT ALL ON TABLE public.account_room_limits TO service_role;
GRANT ALL ON TABLE public.account_room_usage TO service_role;
GRANT ALL ON TABLE public.room_quota_events TO service_role;
GRANT ALL ON TABLE public.room_lifecycle_events TO service_role;
GRANT ALL ON TABLE public.room_messages TO service_role;
GRANT ALL ON TABLE public.announcements TO service_role;
GRANT ALL ON TABLE public.vbrowser_providers TO service_role;
GRANT ALL ON TABLE public.vbrowser_pools TO service_role;
GRANT ALL ON TABLE public.vbrowser TO service_role;
GRANT ALL ON TABLE public.vbrowser_reservations TO service_role;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.active_user TO service_role;

-- Revoke execute on authoritative procedures from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION public.create_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_rooms_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.extend_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_account_rooms_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_vbrowser_capacity FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_room_activity_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_room_permanence_authoritative FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_room_metadata_authoritative FROM PUBLIC, anon, authenticated;

-- Restrict execution of authoritative procedures exclusively to postgres and service_role
GRANT EXECUTE ON FUNCTION public.create_room_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.expire_rooms_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.purge_account_rooms_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_vbrowser_capacity TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 9. MAINTENANCE SCHEDULE (PG_CRON)
-- ----------------------------------------------------------------------------
-- Note: Requires pg_cron extension enabled in Supabase project settings.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'delete-unconfirmed-users-hourly',
      '0 * * * *',
      'SELECT public.delete_unconfirmed_users();'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. SCHEMA DOCUMENTATION (TABLE & COLUMN COMMENTS)
-- ----------------------------------------------------------------------------
-- See sql/migrations/20260913_prod_003_table_and_column_descriptions.sql for
-- the comprehensive list of table and column comments applied to all 25 tables.

