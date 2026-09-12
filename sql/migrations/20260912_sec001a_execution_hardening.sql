-- SEC-001A: Database Execution & Extension Hardening
-- Invariants:
-- 1. Client roles (anon, authenticated, PUBLIC) have zero REST/RPC execution access to internal trigger functions.
-- 2. Search paths on trigger and helper functions are immutable to prevent search-path hijacking.
-- 3. Extensions reside in the dedicated 'extensions' schema rather than 'public'.

-- 1. Function Execution Lockdown
REVOKE EXECUTE ON FUNCTION public.check_user_email_domain() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_unconfirmed_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2. Immutable Search Paths
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.delete_unconfirmed_users() SET search_path = public, auth;
ALTER FUNCTION public.check_user_email_domain() SET search_path = public, auth;
ALTER FUNCTION public.handle_new_user() SET search_path = public, auth;

-- 3. Extension Relocation Safeguard (pg_trgm)
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
