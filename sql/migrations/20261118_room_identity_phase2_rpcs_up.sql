-- ============================================================================
-- CoWatch WatchParty: Room Identity Architecture Migration - Phase 2 (FORWARD)
-- Migration File: sql/migrations/20261118_room_identity_phase2_rpcs_up.sql
-- Target System: PostgreSQL 14+ / Supabase Production Catalog
--
-- PURPOSE:
-- Implement canonical UUID-first authoritative room procedures operating on
-- public.rooms.id (UUID primary key) and child table room_uuid foreign keys.
-- Maintain 100% continuous runtime compatibility by providing overloaded
-- UUID signatures alongside thin delegating legacy text signatures.
--
-- STRUCTURE:
-- 1. Universal Boundary Room Resolver (resolve_room_authoritative)
-- 2. Canonical UUID-first Authoritative RPC Implementations:
--    - create_room_authoritative(uuid, uuid, ...)
--    - delete_room_authoritative(uuid, uuid)
--    - end_room_authoritative(uuid, uuid, text)
--    - extend_room_authoritative(uuid, uuid, timestamptz)
--    - set_room_activity_authoritative(uuid, text, uuid)
--    - set_room_participants_lock_authoritative(uuid, uuid, boolean)
--    - set_room_permanence_authoritative(uuid, uuid, boolean)
--    - update_room_metadata_authoritative(uuid, uuid, ...)
--    - expire_rooms_authoritative()
--    - purge_account_rooms_authoritative(uuid)
-- 3. Delegating Legacy Text Signatures (Adapter Layer)
-- 4. Strict Security Privilege Grants and Revocations
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- ############################################################################
-- SECTION 1: UNIVERSAL BOUNDARY ROOM RESOLVER
-- ############################################################################

-- 1.1 Universal Room Resolution Routine
-- Resolves a room record from any supported identifier format:
--   a) 10-digit public joining code (idx_rooms_joining_id_unique)
--   b) Canonical UUID string (room_pkey / idx_rooms_id_unique)
--   c) Legacy moniker string ("roomId" / idx_rooms_legacy_room_id_unique)
CREATE OR REPLACE FUNCTION public.resolve_room_authoritative(
  p_identifier text
)
RETURNS public.rooms
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
BEGIN
  IF p_identifier IS NULL OR trim(p_identifier) = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Check 10-digit joining ID (fast unique B-tree index lookup)
  IF p_identifier ~ '^[0-9]{10}$' THEN
    SELECT * INTO v_room
    FROM public.rooms
    WHERE joining_id = p_identifier;

    IF FOUND THEN
      RETURN v_room;
    END IF;
  END IF;

  -- 2. Check canonical UUID (fast primary-key index lookup)
  IF p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = p_identifier::uuid;

    IF FOUND THEN
      RETURN v_room;
    END IF;
  END IF;

  -- 3. Fallback: Legacy moniker lookup (index lookup on legacy_room_id or "roomId")
  SELECT * INTO v_room
  FROM public.rooms
  WHERE legacy_room_id = p_identifier OR "roomId" = p_identifier;

  RETURN v_room;
END;
$$;


-- ############################################################################
-- SECTION 2: CANONICAL UUID-FIRST AUTHORITATIVE ROUTINES
-- ############################################################################

