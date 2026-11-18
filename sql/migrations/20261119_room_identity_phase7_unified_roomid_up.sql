-- ============================================================================
-- CoWatch WatchParty: Room Identity Architecture Migration - Phase 7.1 (UNIFIED ROOMID UP)
-- Migration File: sql/migrations/20261119_room_identity_phase7_unified_roomid_up.sql
-- Target System: PostgreSQL 14+ / Supabase Production Catalog
--
-- PURPOSE:
-- Final database-level identity unification:
-- 1. Renames rooms.id to rooms."roomId" (UUID PK).
-- 2. Renames child table room_uuid to "roomId" (UUID FK) on all 7 child tables:
--    - room_admissions
--    - room_bans
--    - room_invitations
--    - room_lifecycle_events
--    - room_media_sessions
--    - room_messages
--    - room_quota_events
-- 3. Updates foreign key constraint names and unique constraints.
-- 4. Rebuilds indexes on "roomId" across parent and child tables.
-- 5. Updates all authoritative stored procedures and delegating wrappers
--    to reference rooms."roomId" and child "roomId".
-- 6. Preserves all existing UUID values and row counts across all tables.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ############################################################################
-- STAGE 1: RENAME PARENT TABLE PRIMARY IDENTITY COLUMN
-- ############################################################################

ALTER TABLE public.rooms RENAME COLUMN id TO "roomId";


-- ############################################################################
-- STAGE 2: RENAME CHILD TABLE ROOM RELATIONSHIP COLUMNS
-- (Preserves child row-level PK 'id' or 'media_id' on every child table)
-- ############################################################################

ALTER TABLE public.room_admissions RENAME COLUMN room_uuid TO "roomId";
ALTER TABLE public.room_bans RENAME COLUMN room_uuid TO "roomId";
ALTER TABLE public.room_invitations RENAME COLUMN room_uuid TO "roomId";
ALTER TABLE public.room_lifecycle_events RENAME COLUMN room_uuid TO "roomId";
ALTER TABLE public.room_media_sessions RENAME COLUMN room_uuid TO "roomId";
ALTER TABLE public.room_messages RENAME COLUMN room_uuid TO "roomId";
ALTER TABLE public.room_quota_events RENAME COLUMN room_uuid TO "roomId";


-- ############################################################################
-- STAGE 3: UPDATE CONSTRAINTS AND REBUILD INDEXES
-- ############################################################################

-- 3.1 Rename Foreign Key Constraints
ALTER TABLE public.room_admissions RENAME CONSTRAINT room_admissions_room_uuid_fkey TO "room_admissions_roomId_fkey";
ALTER TABLE public.room_bans RENAME CONSTRAINT room_bans_room_uuid_fkey TO "room_bans_roomId_fkey";
ALTER TABLE public.room_invitations RENAME CONSTRAINT room_invitations_room_uuid_fkey TO "room_invitations_roomId_fkey";
ALTER TABLE public.room_lifecycle_events RENAME CONSTRAINT room_lifecycle_events_room_uuid_fkey TO "room_lifecycle_events_roomId_fkey";
ALTER TABLE public.room_media_sessions RENAME CONSTRAINT room_media_sessions_room_uuid_fkey TO "room_media_sessions_roomId_fkey";
ALTER TABLE public.room_messages RENAME CONSTRAINT room_messages_room_uuid_fkey TO "room_messages_roomId_fkey";
ALTER TABLE public.room_quota_events RENAME CONSTRAINT room_quota_events_room_uuid_fkey TO "room_quota_events_roomId_fkey";

-- 3.2 Rename Unique Constraints
ALTER TABLE public.room_admissions RENAME CONSTRAINT room_admissions_room_uuid_user_unique TO "room_admissions_roomId_user_unique";
ALTER TABLE public.room_bans RENAME CONSTRAINT room_bans_room_uuid_client_identity_unique TO "room_bans_roomId_client_identity_unique";
ALTER TABLE public.room_messages RENAME CONSTRAINT room_messages_room_uuid_user_client_msg_unique TO "room_messages_roomId_user_client_msg_unique";

