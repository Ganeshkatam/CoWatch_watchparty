-- ============================================================================
-- Migration: MEMBER-001 Immutable Temporary-Room Participant Capacity
-- Authoritative Room Participant Capacity and Immutability
-- ============================================================================

-- 1. Add max_participants to public.rooms if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'max_participants'
  ) THEN
    ALTER TABLE public.rooms 
      ADD COLUMN max_participants integer NOT NULL DEFAULT 10 
      CHECK (max_participants >= 2 AND max_participants <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.rooms.max_participants IS 'Authoritative maximum participant capacity established at room creation.';

-- 2. Backfill any NULLs to default 10
UPDATE public.rooms SET max_participants = 10 WHERE max_participants IS NULL;

-- 3. Drop previous create_room_authoritative overloads to ensure clean signature
DROP FUNCTION IF EXISTS public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer);
DROP FUNCTION IF EXISTS public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer, integer);

-- 4. Recreate create_room_authoritative with p_max_participants
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
  p_expires_at timestamp with time zone,
  p_default_total_rooms integer DEFAULT 5,
  p_default_watch_rooms integer DEFAULT 5,
  p_default_permanent_rooms integer DEFAULT 2,
  p_max_participants integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_limits public.account_room_limits%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_is_permanent boolean := (p_room_kind = 'permanent');
  v_usage RECORD;
  v_max_total integer;
  v_max_watch integer;
  v_max_permanent integer;
  v_effective_capacity integer;
BEGIN
  IF p_room_kind NOT IN ('watch', 'permanent') THEN
    RAISE EXCEPTION 'ROOM_KIND_INVALID';
  END IF;

  -- Capacity range validation: must be between 2 and 100
  v_effective_capacity := COALESCE(p_max_participants, 10);
  IF v_effective_capacity < 2 OR v_effective_capacity > 100 THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_CAPACITY';
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

  -- 3. Auto-expire overdue rooms for this account to immediately reclaim capacity
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
      VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', jsonb_build_object('room_id', p_room_id, 'reason', 'ACCOUNT_ROOMS_DISABLED'));
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
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('room_id', p_room_id, 'reason', 'TOTAL_ROOM_LIMIT_EXCEEDED', 'limit', v_max_total, 'current', v_usage.total));
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 7. Enforce Room Kind Sub-Limit
  IF p_room_kind = 'watch' AND v_usage.watch >= v_max_watch THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('room_id', p_room_id, 'reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'watch', 'limit', v_max_watch, 'current', v_usage.watch));
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_max_permanent THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('room_id', p_room_id, 'reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'permanent', 'limit', v_max_permanent, 'current', v_usage.permanent));
    RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 8. Insert Authoritative Room Row with max_participants
  INSERT INTO public.rooms (
    "roomId", "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind, max_participants
  ) VALUES (
    p_room_id, v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, p_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind, v_effective_capacity
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
  VALUES (p_account_id, p_room_id, p_room_kind, 'CREATED', jsonb_build_object('total_rooms', v_usage.total + 1, 'max_participants', v_effective_capacity));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, p_account_id::text, 'room.created', 'inactive', p_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'roomKind', p_room_kind,
    'totalRooms', v_usage.total + 1,
    'maxTotal', v_max_total,
    'maxParticipants', v_effective_capacity
  );
END;
$$;

-- 5. Revoke from Public and Grant to Service Role
REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer, integer, integer, integer) TO postgres, service_role;
