-- Migration: 20260918_create_public_profiles_projection_and_restrict_profiles_rls.sql
-- Description: Establishes a public projection view (public.public_profiles) exposing strictly
-- public identity columns (id, username, display_name, avatar_url) and restricts direct table
-- access on public.profiles to authenticated owner-only reads.

-- 1. Create public identity projection view
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
SELECT
  id,
  username,
  display_name,
  avatar_url
FROM public.profiles;

-- 2. Grant SELECT privileges on the projection view
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- 3. Restrict direct SELECT on public.profiles to authenticated owner-only
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);
