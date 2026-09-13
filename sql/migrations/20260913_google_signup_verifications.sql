-- ============================================================================
-- Migration: 20260913_google_signup_verifications.sql
-- Description: Drops public.google_signup_verifications table in alignment with
--              Model A Pure Supabase-Native authentication architecture.
-- ============================================================================

DROP TABLE IF EXISTS public.google_signup_verifications CASCADE;

