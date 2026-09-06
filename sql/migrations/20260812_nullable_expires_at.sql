ALTER TABLE public.room ALTER COLUMN "expiresAt" DROP NOT NULL;
UPDATE public.room SET "expiresAt" = NULL WHERE owner_id IS NOT NULL;
