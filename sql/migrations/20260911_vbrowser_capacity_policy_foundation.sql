-- Empty, production-ready VBrowser capacity registry. No provider or pool is
-- created here; allocation remains fail-closed until an administrator supplies
-- real capacity and enables both provider and pool.

ALTER TABLE public.vbrowser_providers
  ADD COLUMN lifecycle text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN max_concurrent_sessions integer,
  ADD COLUMN max_sessions_per_user integer,
  ADD COLUMN max_sessions_per_room integer,
  ADD COLUMN max_large_sessions integer,
  ADD COLUMN max_session_duration_seconds integer,
  ADD COLUMN max_large_session_duration_seconds integer,
  ADD CONSTRAINT vbrowser_providers_lifecycle_check CHECK (lifecycle IN ('DRAFT', 'ENABLED', 'DISABLED', 'RETIRED')),
  ADD CONSTRAINT vbrowser_providers_policy_nonnegative CHECK (
    (max_concurrent_sessions IS NULL OR max_concurrent_sessions >= 0) AND
    (max_sessions_per_user IS NULL OR max_sessions_per_user >= 0) AND
    (max_sessions_per_room IS NULL OR max_sessions_per_room >= 0) AND
    (max_large_sessions IS NULL OR max_large_sessions >= 0) AND
    (max_session_duration_seconds IS NULL OR max_session_duration_seconds > 0) AND
    (max_large_session_duration_seconds IS NULL OR max_large_session_duration_seconds > 0)
  ),
  ADD CONSTRAINT vbrowser_providers_enabled_lifecycle_check CHECK (NOT enabled OR lifecycle = 'ENABLED');

ALTER TABLE public.vbrowser_pools
  ADD COLUMN lifecycle text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN max_sessions_per_user integer,
  ADD COLUMN max_sessions_per_room integer,
  ADD COLUMN max_large_sessions integer,
  ADD COLUMN max_session_duration_seconds integer,
  ADD COLUMN max_large_session_duration_seconds integer,
  ADD CONSTRAINT vbrowser_pools_lifecycle_check CHECK (lifecycle IN ('DRAFT', 'ENABLED', 'DISABLED', 'RETIRED')),
  ADD CONSTRAINT vbrowser_pools_policy_nonnegative CHECK (
    (max_sessions_per_user IS NULL OR max_sessions_per_user >= 0) AND
    (max_sessions_per_room IS NULL OR max_sessions_per_room >= 0) AND
    (max_large_sessions IS NULL OR max_large_sessions >= 0) AND
    (max_session_duration_seconds IS NULL OR max_session_duration_seconds > 0) AND
    (max_large_session_duration_seconds IS NULL OR max_large_session_duration_seconds > 0)
  ),
  ADD CONSTRAINT vbrowser_pools_enabled_lifecycle_check CHECK (NOT enabled OR lifecycle = 'ENABLED');

ALTER TABLE public.vbrowser
  ADD COLUMN pool_id text REFERENCES public.vbrowser_pools(id) ON DELETE RESTRICT,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN released_at timestamptz;

CREATE TABLE public.vbrowser_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL REFERENCES public.vbrowser_providers(id) ON DELETE RESTRICT,
  pool_id text NOT NULL REFERENCES public.vbrowser_pools(id) ON DELETE RESTRICT,
  room_id text NOT NULL REFERENCES public.rooms("roomId") ON DELETE CASCADE,
  user_id text NOT NULL,
  is_large boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'ALLOCATED', 'RELEASED', 'FAILED', 'EXPIRED')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  failure_reason text,
  CONSTRAINT vbrowser_reservations_release_timestamp_check CHECK ((status IN ('RELEASED', 'FAILED', 'EXPIRED')) = (released_at IS NOT NULL))
);

CREATE INDEX vbrowser_reservations_active_provider_idx ON public.vbrowser_reservations(provider_id) WHERE status IN ('RESERVED', 'ALLOCATED');
CREATE INDEX vbrowser_reservations_active_pool_idx ON public.vbrowser_reservations(pool_id) WHERE status IN ('RESERVED', 'ALLOCATED');
CREATE INDEX vbrowser_reservations_active_user_idx ON public.vbrowser_reservations(provider_id, user_id) WHERE status IN ('RESERVED', 'ALLOCATED');
CREATE INDEX vbrowser_reservations_active_room_idx ON public.vbrowser_reservations(provider_id, room_id) WHERE status IN ('RESERVED', 'ALLOCATED');
CREATE INDEX vbrowser_reservations_expiry_idx ON public.vbrowser_reservations(expires_at) WHERE status IN ('RESERVED', 'ALLOCATED');
CREATE INDEX vbrowser_pool_id_idx ON public.vbrowser(pool_id);
CREATE INDEX vbrowser_active_lease_idx ON public.vbrowser(provider_id, pool_id, "heartbeatTime") WHERE state IN ('staging', 'used') AND released_at IS NULL;

ALTER TABLE public.vbrowser_reservations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reserve_vbrowser_capacity(
  p_provider_id text,
  p_pool_id text,
  p_room_id text,
  p_user_id text,
  p_is_large boolean,
  p_config_provider_limit integer,
  p_config_pool_limit integer,
  p_lease_seconds integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  UPDATE public.vbrowser_reservations SET status = 'EXPIRED', released_at = now(), failure_reason = 'LEASE_EXPIRED' WHERE status IN ('RESERVED', 'ALLOCATED') AND expires_at <= now();
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
  INSERT INTO public.vbrowser_reservations(provider_id, pool_id, room_id, user_id, is_large, expires_at) VALUES (p_provider_id, p_pool_id, p_room_id, p_user_id, p_is_large, now() + make_interval(secs => p_lease_seconds)) RETURNING id INTO reservation_id;
  RETURN reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_vbrowser_capacity(text, text, text, text, boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;
