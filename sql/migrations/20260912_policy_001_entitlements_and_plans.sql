-- Migration: 20260912_policy_001_entitlements_and_plans.sql
-- Description: Centralized subscription plan catalog, account entitlement resolver, atomic quota & duration enforcement,
--              and hardened least-privilege security boundaries (POLICY-001).

-- 1. Create public.subscription_plans catalog table
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_watch_lte_total CHECK (max_watch_rooms <= max_total_rooms),
  CONSTRAINT check_permanent_lte_total CHECK (max_permanent_rooms <= max_total_rooms),
  CONSTRAINT check_vbrowser_concurrency_allowed CHECK (is_vbrowser_allowed OR max_vbrowser_concurrency = 0)
);

COMMENT ON TABLE public.subscription_plans IS 'Authoritative product and tier catalog defining quota, capacity, and feature entitlements.';

-- Enforce exactly one active default plan
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_single_default 
  ON public.subscription_plans(is_default) 
  WHERE is_default = true;

-- Attach hardened updated_at trigger
DROP TRIGGER IF EXISTS trg_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 2. Non-Destructive Canonical Plan Seeding
INSERT INTO public.subscription_plans (
  id, display_name, description, is_default, max_total_rooms, max_watch_rooms,
  max_permanent_rooms, max_participant_capacity, max_room_duration_hours,
  is_vbrowser_allowed, max_vbrowser_concurrency, is_active
) VALUES 
  ('free', 'Free', 'Standard personal watch party account', true, 5, 5, 2, 25, 24, false, 0, true),
  ('premium', 'Premium', 'High-capacity rooms, extended persistence, and VBrowser access', false, 20, 20, 10, 100, 72, true, 1, true)
ON CONFLICT (id) DO NOTHING;

-- 3. Helper Function: Resolve Default Subscription Plan ID
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

REVOKE ALL ON FUNCTION public.get_default_subscription_plan_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_default_subscription_plan_id() TO postgres, service_role, supabase_auth_admin;

-- 4. Refactor public.account_room_limits (Account Entitlement Layer)
-- Add plan_id and explicit override columns
ALTER TABLE public.account_room_limits
  ADD COLUMN IF NOT EXISTS plan_id text REFERENCES public.subscription_plans(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS override_total_rooms integer CHECK (override_total_rooms IS NULL OR override_total_rooms >= 0),
  ADD COLUMN IF NOT EXISTS override_watch_rooms integer CHECK (override_watch_rooms IS NULL OR override_watch_rooms >= 0),
  ADD COLUMN IF NOT EXISTS override_permanent_rooms integer CHECK (override_permanent_rooms IS NULL OR override_permanent_rooms >= 0),
  ADD COLUMN IF NOT EXISTS override_participant_capacity integer CHECK (override_participant_capacity IS NULL OR (override_participant_capacity >= 2 AND override_participant_capacity <= 500)),
  ADD COLUMN IF NOT EXISTS override_room_duration_hours integer CHECK (override_room_duration_hours IS NULL OR (override_room_duration_hours >= 1 AND override_room_duration_hours <= 720)),
  ADD COLUMN IF NOT EXISTS override_vbrowser_allowed boolean,
  ADD COLUMN IF NOT EXISTS override_vbrowser_concurrency integer CHECK (override_vbrowser_concurrency IS NULL OR override_vbrowser_concurrency >= 0);

-- Migrate existing rows to the configured default plan
UPDATE public.account_room_limits
SET plan_id = public.get_default_subscription_plan_id()
WHERE plan_id IS NULL;

-- Enforce NOT NULL on plan_id (without embedding a default literal in table DDL)
ALTER TABLE public.account_room_limits
  ALTER COLUMN plan_id SET NOT NULL;

-- Drop legacy hardcoded quota columns
ALTER TABLE public.account_room_limits
  DROP COLUMN IF EXISTS max_total_rooms,
  DROP COLUMN IF EXISTS max_watch_rooms,
  DROP COLUMN IF EXISTS max_permanent_rooms;

-- Add cross-field validation on overrides
ALTER TABLE public.account_room_limits
  DROP CONSTRAINT IF EXISTS check_override_watch_lte_total,
  DROP CONSTRAINT IF EXISTS check_override_permanent_lte_total;

ALTER TABLE public.account_room_limits
  ADD CONSTRAINT check_override_watch_lte_total 
    CHECK (override_watch_rooms IS NULL OR override_total_rooms IS NULL OR override_watch_rooms <= override_total_rooms),
  ADD CONSTRAINT check_override_permanent_lte_total 
    CHECK (override_permanent_rooms IS NULL OR override_total_rooms IS NULL OR override_permanent_rooms <= override_total_rooms);

-- 5. Centralized Entitlement Authority Resolver
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

REVOKE ALL ON FUNCTION public.resolve_account_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_account_entitlement(uuid) TO postgres, service_role;

-- 6. Neutral Auth Trigger handle_new_user()
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

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role, supabase_auth_admin;

-- 7. Authoritative Room Creation Function (Hardened Atomic Quota & Duration Enforcement)
DROP FUNCTION IF EXISTS public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer);
DROP FUNCTION IF EXISTS public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer);

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
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', '{"reason": "ACCOUNT_ROOMS_DISABLED"}'::jsonb);
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

