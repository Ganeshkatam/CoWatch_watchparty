-- ============================================================================
-- NOTIFY-004: Delivery Profiles & Dispatch Safety Boundary
--
-- Decouples domain notification semantics from email vendor identities.
-- Persists canonical delivery_profile on public.email_outbox.
-- Adds dispatch_started_at to distinguish in-flight provider dispatches from
-- pre-dispatch queue claims, enforcing safe crash-recovery semantics.
-- ============================================================================

-- 1. Add delivery_profile and dispatch_started_at columns
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS delivery_profile VARCHAR(50) NOT NULL DEFAULT 'transactional_default',
  ADD COLUMN IF NOT EXISTS dispatch_started_at TIMESTAMP WITH TIME ZONE;

-- 2. Backfill existing rows from template_key
UPDATE public.email_outbox
SET delivery_profile = 'transactional_invitation'
WHERE template_key IN ('ROOM_INVITATION', 'room-invitation', 'ROOM_STARTED', 'room-started');

UPDATE public.email_outbox
SET delivery_profile = 'transactional_security'
WHERE template_key IN ('MODERATION_ACTION', 'moderation-action', 'VBROWSER_FAILURE', 'vbrowser-failure');

UPDATE public.email_outbox
SET delivery_profile = 'transactional_system'
WHERE template_key IN ('SYSTEM_ANNOUNCEMENT', 'system-announcement');

-- 3. Composite index for profile queue depth, worker polling and telemetry
CREATE INDEX IF NOT EXISTS idx_email_outbox_profile_status
  ON public.email_outbox (delivery_profile, status);
