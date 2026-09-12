-- =============================================================================
-- NOTIFY-003B: Room Lifecycle Ending Soon & Action Metadata
-- =============================================================================

-- Add endingNotifiedAt marker to public.rooms for atomic 15-minute expiration claim
ALTER TABLE public.rooms 
  ADD COLUMN IF NOT EXISTS "endingNotifiedAt" timestamp with time zone DEFAULT NULL;

COMMENT ON COLUMN public.rooms."endingNotifiedAt" IS
  'Timestamp when the 15-minute advance expiration notice was claimed and dispatched.';

-- Partial index for high-efficiency scanning by the background ticker
CREATE INDEX IF NOT EXISTS idx_rooms_ending_soon 
  ON public.rooms("expiresAt") 
  WHERE status = 'active' AND "isPermanent" = false AND "endingNotifiedAt" IS NULL;