-- 2.1 Canonical UUID create_room_authoritative
CREATE OR REPLACE FUNCTION public.create_room_authoritative(
  p_account_id uuid,
  p_room_id uuid,
  p_room_kind text,
  p_room_title text,
  p_room_description text,
  p_passcode_hash text,
  p_owner_passcode text,
  p_passcode_fingerprint text,
  p_cover_photo text,
  p_is_chat_disabled boolean,
  p_expires_at timestamp with time zone,
  p_requested_participants integer DEFAULT NULL::integer,
  p_joining_id text DEFAULT NULL::text,
  p_legacy_room_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_is_permanent boolean := (p_room_kind = 'permanent');
  v_usage RECORD;
  v_entitlement RECORD;
  v_effective_capacity integer;
  v_effective_expires_at timestamptz;
  v_assigned_joining_id text;
  v_effective_legacy_id text;
BEGIN
  IF p_room_kind NOT IN ('watch', 'permanent') THEN
    RAISE EXCEPTION 'ROOM_KIND_INVALID';
  END IF;

  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  -- 1. Ensure account usage row exists
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
    INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_id::text, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'ACCOUNT_ROOMS_DISABLED', 'attempted_room_id', p_room_id::text));
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

  -- 6. Enforce Total Room Ceiling
  IF v_usage.total >= v_entitlement.max_total_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_id::text, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'TOTAL_ROOM_LIMIT_EXCEEDED', 'limit', v_entitlement.max_total_rooms, 'current', v_usage.total, 'attempted_room_id', p_room_id::text));
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 7. Enforce Room Kind Sub-Limit
  IF p_room_kind = 'watch' AND v_usage.watch >= v_entitlement.max_watch_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_id::text, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'watch', 'limit', v_entitlement.max_watch_rooms, 'current', v_usage.watch, 'attempted_room_id', p_room_id::text));
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_id::text, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'permanent', 'limit', v_entitlement.max_permanent_rooms, 'current', v_usage.permanent, 'attempted_room_id', p_room_id::text));
    RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 8. Enforce Participant Capacity Cap
  v_effective_capacity := COALESCE(p_requested_participants, v_entitlement.max_participant_capacity);
  IF v_effective_capacity < 2 OR v_effective_capacity > v_entitlement.max_participant_capacity THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_CAPACITY';
  END IF;

  -- 9. Enforce Expiration Duration
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

  v_effective_legacy_id := COALESCE(p_legacy_room_id, p_room_id::text);

  -- 10. Insert Authoritative Room Row with canonical UUID and synchronized identifiers
  INSERT INTO public.rooms (
    id, joining_id, legacy_room_id, "roomId",
    "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind, max_participants
  ) VALUES (
    p_room_id, p_joining_id, v_effective_legacy_id, v_effective_legacy_id,
    v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, v_effective_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind, v_effective_capacity
  )
  RETURNING joining_id INTO v_assigned_joining_id;

  -- 11. Update Materialized Usage Record
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total + 1,
      watch_rooms = v_usage.watch + CASE WHEN p_room_kind = 'watch' THEN 1 ELSE 0 END,
      permanent_rooms = v_usage.permanent + CASE WHEN p_room_kind = 'permanent' THEN 1 ELSE 0 END,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 12. Audit Record & Lifecycle Event (using both room_uuid and legacy columns)
  INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, v_effective_legacy_id, p_room_kind, 'CREATED', jsonb_build_object('total_rooms', v_usage.total + 1));

  INSERT INTO public.room_lifecycle_events (room_uuid, "roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, v_effective_legacy_id, p_account_id::text, 'room.created', 'inactive', v_effective_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'id', p_room_id,
    'roomId', v_effective_legacy_id,
    'joiningId', v_assigned_joining_id,
    'roomKind', p_room_kind,
    'totalRooms', v_usage.total + 1,
    'maxTotal', v_entitlement.max_total_rooms,
    'maxCapacity', v_effective_capacity,
    'maxParticipants', v_effective_capacity,
    'expiresAt', v_effective_expires_at
  );
END;
$$;