-- 3.3 Rebuild Indexes with Clean Names
DROP INDEX IF EXISTS public.idx_room_admissions_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_admissions_roomId" ON public.room_admissions ("roomId");

DROP INDEX IF EXISTS public.idx_room_admissions_lookup_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_admissions_lookup" ON public.room_admissions ("roomId", user_id) WHERE (revoked_at IS NULL);

DROP INDEX IF EXISTS public.idx_room_bans_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_bans_roomId" ON public.room_bans ("roomId");

DROP INDEX IF EXISTS public.idx_room_bans_user_id_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_bans_user_id" ON public.room_bans ("roomId", user_id) WHERE (user_id IS NOT NULL);

DROP INDEX IF EXISTS public.idx_room_invitations_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_invitations_roomId" ON public.room_invitations ("roomId");

DROP INDEX IF EXISTS public.idx_room_lifecycle_events_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_lifecycle_events_roomId" ON public.room_lifecycle_events ("roomId");

DROP INDEX IF EXISTS public.idx_room_media_sessions_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_media_sessions_roomId" ON public.room_media_sessions ("roomId");

DROP INDEX IF EXISTS public.idx_room_messages_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_messages_roomId" ON public.room_messages ("roomId");

DROP INDEX IF EXISTS public.room_messages_room_created_id_idx_uuid;
CREATE INDEX IF NOT EXISTS "room_messages_roomId_created_id_idx" ON public.room_messages ("roomId", created_at DESC, id DESC);

DROP INDEX IF EXISTS public.idx_room_quota_events_room_uuid;
CREATE INDEX IF NOT EXISTS "idx_room_quota_events_roomId" ON public.room_quota_events ("roomId");


-- ############################################################################
-- STAGE 4: UPDATE AUTHORITATIVE STORED PROCEDURES
-- ############################################################################

-- 4.1 Universal Room Boundary Resolver
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

  -- 1. Check 10-digit public joining code
  IF p_identifier ~ '^[0-9]{10}$' THEN
    SELECT * INTO v_room
    FROM public.rooms
    WHERE joining_id = p_identifier;

    IF FOUND THEN
      RETURN v_room;
    END IF;
  END IF;

  -- 2. Check canonical UUID against rooms."roomId"
  IF p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_room
    FROM public.rooms
    WHERE "roomId" = p_identifier::uuid;

    IF FOUND THEN
      RETURN v_room;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;


-- 4.2 Canonical create_room_authoritative
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

  -- 2. Lock entitlement and usage row in order
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
    INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'ACCOUNT_ROOMS_DISABLED', 'attempted_room_id', p_room_id::text));
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 4. Auto-expire overdue rooms for this account
  UPDATE public.rooms
  SET status = 'expired', "endedAt" = v_now
  WHERE owner_id = p_account_id 
    AND status IN ('active', 'inactive') 
    AND "isPermanent" = false 
    AND "expiresAt" IS NOT NULL 
    AND "expiresAt" <= v_now;

  -- 5. Count rooms
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
    INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'TOTAL_ROOM_LIMIT_EXCEEDED', 'limit', v_entitlement.max_total_rooms, 'current', v_usage.total, 'attempted_room_id', p_room_id::text));
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 7. Enforce Room Kind Sub-Limit
  IF p_room_kind = 'watch' AND v_usage.watch >= v_entitlement.max_watch_rooms THEN
    INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'watch', 'limit', v_entitlement.max_watch_rooms, 'current', v_usage.watch, 'attempted_room_id', p_room_id::text));
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
    INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
    VALUES (p_account_id, p_room_id, p_room_kind, 'REJECTED', 
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

  -- 10. Allocate 10-digit joining ID if not provided
  IF p_joining_id IS NOT NULL AND p_joining_id ~ '^[0-9]{10}$' THEN
    v_assigned_joining_id := p_joining_id;
  ELSE
    v_assigned_joining_id := public.allocate_room_joining_id();
  END IF;

  -- 11. Insert Authoritative Room Row (rooms."roomId" UUID PK)
  INSERT INTO public.rooms (
    "roomId", joining_id,
    "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind, max_participants
  ) VALUES (
    p_room_id, v_assigned_joining_id,
    v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, v_effective_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind, v_effective_capacity
  );

  -- 12. Update Materialized Usage Record
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total + 1,
      watch_rooms = v_usage.watch + CASE WHEN p_room_kind = 'watch' THEN 1 ELSE 0 END,
      permanent_rooms = v_usage.permanent + CASE WHEN p_room_kind = 'permanent' THEN 1 ELSE 0 END,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 13. Audit Record & Lifecycle Event
  INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, p_room_kind, 'CREATED', jsonb_build_object('total_rooms', v_usage.total + 1));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, p_account_id::text, 'room.created', 'inactive', v_effective_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'roomId', p_room_id::text,
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


