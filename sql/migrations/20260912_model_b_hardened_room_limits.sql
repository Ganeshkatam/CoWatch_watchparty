-- Migration: 20260912_model_b_hardened_room_limits.sql
-- Description: Authoritative account-level room creation limits (Model B) with universal lock-first protocol,
--              materialized usage tracking, strict room classification, and comprehensive backfill.

-- 1. Add room_kind column to public.rooms
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS room_kind text NOT NULL DEFAULT 'watch';

-- 2. Backfill existing rooms
UPDATE public.rooms
SET room_kind = CASE 
  WHEN "isPermanent" = true THEN 'permanent'
  ELSE 'watch'
END;

-- 3. Strict permanence invariant:
--    permanent <=> isPermanent=true AND expiresAt IS NULL
--    watch     <=> isPermanent=false AND expiresAt IS NOT NULL
ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_kind_permanent_check;

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_kind_permanent_check CHECK (
    (room_kind = 'permanent' AND "isPermanent" = true AND "expiresAt" IS NULL) OR
    (room_kind = 'watch' AND "isPermanent" = false AND "expiresAt" IS NOT NULL)
  );

-- 4. Single-pass index scan acceleration for room quota recalculation
CREATE INDEX IF NOT EXISTS idx_rooms_owner_quota_eval 
  ON public.rooms(owner_id, status, "isPermanent", "expiresAt");

-- 5. Account Quota Policy Table
CREATE TABLE IF NOT EXISTS public.account_room_limits (
  account_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  max_total_rooms integer NOT NULL DEFAULT 5 CHECK (max_total_rooms >= 0),
  max_watch_rooms integer NOT NULL DEFAULT 5 CHECK (max_watch_rooms >= 0),
  max_permanent_rooms integer NOT NULL DEFAULT 2 CHECK (max_permanent_rooms >= 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Materialized Enforcement State (1 row per account)
CREATE TABLE IF NOT EXISTS public.account_room_usage (
  account_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_rooms integer NOT NULL DEFAULT 0 CHECK (total_rooms >= 0),
  watch_rooms integer NOT NULL DEFAULT 0 CHECK (watch_rooms >= 0),
  permanent_rooms integer NOT NULL DEFAULT 0 CHECK (permanent_rooms >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Audit Trail
CREATE TABLE IF NOT EXISTS public.room_quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_id text NOT NULL,
  room_kind text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED', 'DELETED', 'EXPIRED', 'ENDED', 'PERMANENCE_CHANGED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_room_quota_events_account 
  ON public.room_quota_events(account_id, created_at DESC);

-- 8. COMPREHENSIVE BACKFILL: Initialize account_room_usage for EVERY existing profile
INSERT INTO public.account_room_usage (account_id, total_rooms, watch_rooms, permanent_rooms, updated_at)
SELECT 
  p.id AS account_id,
  COALESCE(u.total, 0) AS total_rooms,
  COALESCE(u.watch, 0) AS watch_rooms,
  COALESCE(u.permanent, 0) AS permanent_rooms,
  clock_timestamp() AS updated_at
FROM public.profiles p
LEFT JOIN (
  SELECT 
    owner_id,
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  FROM public.rooms
  WHERE status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > clock_timestamp())
  GROUP BY owner_id
) u ON p.id = u.owner_id
ON CONFLICT (account_id) DO UPDATE SET
  total_rooms = EXCLUDED.total_rooms,
  watch_rooms = EXCLUDED.watch_rooms,
  permanent_rooms = EXCLUDED.permanent_rooms,
  updated_at = EXCLUDED.updated_at;

-- 9. Authoritative Stored Procedures

-- 9.1 create_room_authoritative
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
  p_default_total_rooms integer DEFAULT 5,
  p_default_watch_rooms integer DEFAULT 5,
  p_default_permanent_rooms integer DEFAULT 2
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limits public.account_room_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_is_permanent boolean := (p_room_kind = 'permanent');
  v_usage RECORD;
  v_max_total integer;
  v_max_watch integer;
  v_max_permanent integer;
BEGIN
  IF p_room_kind NOT IN ('watch', 'permanent') THEN
    RAISE EXCEPTION 'ROOM_KIND_INVALID';
  END IF;

  -- 1. Ensure usage row exists
  INSERT INTO public.account_room_usage (account_id, updated_at)
  VALUES (p_account_id, v_now)
  ON CONFLICT (account_id) DO NOTHING;

  -- 2. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 3. Auto-expire any overdue rooms for this account to immediately reclaim capacity
  UPDATE public.rooms
  SET status = 'expired', "endedAt" = v_now
  WHERE owner_id = p_account_id 
    AND status IN ('active', 'inactive') 
    AND "isPermanent" = false 
    AND "expiresAt" IS NOT NULL 
    AND "expiresAt" <= v_now;

  -- 4. Single-Pass Aggregate Room Count: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 5. Load Applicable Account Limits
  SELECT * INTO v_limits
  FROM public.account_room_limits
  WHERE account_id = p_account_id;

  IF FOUND THEN
    IF NOT v_limits.enabled THEN
      INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
      VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', '{"reason": "ACCOUNT_ROOMS_DISABLED"}'::jsonb);
      RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
    END IF;
    v_max_total := v_limits.max_total_rooms;
    v_max_watch := v_limits.max_watch_rooms;
    v_max_permanent := v_limits.max_permanent_rooms;
  ELSE
    v_max_total := p_default_total_rooms;
    v_max_watch := p_default_watch_rooms;
    v_max_permanent := p_default_permanent_rooms;
  END IF;

  -- 6. Enforce Total Room Ceiling
  IF v_usage.total >= v_max_total THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'TOTAL_ROOM_LIMIT_EXCEEDED', 'limit', v_max_total, 'current', v_usage.total));
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 7. Enforce Room Kind Sub-Limit
  IF p_room_kind = 'watch' AND v_usage.watch >= v_max_watch THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'watch', 'limit', v_max_watch, 'current', v_usage.watch));
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_max_permanent THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'permanent', 'limit', v_max_permanent, 'current', v_usage.permanent));
    RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 8. Insert Authoritative Room Row
  INSERT INTO public.rooms (
    "roomId", "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind
  ) VALUES (
    p_room_id, v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, p_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind
  );

  -- 9. Update Materialized Usage Record
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total + 1,
      watch_rooms = v_usage.watch + CASE WHEN p_room_kind = 'watch' THEN 1 ELSE 0 END,
      permanent_rooms = v_usage.permanent + CASE WHEN p_room_kind = 'permanent' THEN 1 ELSE 0 END,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 10. Audit Record & Lifecycle Event
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, p_room_kind, 'CREATED', jsonb_build_object('total_rooms', v_usage.total + 1));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, p_account_id::text, 'room.created', 'inactive', p_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'roomKind', p_room_kind,
    'totalRooms', v_usage.total + 1,
    'maxTotal', v_max_total
  );
