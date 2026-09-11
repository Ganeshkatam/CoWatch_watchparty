-- =====================================================================
-- Migration: Lock Participants Authoritative (LOCK-001)
-- Adds participants_locked column and SECURITY DEFINER authoritative procedure.
-- =====================================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS participants_locked boolean NOT NULL DEFAULT false;

-- 9.10 set_room_participants_lock_authoritative
CREATE OR REPLACE FUNCTION public.set_room_participants_lock_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_locked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  -- 4. Emit lifecycle audit event (no credentials)
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

-- Privilege Lockdown on new authoritative procedure
REVOKE ALL ON FUNCTION public.set_room_participants_lock_authoritative(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative(uuid, text, boolean) TO postgres, service_role;
