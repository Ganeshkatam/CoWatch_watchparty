-- Migration: Widen rooms.max_participants upper bound from 10 to 500.
--
-- Context:
--   subscription_plans.max_participant_capacity already supports 2–500 per its own
--   CHECK constraint. The rooms table was capping at 10, which is the free plan's
--   entitlement ceiling, not the platform maximum. This inconsistency made dynamic
--   entitlement loading inert for any plan allowing capacity > 10.
--
-- Safety:
--   All existing rows have max_participants = 10, which satisfies >= 2 AND <= 500.
--   This is a forward-only, non-destructive constraint widening. No data migration needed.
--
-- Constants:
--   DOMAIN PLATFORM MAX  = 500  (this constraint)
--   FREE PLAN MAX        = 10   (subscription_plans entitlement — unchanged)
--   UI CURRENT USER      = resolve_account_entitlement().max_participant_capacity

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_max_participants_check,
  ADD CONSTRAINT rooms_max_participants_check
    CHECK (max_participants >= 2 AND max_participants <= 500);
