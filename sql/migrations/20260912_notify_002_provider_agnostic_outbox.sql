-- ============================================================================
-- NOTIFY-002: Provider-Agnostic Transactional Email Architecture
--
-- Adds provider tracking and composite uniqueness constraint to email_outbox.
-- Ensures CoWatch core remains completely decoupled from third-party vendors.
-- ============================================================================

-- 1. Add provider and provider_metadata columns to email_outbox
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50) NOT NULL DEFAULT 'smtp',
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Backfill provider from existing provider_message_id if needed
UPDATE public.email_outbox
SET provider = 'resend'
WHERE provider_message_id IS NOT NULL AND provider = 'smtp';

-- 3. Enforce composite uniqueness on (provider, provider_message_id)
-- Note: Rows with NULL provider_message_id (pending/unsubmitted) are excluded
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_outbox_provider_composite
  ON public.email_outbox (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