-- 2.2 Canonical UUID delete_room_authoritative
CREATE OR REPLACE FUNCTION public.delete_room_authoritative(
  p_account_id uuid,
  p_room_id uuid
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
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock using canonical UUID primary key
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'active' THEN
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_DELETE';
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  -- 3. Delete Room Row (foreign keys ON DELETE CASCADE automatically clean child tables)
  DELETE FROM public.rooms
  WHERE id = p_room_id AND owner_id = p_account_id;

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

  -- 6. Audit Event (room_uuid / room_id set to NULL as room is deleted; identities preserved in metadata)
  INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
  VALUES (
    p_account_id,
    NULL,
    NULL,
    v_room.room_kind,
    'DELETED',
    jsonb_build_object('room_uuid', p_room_id, 'room_id', v_legacy_id, 'total_rooms', v_usage.total)
  );

  RETURN jsonb_build_object(
    'id', p_room_id,
    'deletedRoomId', v_legacy_id,
    'roomKind', v_room.room_kind,
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;


-- 2.3 Canonical UUID end_room_authoritative
CREATE OR REPLACE FUNCTION public.end_room_authoritative(
  p_account_id uuid,
  p_room_id uuid,
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
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  -- For temporary rooms: ended/expired are terminal
  -- For permanent rooms: inactive is already stopped, but not terminal
  IF v_room."isPermanent" = false AND v_room.status IN ('ended', 'expired') THEN
    RETURN jsonb_build_object(
      'id', p_room_id,
      'roomId', v_legacy_id,
      'status', v_room.status,
      'isPermanent', false,
      'alreadyConcluded', true
    );
  ELSIF v_room."isPermanent" = true AND v_room.status = 'inactive' THEN
    RETURN jsonb_build_object(
      'id', p_room_id,
      'roomId', v_legacy_id,
      'status', 'inactive',
      'isPermanent', true,
      'alreadyConcluded', true
    );
  END IF;

  -- 3. Atomic transition:
  IF v_room."isPermanent" = true THEN
    v_new_status := 'inactive';
    v_event_name := 'session.stopped';
    v_quota_event := 'SESSION_STOPPED';

    UPDATE public.rooms
    SET status = 'inactive',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE id = p_room_id AND owner_id = p_account_id;
  ELSE
    v_new_status := 'ended';
    v_event_name := 'room.ended';
    v_quota_event := 'ENDED';

    UPDATE public.rooms
    SET status = 'ended',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE id = p_room_id AND owner_id = p_account_id;
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
  INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
  VALUES (
    p_account_id,
    p_room_id,
    v_legacy_id,
    v_room.room_kind,
    v_quota_event,
    jsonb_build_object('total_rooms', v_usage.total, 'status', v_new_status)
  );

  INSERT INTO public.room_lifecycle_events (
    room_uuid, "roomId", actor, event, "previousStatus", "newStatus",
    "previousExpiresAt", "newExpiresAt", reason, timestamp
  )
  VALUES (
    p_room_id,
    v_legacy_id,
    p_actor,
    v_event_name,
    v_room.status,
    v_new_status,
    v_room."expiresAt",
    v_room."expiresAt",
    'session ended by host',
    v_now
  );

  RETURN jsonb_build_object(
    'id', p_room_id,
    'roomId', v_legacy_id,
    'status', v_new_status,
    'isPermanent', v_room."isPermanent",
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;


-- 2.4 Canonical UUID extend_room_authoritative
CREATE OR REPLACE FUNCTION public.extend_room_authoritative(
  p_account_id uuid,
  p_room_id uuid,
  p_new_expires_at timestamp with time zone
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
  v_entitlement RECORD;
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

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
  WHERE id = p_room_id AND owner_id = p_account_id
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
    UPDATE public.rooms SET status = 'expired', "endedAt" = v_now WHERE id = p_room_id;
    RAISE EXCEPTION 'ROOM_ALREADY_EXPIRED';
  END IF;

  IF p_new_expires_at <= v_room."expiresAt" THEN
    RAISE EXCEPTION 'INVALID_EXTENSION_TIME';
  END IF;

  -- Server-side max room duration enforcement
  IF p_new_expires_at > v_room."creationTime" + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
    RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  -- 4. Atomically update expiresAt
  UPDATE public.rooms
  SET "expiresAt" = p_new_expires_at,
      "lastUpdateTime" = v_now
  WHERE id = p_room_id AND owner_id = p_account_id;

  -- 5. Audit
  INSERT INTO public.room_lifecycle_events (
    room_uuid, "roomId", actor, event, "previousStatus", "newStatus",
    "previousExpiresAt", "newExpiresAt", reason, timestamp
  )
  VALUES (
    p_room_id,
    v_legacy_id,
    p_account_id::text,
    'room.extended',
    v_room.status,
    v_room.status,
    v_room."expiresAt",
    p_new_expires_at,
    'user extended',
    v_now
  );

  RETURN p_new_expires_at;
END;
$$;


-- 2.5 Canonical UUID set_room_activity_authoritative
CREATE OR REPLACE FUNCTION public.set_room_activity_authoritative(
  p_room_id uuid,
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
  v_lifecycle_event_id uuid := NULL;
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = v_room.owner_id 
  FOR UPDATE;

  -- Re-read under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  -- If room is already ended or expired, do not overwrite
  IF v_room.status IN ('ended') THEN
    RETURN jsonb_build_object(
      'id', p_room_id,
      'roomId', v_legacy_id,
      'status', v_room.status,
      'unchanged', true
    );
  END IF;

  -- Authorization enforcement for user-initiated state transitions:
  IF p_status = 'active' THEN
    IF p_actor_id IS NULL OR p_actor_id != v_room.owner_id THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_ROOM_OWNER';
    END IF;
  ELSIF p_status = 'inactive' THEN
    IF p_actor_id IS NOT NULL AND p_actor_id != v_room.owner_id THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_ROOM_OWNER';
    END IF;
  END IF;

  -- Canonical lifecycle check: if temporary room has passed its canonical expiresAt, transition to expired
  IF v_room."isPermanent" = false AND v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
    UPDATE public.rooms
    SET status = 'expired',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE id = p_room_id;

    -- Audit
    INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
    VALUES (
      v_room.owner_id,
      p_room_id,
      v_legacy_id,
      v_room.room_kind,
      'EXPIRED',
      '{"reason": "overdue_during_activity_change"}'::jsonb
    );

    INSERT INTO public.room_lifecycle_events (
      room_uuid, "roomId", actor, event, "previousStatus", "newStatus",
      "previousExpiresAt", "newExpiresAt", reason, timestamp
    )
    VALUES (
      p_room_id,
      v_legacy_id,
      COALESCE(p_actor_id::text, 'system'),
      'room.expired',
      v_room.status,
      'expired',
      v_room."expiresAt",
      v_room."expiresAt",
      'canonical expiry reached',
      v_now
    )
    RETURNING id INTO v_lifecycle_event_id;

    v_new_status := 'expired';
  ELSE
    -- Active / Inactive state transition
    IF p_status = 'active' THEN
      UPDATE public.rooms
      SET status = 'active',
          "startedAt" = COALESCE("startedAt", v_now),
          "lastActiveAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE id = p_room_id;
    ELSE
      UPDATE public.rooms
      SET status = 'inactive',
          "lastActiveAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE id = p_room_id;
    END IF;

    IF v_room.status != p_status THEN
      INSERT INTO public.room_lifecycle_events (
        room_uuid, "roomId", actor, event, "previousStatus", "newStatus",
        "previousExpiresAt", "newExpiresAt", reason, timestamp
      )
      VALUES (
        p_room_id,
        v_legacy_id,
        COALESCE(p_actor_id::text, 'system'),
        'room.status_changed',
        v_room.status,
        p_status,
        v_room."expiresAt",
        v_room."expiresAt",
        'activity transition',
        v_now
      )
      RETURNING id INTO v_lifecycle_event_id;
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
    'id', p_room_id,
    'roomId', v_legacy_id,
    'status', v_new_status,
    'previousStatus', v_room.status,
    'transitioned', (v_room.status != v_new_status),
    'lifecycleEventId', v_lifecycle_event_id,
    'expiresAt', v_room."expiresAt",
    'isPermanent', v_room."isPermanent"
  );
END;
$$;


-- 2.6 Canonical UUID set_room_participants_lock_authoritative
CREATE OR REPLACE FUNCTION public.set_room_participants_lock_authoritative(
  p_account_id uuid,
  p_room_id uuid,
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
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1
  FROM public.account_room_usage
  WHERE account_room_usage.account_id = p_account_id
  FOR UPDATE;

  -- 2. Lock and verify room ownership
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.owner_id != p_account_id THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  -- 3. Update field
  UPDATE public.rooms
  SET participants_locked = p_locked,
      "lastUpdateTime" = v_now
  WHERE id = p_room_id;

  -- 4. Emit lifecycle audit event
  INSERT INTO public.room_lifecycle_events (
    room_uuid, "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
  )
  VALUES (
    p_room_id,
    v_legacy_id,
    p_account_id::text,
    CASE WHEN p_locked THEN 'room.participants_locked' ELSE 'room.participants_unlocked' END,
    v_room.status,
    v_room.status,
    CASE WHEN p_locked THEN 'participants locked' ELSE 'participants unlocked' END,
    v_now
  );

  -- 5. Return resulting state
  RETURN jsonb_build_object(
    'id', p_room_id,
    'roomId', v_legacy_id,
    'participants_locked', p_locked
  );
END;
$$;


-- 2.7 Canonical UUID set_room_permanence_authoritative
CREATE OR REPLACE FUNCTION public.set_room_permanence_authoritative(
  p_account_id uuid,
  p_room_id uuid,
  p_is_permanent boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_entitlement RECORD;
  v_now timestamptz := clock_timestamp();
  v_new_kind text := CASE WHEN p_is_permanent THEN 'permanent' ELSE 'watch' END;
  v_new_expires timestamptz;
  v_usage RECORD;
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

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
  WHERE id = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'active' THEN
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_CHANGE_PERMANENCE';
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  IF v_room."isPermanent" = p_is_permanent THEN
    RETURN jsonb_build_object(
      'id', p_room_id,
      'roomId', v_legacy_id,
      'isPermanent', p_is_permanent,
      'unchanged', true
    );
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
      "expiresAt" = v_new_expires,
      "lastUpdateTime" = v_now
  WHERE id = p_room_id AND owner_id = p_account_id;

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
  INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
  VALUES (
    p_account_id,
    p_room_id,
    v_legacy_id,
    v_new_kind,
    'PERMANENCE_CHANGED', 
    jsonb_build_object('isPermanent', p_is_permanent, 'permanent_rooms', v_usage.permanent)
  );

  INSERT INTO public.room_lifecycle_events (
    room_uuid, "roomId", actor, event, "previousStatus", "newStatus",
    "previousExpiresAt", "newExpiresAt", reason, timestamp
  )
  VALUES (
    p_room_id,
    v_legacy_id,
    p_account_id::text,
    'room.permanence_changed',
    v_room.status,
    v_room.status,
    v_room."expiresAt",
    v_new_expires, 
    CASE WHEN p_is_permanent THEN 'converted to permanent' ELSE 'converted to temporary' END,
    v_now
  );

  RETURN jsonb_build_object(
    'id', p_room_id,
    'roomId', v_legacy_id,
    'isPermanent', p_is_permanent,
    'roomKind', v_new_kind,
    'expiresAt', v_new_expires
  );
END;
$$;


-- 2.8 Canonical UUID update_room_metadata_authoritative
CREATE OR REPLACE FUNCTION public.update_room_metadata_authoritative(
  p_account_id uuid,
  p_room_id uuid,
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
  v_legacy_id text;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_passcode_fingerprint IS NOT NULL AND NOT p_clear_passcode THEN
    PERFORM 1
    FROM public.rooms
    WHERE passcode_fingerprint = p_passcode_fingerprint
      AND id != p_room_id;

    IF FOUND THEN
      RAISE EXCEPTION 'PASSCODE_TAKEN';
    END IF;
  END IF;

  v_legacy_id := COALESCE(v_room.legacy_room_id, v_room."roomId", p_room_id::text);

  UPDATE public.rooms
  SET "roomTitle" = COALESCE(p_title, "roomTitle"),
      "roomDescription" = CASE WHEN p_description IS NOT NULL THEN p_description ELSE "roomDescription" END,
      "isChatDisabled" = COALESCE(p_is_chat_disabled, "isChatDisabled"),
      "coverPhoto" = CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE "coverPhoto" END,
      passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_hash IS NOT NULL THEN p_passcode_hash ELSE passcode END,
      owner_passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_owner_passcode IS NOT NULL THEN p_owner_passcode ELSE owner_passcode END,
      passcode_fingerprint = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_fingerprint IS NOT NULL THEN p_passcode_fingerprint ELSE passcode_fingerprint END,
      "lastUpdateTime" = v_now
  WHERE id = p_room_id AND owner_id = p_account_id;

  INSERT INTO public.room_lifecycle_events (
    room_uuid, "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
  )
  VALUES (
    p_room_id,
    v_legacy_id,
    p_account_id::text,
    'room.metadata_updated',
    v_room.status,
    v_room.status,
    'settings updated',
    v_now
  );

  RETURN jsonb_build_object(
    'id', p_room_id,
    'roomId', v_legacy_id,
    'roomTitle', COALESCE(p_title, v_room."roomTitle"),
    'coverPhoto', CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE v_room."coverPhoto" END
  );
END;
$$;


-- 2.9 Refined expire_rooms_authoritative (preserves exact return type TABLE)
CREATE OR REPLACE FUNCTION public.expire_rooms_authoritative()
RETURNS TABLE(
  room_id text,
  owner_id uuid,
  room_kind text,
  previous_expires_at timestamp with time zone,
  ended_at timestamp with time zone
)
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
  v_legacy_id text;
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
      SET status = 'expired', "endedAt" = v_now, "lastUpdateTime" = v_now
      WHERE public.rooms.owner_id = v_account.owner_id
        AND public.rooms.status IN ('active', 'inactive') 
        AND public.rooms."isPermanent" = false 
        AND public.rooms."expiresAt" IS NOT NULL 
        AND public.rooms."expiresAt" <= v_now
      RETURNING public.rooms.id, public.rooms.legacy_room_id, public.rooms."roomId",
                public.rooms.owner_id, public.rooms.room_kind, public.rooms."expiresAt", public.rooms."endedAt"
    LOOP
      v_legacy_id := COALESCE(r.legacy_room_id, r."roomId", r.id::text);
      room_id := v_legacy_id;
      owner_id := r.owner_id;
      room_kind := r.room_kind;
      previous_expires_at := r."expiresAt";
      ended_at := r."endedAt";

      -- Audit Event using both room_uuid and room_id
      INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
      VALUES (r.owner_id, r.id, v_legacy_id, r.room_kind, 'EXPIRED', '{}'::jsonb);

      INSERT INTO public.room_lifecycle_events (
        room_uuid, "roomId", actor, event, "previousStatus", "newStatus",
        "previousExpiresAt", "newExpiresAt", reason, timestamp
      )
      VALUES (
        r.id,
        v_legacy_id,
        'system',
        'room.expired',
        'active_or_inactive',
        'expired',
        r."expiresAt",
        r."expiresAt",
        'time limit reached',
        v_now
      );

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


-- 2.10 Refined purge_account_rooms_authoritative (preserves exact return type text[])
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
  v_legacy_id text;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = p_account_id 
  FOR UPDATE;

  -- 2. Audit and delete all rooms for this account
  FOR r IN
    SELECT public.rooms.id, public.rooms.legacy_room_id, public.rooms."roomId",
           public.rooms.room_kind, public.rooms.status
    FROM public.rooms
    WHERE public.rooms.owner_id = p_account_id
    FOR UPDATE
  LOOP
    v_legacy_id := COALESCE(r.legacy_room_id, r."roomId", r.id::text);
    v_deleted_ids := array_append(v_deleted_ids, v_legacy_id);

    INSERT INTO public.room_quota_events(account_id, room_uuid, room_id, room_kind, event_type, metadata)
    VALUES (
      p_account_id,
      r.id,
      v_legacy_id,
      r.room_kind,
      'PURGED',
      jsonb_build_object('room_uuid', r.id, 'room_id', v_legacy_id, 'account_purge', true)
    );

    INSERT INTO public.room_lifecycle_events (
      room_uuid, "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
    )
    VALUES (
      r.id,
      v_legacy_id,
      p_account_id::text,
      'room.deleted',
      r.status,
      'deleted',
      'account purged',
      v_now
    );
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


-- ############################################################################
-- SECTION 3: DELEGATING LEGACY TEXT SIGNATURES (ADAPTER LAYER)
-- ############################################################################

-- 3.1 Delegating text create_room_authoritative
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
  p_requested_participants integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
    RETURN public.create_room_authoritative(
      p_account_id,
      v_uuid,
      p_room_kind,
      p_room_title,
      p_room_description,
      p_passcode_hash,
      p_owner_passcode,
      p_passcode_fingerprint,
      p_cover_photo,
      p_is_chat_disabled,
      p_expires_at,
      p_requested_participants,
      NULL,
      p_room_id
    );
  ELSE
    v_uuid := gen_random_uuid();
    RETURN public.create_room_authoritative(
      p_account_id,
      v_uuid,
      p_room_kind,
      p_room_title,
      p_room_description,
      p_passcode_hash,
      p_owner_passcode,
      p_passcode_fingerprint,
      p_cover_photo,
      p_is_chat_disabled,
      p_expires_at,
      p_requested_participants,
      NULL,
      p_room_id
    );
  END IF;
END;
$$;


-- 3.2 Delegating text delete_room_authoritative
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
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.delete_room_authoritative(p_account_id, v_uuid);
END;
$$;


-- 3.3 Delegating text end_room_authoritative
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
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.end_room_authoritative(p_account_id, v_uuid, p_actor);
END;
$$;


-- 3.4 Delegating text extend_room_authoritative
CREATE OR REPLACE FUNCTION public.extend_room_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_new_expires_at timestamp with time zone
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.extend_room_authoritative(p_account_id, v_uuid, p_new_expires_at);
END;
$$;


-- 3.5 Delegating text set_room_activity_authoritative
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
DECLARE
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id);

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.set_room_activity_authoritative(v_uuid, p_status, p_actor_id);
END;
$$;


-- 3.6 Delegating text set_room_participants_lock_authoritative
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
DECLARE
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.set_room_participants_lock_authoritative(p_account_id, v_uuid, p_locked);
END;
$$;


-- 3.7 Delegating text set_room_permanence_authoritative
CREATE OR REPLACE FUNCTION public.set_room_permanence_authoritative(
  p_account_id uuid,
  p_room_id text,
  p_is_permanent boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.set_room_permanence_authoritative(p_account_id, v_uuid, p_is_permanent);
END;
$$;


-- 3.8 Delegating text update_room_metadata_authoritative
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
DECLARE
  v_uuid uuid;
BEGIN
  IF p_room_id IS NULL OR trim(p_room_id) = '' THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uuid := p_room_id::uuid;
  ELSE
    SELECT id INTO v_uuid
    FROM public.rooms
    WHERE (legacy_room_id = p_room_id OR "roomId" = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.update_room_metadata_authoritative(
    p_account_id,
    v_uuid,
    p_title,
    p_description,
    p_is_chat_disabled,
    p_cover_photo,
    p_passcode_hash,
    p_owner_passcode,
    p_passcode_fingerprint,
    p_clear_passcode
  );
END;
$$;


-- ############################################################################
-- SECTION 4: STRICT SECURITY PRIVILEGE LOCKDOWN
-- ############################################################################

-- 4.1 Revoke all public, anon, and authenticated execution rights
REVOKE ALL ON FUNCTION public.resolve_room_authoritative(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_room_authoritative(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_room_authoritative(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_room_authoritative(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_activity_authoritative(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_participants_lock_authoritative(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_room_metadata_authoritative(uuid, uuid, text, text, boolean, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_room_authoritative(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_room_authoritative(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_room_authoritative(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_activity_authoritative(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_participants_lock_authoritative(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_room_metadata_authoritative(uuid, text, text, text, boolean, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.expire_rooms_authoritative() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_account_rooms_authoritative(uuid) FROM PUBLIC, anon, authenticated;

-- 4.2 Grant execute privileges exclusively to postgres and service_role
GRANT EXECUTE ON FUNCTION public.resolve_room_authoritative(text) TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz, integer, text, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative(uuid, uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative(uuid, uuid, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative(uuid, uuid, timestamptz) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative(uuid, text, uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative(uuid, uuid, boolean) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative(uuid, uuid, boolean) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative(uuid, uuid, text, text, boolean, text, text, text, text, boolean) TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative(uuid, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative(uuid, text, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative(uuid, text, timestamptz) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative(text, text, uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative(uuid, text, boolean) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative(uuid, text, text, text, boolean, text, text, text, text, boolean) TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.expire_rooms_authoritative() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.purge_account_rooms_authoritative(uuid) TO postgres, service_role;

COMMIT;

-- ============================================================================
-- END OF FORWARD MIGRATION (sql/migrations/20261118_room_identity_phase2_rpcs_up.sql)
-- ============================================================================