-- 4.3 Canonical delete_room_authoritative
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
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock using canonical "roomId" primary key
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

  -- 3. Delete Room Row
  DELETE FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 4. Aggregate Recalculation
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
  INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
  VALUES (
    p_account_id,
    NULL,
    v_room.room_kind,
    'DELETED',
    jsonb_build_object('roomId', p_room_id, 'total_rooms', v_usage.total)
  );

  RETURN jsonb_build_object(
    'roomId', p_room_id::text,
    'deletedRoomId', p_room_id::text,
    'roomKind', v_room.room_kind,
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;


-- 4.4 Canonical end_room_authoritative
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
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room."isPermanent" = false AND v_room.status IN ('ended', 'expired') THEN
    RETURN jsonb_build_object(
      'roomId', p_room_id::text,
      'status', v_room.status,
      'isPermanent', false,
      'alreadyConcluded', true
    );
  ELSIF v_room."isPermanent" = true AND v_room.status = 'inactive' THEN
    RETURN jsonb_build_object(
      'roomId', p_room_id::text,
      'status', 'inactive',
      'isPermanent', true,
      'alreadyConcluded', true
    );
  END IF;

  -- 3. Atomic transition
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

  -- 4. Aggregate Recalculation
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
  INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
  VALUES (
    p_account_id,
    p_room_id,
    v_room.room_kind,
    v_quota_event,
    jsonb_build_object('total_rooms', v_usage.total, 'status', v_new_status)
  );

  INSERT INTO public.room_lifecycle_events (
    "roomId", actor, event, "previousStatus", "newStatus",
    "previousExpiresAt", "newExpiresAt", reason, timestamp
  )
  VALUES (
    p_room_id,
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
    'roomId', p_room_id::text,
    'status', v_new_status,
    'isPermanent', v_room."isPermanent",
    'totalRoomsRemaining', v_usage.total
  );
END;
$$;


-- 4.5 Canonical extend_room_authoritative
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
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  -- 1. Lock entitlement and usage row in order
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

  IF v_room."isPermanent" = true THEN
    RAISE EXCEPTION 'ROOM_IS_PERMANENT';
  END IF;

  IF v_room.status IN ('ended', 'expired') THEN
    RAISE EXCEPTION 'ROOM_ENDED_CANNOT_EXTEND';
  END IF;

  IF v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
    UPDATE public.rooms SET status = 'expired', "endedAt" = v_now WHERE "roomId" = p_room_id;
    RAISE EXCEPTION 'ROOM_ALREADY_EXPIRED';
  END IF;

  IF p_new_expires_at <= v_room."expiresAt" THEN
    RAISE EXCEPTION 'INVALID_EXTENSION_TIME';
  END IF;

  IF p_new_expires_at > v_room."creationTime" + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
    RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
  END IF;

  -- 4. Update expiresAt
  UPDATE public.rooms
  SET "expiresAt" = p_new_expires_at,
      "lastUpdateTime" = v_now
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 5. Audit
  INSERT INTO public.room_lifecycle_events (
    "roomId", actor, event, "previousStatus", "newStatus",
    "previousExpiresAt", "newExpiresAt", reason, timestamp
  )
  VALUES (
    p_room_id,
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


-- 4.6 Canonical set_room_activity_authoritative
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
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = v_room.owner_id 
  FOR UPDATE;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id
  FOR UPDATE;

  IF v_room.status IN ('ended', 'expired') THEN
    RETURN jsonb_build_object(
      'roomId', p_room_id::text,
      'status', v_room.status,
      'isPermanent', v_room."isPermanent",
      'alreadyConcluded', true
    );
  END IF;

  IF v_room.status = 'active' AND p_status = 'inactive' THEN
    UPDATE public.rooms
    SET status = 'inactive',
        "lastUpdateTime" = v_now
    WHERE "roomId" = p_room_id;

    INSERT INTO public.room_lifecycle_events (
      "roomId", actor, event, "previousStatus", "newStatus",
      "previousExpiresAt", "newExpiresAt", reason, timestamp
    )
    VALUES (
      p_room_id,
      COALESCE(p_actor_id::text, 'system'),
      'room.deactivated',
      'active',
      'inactive',
      v_room."expiresAt",
      v_room."expiresAt",
      'inactivity transition',
      v_now
    )
    RETURNING id INTO v_lifecycle_event_id;

  ELSIF v_room.status = 'inactive' AND p_status = 'active' THEN
    IF v_room."isPermanent" = false AND v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
      UPDATE public.rooms
      SET status = 'expired',
          "endedAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE "roomId" = p_room_id;

      v_new_status := 'expired';

      INSERT INTO public.room_lifecycle_events (
        "roomId", actor, event, "previousStatus", "newStatus",
        "previousExpiresAt", "newExpiresAt", reason, timestamp
      )
      VALUES (
        p_room_id,
        COALESCE(p_actor_id::text, 'system'),
        'room.expired',
        'inactive',
        'expired',
        v_room."expiresAt",
        v_room."expiresAt",
        'expired while inactive',
        v_now
      )
      RETURNING id INTO v_lifecycle_event_id;
    ELSE
      UPDATE public.rooms
      SET status = 'active',
          "lastUpdateTime" = v_now,
          "lastActiveAt" = v_now
      WHERE "roomId" = p_room_id;

      INSERT INTO public.room_lifecycle_events (
        "roomId", actor, event, "previousStatus", "newStatus",
        "previousExpiresAt", "newExpiresAt", reason, timestamp
      )
      VALUES (
        p_room_id,
        COALESCE(p_actor_id::text, 'system'),
        'room.activated',
        'inactive',
        'active',
        v_room."expiresAt",
        v_room."expiresAt",
        'activity transition',
        v_now
      )
      RETURNING id INTO v_lifecycle_event_id;
    END IF;
  END IF;

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
    'roomId', p_room_id::text,
    'status', v_new_status,
    'previousStatus', v_room.status,
    'transitioned', (v_room.status != v_new_status),
    'lifecycleEventId', v_lifecycle_event_id,
    'expiresAt', v_room."expiresAt",
    'isPermanent', v_room."isPermanent"
  );
END;
$$;


-- 4.7 Canonical set_room_participants_lock_authoritative
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
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  PERFORM 1
  FROM public.account_room_usage
  WHERE account_room_usage.account_id = p_account_id
  FOR UPDATE;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.owner_id != p_account_id THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  UPDATE public.rooms
  SET participants_locked = p_locked,
      "lastUpdateTime" = v_now
  WHERE "roomId" = p_room_id;

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

  RETURN jsonb_build_object(
    'roomId', p_room_id::text,
    'participants_locked', p_locked
  );
END;
$$;


-- 4.8 Canonical set_room_permanence_authoritative
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
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

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
    RETURN jsonb_build_object(
      'roomId', p_room_id::text,
      'isPermanent', p_is_permanent,
      'unchanged', true
    );
  END IF;

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

  UPDATE public.rooms
  SET "isPermanent" = p_is_permanent,
      room_kind = v_new_kind,
      "isSubRoom" = p_is_permanent,
      "expiresAt" = v_new_expires,
      "lastUpdateTime" = v_now
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

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

  INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
  VALUES (
    p_account_id,
    p_room_id,
    v_new_kind,
    'PERMANENCE_CHANGED', 
    jsonb_build_object('isPermanent', p_is_permanent, 'permanent_rooms', v_usage.permanent)
  );

  INSERT INTO public.room_lifecycle_events (
    "roomId", actor, event, "previousStatus", "newStatus",
    "previousExpiresAt", "newExpiresAt", reason, timestamp
  )
  VALUES (
    p_room_id,
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
    'roomId', p_room_id::text,
    'isPermanent', p_is_permanent,
    'roomKind', v_new_kind,
    'expiresAt', v_new_expires
  );
END;
$$;


-- 4.9 Canonical update_room_metadata_authoritative
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
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_ID_REQUIRED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_passcode_fingerprint IS NOT NULL AND NOT p_clear_passcode THEN
    PERFORM 1
    FROM public.rooms
    WHERE passcode_fingerprint = p_passcode_fingerprint
      AND "roomId" != p_room_id;

    IF FOUND THEN
      RAISE EXCEPTION 'PASSCODE_TAKEN';
    END IF;
  END IF;

  UPDATE public.rooms
  SET "roomTitle" = COALESCE(p_title, "roomTitle"),
      "roomDescription" = CASE WHEN p_description IS NOT NULL THEN p_description ELSE "roomDescription" END,
      "isChatDisabled" = COALESCE(p_is_chat_disabled, "isChatDisabled"),
      "coverPhoto" = CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE "coverPhoto" END,
      passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_hash IS NOT NULL THEN p_passcode_hash ELSE passcode END,
      owner_passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_owner_passcode IS NOT NULL THEN p_owner_passcode ELSE owner_passcode END,
      passcode_fingerprint = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_fingerprint IS NOT NULL THEN p_passcode_fingerprint ELSE passcode_fingerprint END,
      "lastUpdateTime" = v_now
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  INSERT INTO public.room_lifecycle_events (
    "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
  )
  VALUES (
    p_room_id,
    p_account_id::text,
    'room.metadata_updated',
    v_room.status,
    v_room.status,
    'settings updated',
    v_now
  );

  RETURN jsonb_build_object(
    'roomId', p_room_id::text,
    'roomTitle', COALESCE(p_title, v_room."roomTitle"),
    'coverPhoto', CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE v_room."coverPhoto" END
  );
END;
$$;


-- 4.10 Canonical expire_rooms_authoritative
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
BEGIN
  FOR v_account IN
    SELECT DISTINCT public.rooms.owner_id
    FROM public.rooms
    WHERE status IN ('active', 'inactive')
      AND "isPermanent" = false
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" <= v_now
  LOOP
    PERFORM 1 
    FROM public.account_room_usage 
    WHERE account_room_usage.account_id = v_account.owner_id 
    FOR UPDATE;

    FOR r IN
      UPDATE public.rooms
      SET status = 'expired', "endedAt" = v_now, "lastUpdateTime" = v_now
      WHERE public.rooms.owner_id = v_account.owner_id
        AND public.rooms.status IN ('active', 'inactive') 
        AND public.rooms."isPermanent" = false 
        AND public.rooms."expiresAt" IS NOT NULL 
        AND public.rooms."expiresAt" <= v_now
      RETURNING public.rooms."roomId", public.rooms.owner_id, public.rooms.room_kind, public.rooms."expiresAt"
    LOOP
      INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
      VALUES (
        r.owner_id,
        r."roomId",
        r.room_kind,
        'EXPIRED',
        jsonb_build_object('auto_expired', true, 'expired_at', v_now)
      );

      INSERT INTO public.room_lifecycle_events (
        "roomId", actor, event, "previousStatus", "newStatus",
        "previousExpiresAt", "newExpiresAt", reason, timestamp
      )
      VALUES (
        r."roomId",
        'system',
        'room.expired',
        'active',
        'expired',
        r."expiresAt",
        r."expiresAt",
        'background batch expiry',
        v_now
      );

      room_id := r."roomId"::text;
      owner_id := r.owner_id;
      room_kind := r.room_kind;
      previous_expires_at := r."expiresAt";
      ended_at := v_now;
      RETURN NEXT;
    END LOOP;

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


-- 4.11 Canonical purge_account_rooms_authoritative
CREATE OR REPLACE FUNCTION public.purge_account_rooms_authoritative(
  p_account_id uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_deleted_ids uuid[] := ARRAY[]::uuid[];
  r RECORD;
BEGIN
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = p_account_id 
  FOR UPDATE;

  FOR r IN
    SELECT public.rooms."roomId", public.rooms.room_kind, public.rooms.status
    FROM public.rooms
    WHERE public.rooms.owner_id = p_account_id
    FOR UPDATE
  LOOP
    v_deleted_ids := array_append(v_deleted_ids, r."roomId");

    INSERT INTO public.room_quota_events(account_id, "roomId", room_kind, event_type, metadata)
    VALUES (
      p_account_id,
      r."roomId",
      r.room_kind,
      'PURGED',
      jsonb_build_object('roomId', r."roomId", 'account_purge', true)
    );

    INSERT INTO public.room_lifecycle_events (
      "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
    )
    VALUES (
      r."roomId",
      p_account_id::text,
      'room.deleted',
      r.status,
      'deleted',
      'account purged',
      v_now
    );
  END LOOP;

  DELETE FROM public.rooms WHERE public.rooms.owner_id = p_account_id;

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
-- STAGE 5: DELEGATING TEXT SIGNATURES (BOUNDARY ADAPTER LAYER)
-- ############################################################################

-- 5.1 Delegating text create_room_authoritative
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
  ELSE
    v_uuid := gen_random_uuid();
  END IF;

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
    NULL
  );
END;
$$;


-- 5.2 Delegating text delete_room_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.delete_room_authoritative(p_account_id, v_uuid);
END;
$$;


-- 5.3 Delegating text end_room_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.end_room_authoritative(p_account_id, v_uuid, p_actor);
END;
$$;


-- 5.4 Delegating text extend_room_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.extend_room_authoritative(p_account_id, v_uuid, p_new_expires_at);
END;
$$;


-- 5.5 Delegating text set_room_activity_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id);

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.set_room_activity_authoritative(v_uuid, p_status, p_actor_id);
END;
$$;


