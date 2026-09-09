-- A deletion writes a final lifecycle event before removing its room. The
-- previous RESTRICT relationship made that final DELETE fail.
ALTER TABLE public.room_lifecycle_events
DROP CONSTRAINT IF EXISTS room_lifecycle_events_room_fk;

ALTER TABLE public.room_lifecycle_events
ADD CONSTRAINT room_lifecycle_events_room_fk
FOREIGN KEY ("roomId")
REFERENCES public.rooms("roomId")
ON DELETE CASCADE;
