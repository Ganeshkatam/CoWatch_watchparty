-- Migration: PUB-SURF-001 (Trust & Safety Abuse Reporting Architecture)
-- Defines public.abuse_reports table for server-authoritative abuse intake.
-- Direct client access is strictly disallowed under RLS.

CREATE TABLE IF NOT EXISTS public.abuse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_room_id text,
  category text NOT NULL,
  reason text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT abuse_reports_target_check CHECK (target_user_id IS NOT NULL OR target_room_id IS NOT NULL),
  CONSTRAINT abuse_reports_no_self_report CHECK (reporter_user_id <> target_user_id),
  CONSTRAINT abuse_reports_status_check CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed')),
  CONSTRAINT abuse_reports_category_check CHECK (category IN ('harassment', 'spam', 'hate_speech', 'inappropriate_content', 'copyright', 'other'))
);

-- Optimization & triage indexes
CREATE INDEX IF NOT EXISTS idx_abuse_reports_reporter 
  ON public.abuse_reports(reporter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_target_user 
  ON public.abuse_reports(target_user_id) 
  WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abuse_reports_target_room 
  ON public.abuse_reports(target_room_id) 
  WHERE target_room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abuse_reports_status 
  ON public.abuse_reports(status, created_at DESC);

-- Lock table under Row Level Security.
-- No client-facing policies (SELECT, INSERT, UPDATE, DELETE) are granted to anon or authenticated roles.
-- Writes and audits are handled strictly through the server-authoritative service role.
ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;