-- 5.6 Delegating text set_room_participants_lock_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.set_room_participants_lock_authoritative(p_account_id, v_uuid, p_locked);
END;
$$;


-- 5.7 Delegating text set_room_permanence_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id)
      AND owner_id = p_account_id;

    IF NOT FOUND OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND';
    END IF;
  END IF;

  RETURN public.set_room_permanence_authoritative(p_account_id, v_uuid, p_is_permanent);
END;
$$;


-- 5.8 Delegating text update_room_metadata_authoritative
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
    SELECT "roomId" INTO v_uuid
    FROM public.rooms
    WHERE ("roomId"::text = p_room_id OR joining_id = p_room_id)
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
-- STAGE 6: PRIVILEGES & GRANTS LOCKDOWN
-- ############################################################################

REVOKE ALL ON FUNCTION public.resolve_room_authoritative(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_room_authoritative(text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz, int, text, text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_authoritative(uuid, text, text, text, text, text, text, text, text, boolean, timestamptz, int) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.delete_room_authoritative(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative(uuid, uuid) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.delete_room_authoritative(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative(uuid, text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.end_room_authoritative(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative(uuid, uuid, text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.end_room_authoritative(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative(uuid, text, text) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.extend_room_authoritative(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative(uuid, uuid, timestamptz) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.extend_room_authoritative(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative(uuid, text, timestamptz) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.set_room_activity_authoritative(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative(uuid, text, uuid) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.set_room_activity_authoritative(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative(text, text, uuid) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.set_room_participants_lock_authoritative(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative(uuid, uuid, boolean) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.set_room_participants_lock_authoritative(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative(uuid, text, boolean) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative(uuid, uuid, boolean) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative(uuid, text, boolean) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.update_room_metadata_authoritative(uuid, uuid, text, text, boolean, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative(uuid, uuid, text, text, boolean, text, text, text, text, boolean) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.update_room_metadata_authoritative(uuid, text, text, text, boolean, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative(uuid, text, text, text, boolean, text, text, text, text, boolean) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.expire_rooms_authoritative() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_rooms_authoritative() TO postgres, service_role;

REVOKE ALL ON FUNCTION public.purge_account_rooms_authoritative(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_rooms_authoritative(uuid) TO postgres, service_role;

COMMIT;
