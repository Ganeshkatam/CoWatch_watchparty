-- Migration: 20260918_harden_vbrowser_reservation_concurrency.sql
-- Description: Hardens vbrowser_acquire_reservation with advisory transaction locks
--              (provider, pool, user) and row-level FOR UPDATE locks on providers and pools.

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
SET search_path TO ''
AS $$
DECLARE
  reservation_id text;
  provider_row public.vbrowser_providers%ROWTYPE;
  pool_row public.vbrowser_pools%ROWTYPE;
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
  -- Input validation
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_config_provider_limit < 0 OR p_config_pool_limit < 0 THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;

  -- 1. Deterministic Advisory Transaction Locks (Provider -> Pool -> User)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pool_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- 2. Resolve centralized subscription billing entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_user_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  IF NOT v_entitlement.is_vbrowser_allowed THEN
    RAISE EXCEPTION 'VBROWSER_NOT_ENTITLED';
  END IF;

  -- 3. Row-level locks on provider and pool with lifecycle verification
  SELECT * INTO provider_row 
  FROM public.vbrowser_providers 
  WHERE id = p_provider_id 
  FOR UPDATE;

  IF NOT FOUND OR NOT provider_row.enabled OR provider_row.lifecycle <> 'ENABLED' THEN
    RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';
  END IF;

  SELECT * INTO pool_row 
  FROM public.vbrowser_pools 
  WHERE id = p_pool_id AND provider_id = p_provider_id 
  FOR UPDATE;

  IF NOT FOUND OR NOT pool_row.enabled OR pool_row.lifecycle <> 'ENABLED' THEN
    RAISE EXCEPTION 'POOL_UNAVAILABLE';
  END IF;

  IF provider_row.max_concurrent_sessions IS NULL OR provider_row.max_sessions_per_user IS NULL 
     OR provider_row.max_sessions_per_room IS NULL OR provider_row.max_large_sessions IS NULL 
     OR pool_row.limit_size IS NULL OR pool_row.max_sessions_per_user IS NULL 
     OR pool_row.max_sessions_per_room IS NULL OR pool_row.max_large_sessions IS NULL THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;

  effective_provider := LEAST(provider_row.max_concurrent_sessions, p_config_provider_limit);
  effective_pool := LEAST(pool_row.limit_size, effective_provider, p_config_pool_limit);
  effective_user := LEAST(provider_row.max_sessions_per_user, pool_row.max_sessions_per_user);
  effective_room := LEAST(provider_row.max_sessions_per_room, pool_row.max_sessions_per_room);
  effective_large := LEAST(provider_row.max_large_sessions, pool_row.max_large_sessions);

  -- 4. Sweep expired reservations
  UPDATE public.vbrowser_reservations
  SET status = 'EXPIRED', released_at = now(), failure_reason = 'LEASE_EXPIRED'
  WHERE status IN ('RESERVED', 'ALLOCATED') AND expires_at <= now();

  -- 5. Enforce user plan concurrency limit under lock
  SELECT count(*) INTO v_active_user_vbrowser_allocations
  FROM public.vbrowser_reservations
  WHERE user_id = p_user_id::text AND status IN ('RESERVED', 'ALLOCATED');

  IF v_active_user_vbrowser_allocations >= v_entitlement.max_vbrowser_concurrency THEN
    RAISE EXCEPTION 'VBROWSER_CONCURRENCY_LIMIT_REACHED';
  END IF;

  -- 6. Count active allocations under lock
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

  -- 7. Atomic insertion
  INSERT INTO public.vbrowser_reservations (provider_id, pool_id, room_id, user_id, is_large, expires_at)
  VALUES (p_provider_id, p_pool_id, p_room_id, p_user_id::text, p_is_large, now() + make_interval(secs => p_lease_seconds))
  RETURNING id::text INTO reservation_id;

  RETURN reservation_id;
END;
$$;

-- Preserve strict security and ACL boundaries
REVOKE ALL ON FUNCTION public.vbrowser_acquire_reservation(text, text, text, uuid, boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vbrowser_acquire_reservation(text, text, text, uuid, boolean, integer, integer, integer) TO postgres, service_role;
