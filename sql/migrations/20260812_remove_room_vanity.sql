-- Remove the vanity column and its unique index from the room table.
-- Note: This is a destructive operation that will break existing custom URLs (e.g. /r/vanity-name).
-- It aligns with the removal of the vanity feature from the application.

ALTER TABLE public.room DROP COLUMN IF EXISTS vanity CASCADE;
