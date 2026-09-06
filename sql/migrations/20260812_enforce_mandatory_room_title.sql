UPDATE public.room
SET "roomTitle" = 'Watch Party Room'
WHERE "roomTitle" IS NULL
   OR btrim("roomTitle") = '';

ALTER TABLE public.room
ALTER COLUMN "roomTitle" SET NOT NULL;

ALTER TABLE public.room
ADD CONSTRAINT room_title_not_empty
CHECK (btrim("roomTitle") <> '');
