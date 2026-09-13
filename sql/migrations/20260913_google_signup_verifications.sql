-- ============================================================================
-- Migration: 20260913_google_signup_verifications.sql
-- Description: Creates server-only public.google_signup_verifications table
--              with hardened RLS and explicit deny policy to manage mandatory
--              email confirmation for Google OAuth signups.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.google_signup_verifications (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  last_sent_at timestamp with time zone NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.google_signup_verifications IS 'Server-only authoritative verification records and token hashes for Google OAuth signups.';
COMMENT ON COLUMN public.google_signup_verifications.user_id IS 'Unique user ID linked to auth.users.';
COMMENT ON COLUMN public.google_signup_verifications.token_hash IS 'SHA-256 hash of the cryptographically random confirmation token.';
COMMENT ON COLUMN public.google_signup_verifications.expires_at IS 'Timestamp when the token expires (24h).';
COMMENT ON COLUMN public.google_signup_verifications.consumed_at IS 'Timestamp when the token was atomically consumed.';
COMMENT ON COLUMN public.google_signup_verifications.confirmed_at IS 'Timestamp when the Google account was verified.';
COMMENT ON COLUMN public.google_signup_verifications.last_sent_at IS 'Timestamp of the most recent email dispatch for cooldown enforcement.';
COMMENT ON COLUMN public.google_signup_verifications.send_count IS 'Number of confirmation emails dispatched to this user.';
COMMENT ON COLUMN public.google_signup_verifications.created_at IS 'Timestamp when the verification requirement was initialized.';

CREATE INDEX IF NOT EXISTS idx_google_signup_verifications_token_hash
  ON public.google_signup_verifications USING btree (token_hash);

REVOKE ALL ON TABLE public.google_signup_verifications FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE public.google_signup_verifications TO service_role;

ALTER TABLE public.google_signup_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_signup_verifications_deny_client_access" ON public.google_signup_verifications;
CREATE POLICY "google_signup_verifications_deny_client_access"
  ON public.google_signup_verifications FOR ALL TO public
  USING (false) WITH CHECK (false);
