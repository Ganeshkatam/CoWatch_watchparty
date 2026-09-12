-- ============================================================================
-- NOTIFY-004: PostgreSQL-Backed Shared Durable Rate Limiting
--
-- Replaces process-local rate limiters with atomic, shared PostgreSQL token buckets.
-- Enforces multi-instance consistency for abuse reports, invitations, and auth.
-- Completely avoids Redis dependency while preventing cluster drift.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.durable_rate_limits (
  key text PRIMARY KEY,
  tokens integer NOT NULL,
  last_refill_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp()
);

-- RLS: purely server-authoritative, opaque to anon and authenticated clients
ALTER TABLE public.durable_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.durable_rate_limits FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.durable_rate_limits TO service_role, postgres;

CREATE INDEX IF NOT EXISTS idx_durable_rate_limits_last_refill
  ON public.durable_rate_limits (last_refill_at);

-- Atomic token bucket consumption function
CREATE OR REPLACE FUNCTION public.consume_durable_rate_limit(
  p_key text,
  p_max_tokens integer,
  p_refill_interval_seconds integer,
  p_cost integer DEFAULT 1
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_tokens integer;
  v_last_refill timestamp with time zone;
  v_elapsed_seconds numeric;
  v_refill_tokens integer;
BEGIN
  -- Ensure row exists
  INSERT INTO public.durable_rate_limits (key, tokens, last_refill_at)
  VALUES (p_key, p_max_tokens, v_now)
  ON CONFLICT (key) DO NOTHING;

  -- Atomic row lock
  SELECT tokens, last_refill_at
  INTO v_tokens, v_last_refill
  FROM public.durable_rate_limits
  WHERE key = p_key
  FOR UPDATE;

  -- Calculate tokens to refill based on elapsed time
  v_elapsed_seconds := EXTRACT(EPOCH FROM (v_now - v_last_refill));
  IF v_elapsed_seconds > 0 AND p_refill_interval_seconds > 0 THEN
    v_refill_tokens := FLOOR((v_elapsed_seconds / p_refill_interval_seconds) * p_max_tokens);
    IF v_refill_tokens > 0 THEN
      v_tokens := LEAST(p_max_tokens, v_tokens + v_refill_tokens);
      v_last_refill := v_now;
    END IF;
  END IF;

  -- Evaluate token availability
  IF v_tokens >= p_cost THEN
    v_tokens := v_tokens - p_cost;
    UPDATE public.durable_rate_limits
    SET tokens = v_tokens,
        last_refill_at = v_last_refill
    WHERE key = p_key;

    RETURN QUERY SELECT true, v_tokens, 0;
  ELSE
    DECLARE
      v_needed integer := p_cost - v_tokens;
      v_retry_after integer;
    BEGIN
      v_retry_after := CEIL((v_needed::numeric / p_max_tokens) * p_refill_interval_seconds);
      IF v_retry_after < 1 THEN v_retry_after := 1; END IF;
      RETURN QUERY SELECT false, v_tokens, v_retry_after;
    END;
  END IF;
END;
$$;

-- Periodic cleanup routine for stale rate limit keys
CREATE OR REPLACE FUNCTION public.purge_expired_rate_limits(p_older_than_seconds integer DEFAULT 86400)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.durable_rate_limits
  WHERE last_refill_at < clock_timestamp() - (p_older_than_seconds || ' seconds')::interval;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_durable_rate_limit(text, integer, integer, integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_durable_rate_limit(text, integer, integer, integer) TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.purge_expired_rate_limits(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits(integer) TO service_role, postgres;
