-- Migration: 20260917_permanent_room_session_stop.sql
-- Description: Updates end_room_authoritative to transition permanent rooms to 'inactive'
-- rather than terminal 'ended', preserving their persistent reusable identity.

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
  v_new_status text;
  v_event_name text;
  v_quota_event text;
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

  -- For temporary rooms: ended/expired are terminal
  -- For permanent rooms: inactive is already stopped, but not terminal
  IF v_room."isPermanent" = false AND v_room.status IN ('ended', 'expired') THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', v_room.status, 'isPermanent', false, 'alreadyConcluded', true);
  ELSIF v_room."isPermanent" = true AND v_room.status = 'inactive' THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', 'inactive', 'isPermanent', true, 'alreadyConcluded', true);
  END IF;

  -- 3. Atomic transition:
  -- Permanent rooms stop session -> 'inactive' (reusable indefinitely)
  -- Temporary rooms end session -> 'ended' (permanently terminal)
  IF v_room."isPermanent" = true THEN
    v_new_status := 'inactive';
    v_event_name := 'session.stopped';
    v_quota_event := 'SESSION_STOPPED';

    UPDATE public.rooms
    SET status = 'inactive',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE "roomId" = p_room_id AND owner_id = p_account_id;
  ELSE
    v_new_status := 'ended';
    v_event_name := 'room.ended';
    v_quota_event := 'ENDED';

    UPDATE public.rooms
    SET status = 'ended',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE "roomId" = p_room_id AND owner_id = p_account_id;
  END IF;

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

  -- 6. Audit & Lifecycle Logs
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, v_room.room_kind, v_quota_event, jsonb_build_object('total_rooms', v_usage.total, 'status', v_new_status));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_actor, v_event_name, v_room.status, v_new_status, v_room."expiresAt", v_room."expiresAt", 'session ended by host', v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', v_new_status,
    'isPermanent', v_room."isPermanent",
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.end_room_authoritative(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative(uuid, text, text) TO postgres, service_role;

-- 7. Data Healing: Restore any permanent rooms incorrectly marked as 'ended' back to 'inactive'
UPDATE public.rooms
SET status = 'inactive',
    "lastUpdateTime" = clock_timestamp()
WHERE "isPermanent" = true
  AND status = 'ended';
