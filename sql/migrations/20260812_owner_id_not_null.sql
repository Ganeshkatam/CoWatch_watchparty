-- Backfill any rooms with NULL owner_id (legacy guest rooms)
-- Uses a sentinel UUID so the NOT NULL constraint can be applied.
UPDATE public.room
SET owner_id = '00000000-0000-0000-0000-000000000000'
WHERE owner_id IS NULL;

-- Make owner_id mandatory
ALTER TABLE public.room ALTER COLUMN owner_id SET NOT NULL;

-- Replace the partial index with a full index since owner_id is never null
DROP INDEX IF EXISTS room_owner_id_idx;
CREATE INDEX room_owner_id_idx ON room(owner_id);
