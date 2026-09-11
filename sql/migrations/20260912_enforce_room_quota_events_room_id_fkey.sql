-- Migration: Enforce foreign key reference on room_quota_events.room_id -> public.rooms("roomId")
-- Nullable with ON DELETE SET NULL to preserve immutable audit trail for deleted/rejected rooms.

BEGIN;

-- 1. Make room_id nullable to allow rejected and deleted room audit records
ALTER TABLE public.room_quota_events ALTER COLUMN room_id DROP NOT NULL;

-- 2. Preserve orphaned room identifiers in metadata for historical records
UPDATE public.room_quota_events q
SET metadata = q.metadata || jsonb_build_object('room_id', q.room_id),
    room_id = NULL
WHERE q.room_id IS NOT NULL 
  AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r."roomId" = q.room_id);

-- 3. Add foreign key constraint to public.rooms("roomId")
ALTER TABLE public.room_quota_events
ADD CONSTRAINT room_quota_events_room_id_fkey
FOREIGN KEY (room_id)
REFERENCES public.rooms("roomId")
ON DELETE SET NULL;

-- 4. Create foreign key index for efficient join and cascade lookups
CREATE INDEX IF NOT EXISTS idx_room_quota_events_room_id ON public.room_quota_events(room_id);

COMMIT;