-- 8. Authoritative Permanence Conversion Function
DROP FUNCTION IF EXISTS public.set_room_permanence_authoritative(uuid, text, boolean, integer);
DROP FUNCTION IF EXISTS public.set_room_permanence_authoritative(uuid, text, boolean);

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

-- 9. Authoritative Room Extension Function
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

-- 10. Decoupled VBrowser Reservation Function (Independent Entitlement Verification)
CREATE OR REPLACE FUNCTION public.vbrowser_acquire_reservation(
  p_provider_id text,
  p_pool_id text,
  p_room_id text,
  p_user_id uuid,
  p_is_large boolean,
  p_lease_seconds integer,
  p_config_provider_limit integer,
  p_config_pool_limit integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reservation_id text;
  provider_row RECORD;
  pool_row RECORD;
  effective_provider integer;
  effective_pool integer;
  effective_user integer;
  effective_room integer;
  effective_large integer;
  active_provider integer;
  active_pool integer;
  active_user integer;
  active_room integer;
  active_large integer;
  v_entitlement RECORD;
  v_active_user_vbrowser_allocations integer;
BEGIN
  -- 1. Resolve centralized subscription billing entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_user_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  IF NOT v_entitlement.is_vbrowser_allowed THEN
    RAISE EXCEPTION 'VBROWSER_NOT_ENTITLED';
  END IF;

  -- Check user concurrency against plan entitlement
  SELECT count(*) INTO v_active_user_vbrowser_allocations
  FROM public.vbrowser_reservations
  WHERE user_id = p_user_id::text AND status IN ('RESERVED', 'ALLOCATED');

  IF v_active_user_vbrowser_allocations >= v_entitlement.max_vbrowser_concurrency THEN
    RAISE EXCEPTION 'VBROWSER_CONCURRENCY_LIMIT_REACHED';
  END IF;

  -- 2. Infrastructure Pool and Provider Capacity Verification
  SELECT * INTO provider_row FROM public.vbrowser_providers WHERE id = p_provider_id;
  IF NOT FOUND OR NOT provider_row.enabled THEN
    RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';
  END IF;

  SELECT * INTO pool_row FROM public.vbrowser_pools WHERE id = p_pool_id AND provider_id = p_provider_id;
  IF NOT FOUND OR NOT pool_row.enabled THEN
    RAISE EXCEPTION 'POOL_UNAVAILABLE';
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
  SELECT count(*) INTO active_user FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND user_id = p_user_id::text AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_room FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND room_id = p_room_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_large FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND is_large AND status IN ('RESERVED', 'ALLOCATED');

  IF active_provider >= effective_provider THEN RAISE EXCEPTION 'PROVIDER_CAPACITY_EXCEEDED'; END IF;
  IF active_pool >= effective_pool THEN RAISE EXCEPTION 'POOL_CAPACITY_EXCEEDED'; END IF;
  IF active_user >= effective_user THEN RAISE EXCEPTION 'USER_CAPACITY_EXCEEDED'; END IF;
  IF active_room >= effective_room THEN RAISE EXCEPTION 'ROOM_CAPACITY_EXCEEDED'; END IF;
  IF p_is_large AND active_large >= effective_large THEN RAISE EXCEPTION 'LARGE_CAPACITY_EXCEEDED'; END IF;

  INSERT INTO public.vbrowser_reservations (provider_id, pool_id, room_id, user_id, is_large, expires_at)
  VALUES (p_provider_id, p_pool_id, p_room_id, p_user_id::text, p_is_large, now() + make_interval(secs => p_lease_seconds))
  RETURNING id::text INTO reservation_id;

  RETURN reservation_id;
END;
$$;

-- 10b. VBrowser Release Reservation: Marks active reservation as RELEASED for a given room+user
CREATE OR REPLACE FUNCTION public.vbrowser_release_reservation(
  p_user_id uuid,
  p_room_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_released_count integer;
BEGIN
  UPDATE public.vbrowser_reservations
  SET status = 'RELEASED', released_at = now()
  WHERE user_id = p_user_id::text
    AND room_id = p_room_id
    AND status IN ('RESERVED', 'ALLOCATED');

  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  RETURN v_released_count > 0;
END;
$$;

-- 11. Security Definier Grants & RLS Policies (SEC-001B Least Privilege Alignment)

-- 11.1 subscription_plans: Public read-only catalog for active plans, immutable to clients
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.subscription_plans TO authenticated, anon;

DROP POLICY IF EXISTS "Public view active subscription plans" ON public.subscription_plans;
CREATE POLICY "Public view active subscription plans"
  ON public.subscription_plans FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

-- 11.2 account_room_limits: Private entitlement state (User can only read own row)
ALTER TABLE public.account_room_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_room_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_room_limits TO authenticated;

DROP POLICY IF EXISTS "Users view own room limits" ON public.account_room_limits;
DROP POLICY IF EXISTS "Users view own account limits" ON public.account_room_limits;
CREATE POLICY "Users view own account limits"
  ON public.account_room_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = account_id);

-- 11.3 Procedure Grants
REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_room_authoritative(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vbrowser_acquire_reservation(text, text, text, uuid, boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vbrowser_release_reservation(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative(uuid, text, timestamptz) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.vbrowser_acquire_reservation(text, text, text, uuid, boolean, integer, integer, integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.vbrowser_release_reservation(uuid, text) TO postgres, service_role;

-- 11.4 Lock Default Privileges for Object-Creating Role (postgres) on public schema
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