END;
$$;

-- 9.2 delete_room_authoritative
CREATE OR REPLACE FUNCTION public.delete_room_authoritative(
  p_account_id uuid,
  p_room_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  VALUES (p_account_id, p_room_id, v_room.room_kind, 'DELETED', jsonb_build_object('total_rooms', v_usage.total));

  RETURN jsonb_build_object(
    'deletedRoomId', p_room_id,
    'roomKind', v_room.room_kind,
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;

-- 9.3 end_room_authoritative
CREATE OR REPLACE FUNCTION public.end_room_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_actor text DEFAULT 'host'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

-- 9.4 expire_rooms_authoritative
CREATE OR REPLACE FUNCTION public.expire_rooms_authoritative()
RETURNS TABLE (
  room_id text,
  owner_id uuid,
  room_kind text,
  previous_expires_at timestamptz,
  ended_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_account RECORD;
  r RECORD;
  v_usage RECORD;
BEGIN
  -- 1. Discover all distinct accounts with candidate expired rooms
  FOR v_account IN
    SELECT DISTINCT public.rooms.owner_id
    FROM public.rooms
    WHERE status IN ('active', 'inactive')
      AND "isPermanent" = false
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" <= v_now
  LOOP
    -- 2. UNIFIED LOCK: Lock this account's usage row FIRST
    PERFORM 1 
    FROM public.account_room_usage 
    WHERE account_room_usage.account_id = v_account.owner_id 
    FOR UPDATE;

    -- 3. Transition expired rooms for this account (re-verifying under lock)
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

      -- Audit Event
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

-- 9.5 set_room_permanence_authoritative
CREATE OR REPLACE FUNCTION public.set_room_permanence_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_is_permanent boolean,
  p_default_permanent_rooms integer DEFAULT 2
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_limits public.account_room_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_new_kind text := CASE WHEN p_is_permanent THEN 'permanent' ELSE 'watch' END;
  v_new_expires timestamptz := CASE WHEN p_is_permanent THEN NULL ELSE v_now + INTERVAL '1 day' END;
  v_usage RECORD;
  v_max_permanent integer;
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
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_CHANGE_PERMANENCE';
  END IF;

  IF v_room."isPermanent" = p_is_permanent THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'isPermanent', p_is_permanent, 'unchanged', true);
  END IF;

  -- 3. If converting to permanent, check permanent room quota
  IF p_is_permanent THEN
    SELECT * INTO v_limits
    FROM public.account_room_limits
    WHERE account_id = p_account_id;

    IF FOUND THEN
      v_max_permanent := v_limits.max_permanent_rooms;
    ELSE
      v_max_permanent := p_default_permanent_rooms;
    END IF;

    SELECT count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
    INTO v_usage
    FROM public.rooms
    WHERE owner_id = p_account_id
      AND status IN ('scheduled', 'active', 'inactive')
      AND ("isPermanent" = true OR "expiresAt" > v_now);

    IF v_usage.permanent >= v_max_permanent THEN
      RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
    END IF;
  END IF;

  -- 4. Update room row
  UPDATE public.rooms
  SET "isPermanent" = p_is_permanent,
      room_kind = v_new_kind,
      "isSubRoom" = p_is_permanent,
      "expiresAt" = v_new_expires
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 5. Recompute usage
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

  -- 6. Audit
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

-- 10. Privilege Lockdown and Security Definier Grant Boundary
REVOKE ALL ON TABLE public.account_room_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_room_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_quota_events FROM PUBLIC, anon, authenticated;

-- Direct mutations on public.rooms are completely revoked from PUBLIC, anon, and authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.rooms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rooms TO authenticated, anon;


-- Enable RLS for read-only access by owners
ALTER TABLE public.account_room_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_quota_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own room limits" ON public.account_room_limits;
CREATE POLICY "Users view own room limits"
  ON public.account_room_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = account_id);

DROP POLICY IF EXISTS "Users view own room usage" ON public.account_room_usage;
CREATE POLICY "Users view own room usage"
  ON public.account_room_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = account_id);

-- Explicitly restrict execution of authoritative procedures to postgres and service_role only
REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_room_authoritative(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_room_authoritative(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_rooms_authoritative() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative(uuid, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative(uuid, text, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.expire_rooms_authoritative() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean, integer) TO postgres, service_role;

