-- =============================================================================
-- NOTIFY-001A: Production Delivery & Security Certification
-- Deliverability Suppression, Webhook Idempotency, Delivery Tracking, Retention
-- =============================================================================
-- Invariants enforced:
--   1. email_delivery_suppressions stores SHA-256 email_hash only (no plaintext email).
--   2. webhook_events enforces UNIQUE(provider, event_id) and stores minimal metadata.
--   3. email_outbox indexes provider_message_id and routes deliveries strictly through it.
--   4. provider_delivery_status constrained to SENT, DELIVERED, DELIVERY_DELAYED, BOUNCED, COMPLAINED.
--   5. UNREAD notifications are NEVER automatically purged; only READ notifications with
--      expires_at < now() are purged.
--   6. All new tables and functions are server-only (zero client access).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SECTION 1: email_delivery_suppressions (Zero Plaintext Email)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_delivery_suppressions (
  email_hash       text PRIMARY KEY,
  reason           text NOT NULL CHECK (reason IN ('bounced', 'complained', 'manual')),
  source           text NOT NULL,
  created_at       timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_delivery_suppressions IS
  'Cryptographic hash index of suppressed email addresses (bounces/complaints). '
  'Contains zero plaintext email addresses to strictly preserve privacy and security.';

REVOKE ALL ON TABLE public.email_delivery_suppressions FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_delivery_suppressions TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- SECTION 2: webhook_events (Minimal Metadata & Idempotency)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL,
  event_id         text NOT NULL,
  event_type       text NOT NULL,
  received_at      timestamp with time zone NOT NULL DEFAULT now(),
  processed_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_provider_event_id_key UNIQUE(provider, event_id)
);

COMMENT ON TABLE public.webhook_events IS
  'Audit log and deduplication registry for provider webhooks. '
  'Stores event metadata without raw payload bodies to prevent sensitive data leakage.';

REVOKE ALL ON TABLE public.webhook_events FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_events TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- SECTION 3: email_outbox Schema Updates
-- ---------------------------------------------------------------------------

-- Add delivery status enum check
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS provider_delivery_status text
    CHECK (provider_delivery_status IN ('SENT', 'DELIVERED', 'DELIVERY_DELAYED', 'BOUNCED', 'COMPLAINED'));

-- Add terminal event timestamps
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS bounced_at timestamp with time zone;

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS complained_at timestamp with time zone;

-- Add worker lease locks for horizontal safety
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS locked_at timestamp with time zone;

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS locked_by text;

-- Index on provider_message_id for webhook matching
CREATE INDEX IF NOT EXISTS idx_email_outbox_provider_message_id
  ON public.email_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SECTION 4: Immutability on notification_type_registry
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.notification_type_registry FROM anon, authenticated, PUBLIC;

-- ---------------------------------------------------------------------------
-- SECTION 5: Authoritative Retention Functions
-- ---------------------------------------------------------------------------

-- Purge read notifications where expires_at < now()
-- Invariant: UNREAD notifications are NEVER purged.
CREATE OR REPLACE FUNCTION public.purge_read_notifications_expired()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_read_notifications_expired IS
  'Purges only READ notifications that have exceeded their expires_at TTL. '
  'UNREAD notifications are never removed by this function.';

-- Purge SENT outbox jobs past retention days
CREATE OR REPLACE FUNCTION public.purge_sent_email_outbox(p_retention_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.email_outbox
  WHERE status = 'SENT'
    AND updated_at < now() - (p_retention_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Purge FAILED outbox jobs past retention days
CREATE OR REPLACE FUNCTION public.purge_failed_email_outbox(p_retention_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.email_outbox
  WHERE status = 'FAILED'
    AND updated_at < now() - (p_retention_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Revoke execute from clients, grant to postgres and service_role
REVOKE EXECUTE ON FUNCTION public.purge_read_notifications_expired() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_read_notifications_expired() TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.purge_sent_email_outbox(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_sent_email_outbox(integer) TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.purge_failed_email_outbox(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_failed_email_outbox(integer) TO postgres, service_role;
