-- SEC-001B: Data Access Authorization & Least Privilege Hardening
-- Invariants:
-- 1. Server-Only operational tables have 0 table privileges granted to anon, authenticated, or PUBLIC.
-- 2. Client-Scoped tables have strictly needed privileges and granular RLS policies.
-- 3. Default privileges for future tables in public schema are locked down.

-- Phase 1: Default Privilege Hardening for Future Tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated, PUBLIC;

-- Phase 2: Revoke All Privileges on Server-Only Tables
REVOKE ALL ON TABLE public.room_bans FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.room_lifecycle_events FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.room_quota_events FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.vbrowser FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.vbrowser_reservations FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.vbrowser_providers FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.vbrowser_pools FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.active_user FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.room_messages FROM anon, authenticated, PUBLIC;

-- Phase 3: Enforce RLS on All Tables (Idempotent)
ALTER TABLE public.room_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_quota_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Phase 4: Explicit Least-Privilege Grants on Client-Scoped Tables
-- Clean existing grants first
REVOKE ALL ON TABLE public.rooms FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.feedback FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.account_room_limits FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.account_room_usage FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.announcements FROM anon, authenticated, PUBLIC;

-- Apply explicit client grants
GRANT SELECT ON TABLE public.rooms TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.feedback TO anon, authenticated;
GRANT SELECT ON TABLE public.account_room_limits TO authenticated;
GRANT SELECT ON TABLE public.account_room_usage TO authenticated;
GRANT SELECT ON TABLE public.announcements TO anon, authenticated;
