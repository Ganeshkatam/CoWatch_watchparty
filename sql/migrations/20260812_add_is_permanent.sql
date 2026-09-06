ALTER TABLE public.room ADD COLUMN "isPermanent" boolean NOT NULL DEFAULT false;
UPDATE public.room SET "isPermanent" = true WHERE "expiresAt" IS NULL;
