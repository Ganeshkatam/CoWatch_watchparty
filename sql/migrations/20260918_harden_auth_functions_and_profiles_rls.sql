-- Migration: 20260918_harden_auth_functions_and_profiles_rls.sql
-- Description: Sets explicit safe search_path on generate_unique_username and handle_new_user,
-- revokes public execution on generate_unique_username, and removes redundant profiles SELECT policy.

-- 1. Harden search_path on both security definer functions
ALTER FUNCTION public.generate_unique_username(text, text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_temp;

-- 2. Revoke unintended public/anon/authenticated execution on generate_unique_username
REVOKE EXECUTE ON FUNCTION public.generate_unique_username(text, text)
  FROM PUBLIC, anon, authenticated;

-- Explicitly ensure postgres and service_role retain execution privileges
GRANT EXECUTE ON FUNCTION public.generate_unique_username(text, text)
  TO postgres, service_role;

-- 3. Remove redundant own-profile SELECT policy (covered by "Profiles are viewable by everyone")
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
