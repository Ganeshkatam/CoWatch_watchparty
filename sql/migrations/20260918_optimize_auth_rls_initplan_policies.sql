-- Migration: 20260918_optimize_auth_rls_initplan_policies.sql
-- Description: Phase 3 database hardening - optimize RLS policies to evaluate auth.uid()
-- via InitPlan scalar subqueries ((select auth.uid())) instead of per-row evaluation.
-- Preserves all existing authorization semantics, commands, roles, and checks.

-- 1. account_room_limits
DROP POLICY IF EXISTS "Users view own account limits" ON public.account_room_limits;
CREATE POLICY "Users view own account limits"
  ON public.account_room_limits
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = account_id);

-- 2. account_room_usage
DROP POLICY IF EXISTS "Users view own room usage" ON public.account_room_usage;
CREATE POLICY "Users view own room usage"
  ON public.account_room_usage
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = account_id);

-- 3. feedback (INSERT)
DROP POLICY IF EXISTS "feedback_insert_hardened" ON public.feedback;
CREATE POLICY "feedback_insert_hardened"
  ON public.feedback
  FOR INSERT
  TO public
  WITH CHECK (
    (user_id IS NULL)
    OR (
      ((select auth.uid()) IS NOT NULL)
      AND (user_id = (select auth.uid()))
    )
  );

-- 4. feedback (SELECT)
DROP POLICY IF EXISTS "feedback_select_owner_only" ON public.feedback;
CREATE POLICY "feedback_select_owner_only"
  ON public.feedback
  FOR SELECT
  TO public
  USING (
    ((select auth.uid()) IS NOT NULL)
    AND (user_id = (select auth.uid()))
  );

-- 5. notification_preferences (SELECT)
DROP POLICY IF EXISTS "Users select own preferences" ON public.notification_preferences;
CREATE POLICY "Users select own preferences"
  ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- 6. notification_preferences (UPDATE)
DROP POLICY IF EXISTS "Users update own preferences" ON public.notification_preferences;
CREATE POLICY "Users update own preferences"
  ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- 7. notifications (SELECT)
DROP POLICY IF EXISTS "Users select own notifications" ON public.notifications;
CREATE POLICY "Users select own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- 8. profiles (INSERT)
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- 9. profiles (UPDATE)
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- 10. room_admissions (SELECT)
DROP POLICY IF EXISTS "Users can read their own room admissions" ON public.room_admissions;
CREATE POLICY "Users can read their own room admissions"
  ON public.room_admissions
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- 11. room_invitations (SELECT)
DROP POLICY IF EXISTS "Users can view their targeted or created invitations" ON public.room_invitations;
CREATE POLICY "Users can view their targeted or created invitations"
  ON public.room_invitations
  FOR SELECT
  TO authenticated
  USING (
    ((select auth.uid()) = inviter_id)
    OR
    ((select auth.uid()) = target_user_id)
  );

-- 12. rooms (SELECT)
DROP POLICY IF EXISTS "Users can view their own rooms" ON public.rooms;
CREATE POLICY "Users can view their own rooms"
  ON public.rooms
  FOR SELECT
  TO public
  USING ((select auth.uid()) = owner_id);
