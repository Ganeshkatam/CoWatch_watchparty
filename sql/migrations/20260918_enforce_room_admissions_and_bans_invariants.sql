-- Migration: 20260918_enforce_room_admissions_and_bans_invariants.sql
-- Description: Phase 6A schema hardening - add referential integrity foreign keys
-- and domain check constraints to room_admissions and room_bans.

-- 1. room_admissions: Enforce referential integrity on room_id
ALTER TABLE public.room_admissions
  ADD CONSTRAINT room_admissions_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES public.rooms("roomId")
  ON DELETE CASCADE;

-- 2. room_admissions: Enforce referential integrity on user_id
ALTER TABLE public.room_admissions
  ADD CONSTRAINT room_admissions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE CASCADE;

-- 3. room_admissions: Enforce valid admission method domain values
ALTER TABLE public.room_admissions
  ADD CONSTRAINT room_admissions_admission_method_check
  CHECK (admission_method IN ('passcode', 'invite', 'host'));

-- 4. room_bans: Enforce referential integrity on optional user_id
ALTER TABLE public.room_bans
  ADD CONSTRAINT room_bans_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE SET NULL;
