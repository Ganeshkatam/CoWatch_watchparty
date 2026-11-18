-- Secure server-managed room data.
-- The app reads and writes these tables exclusively through its server-side
-- PostgreSQL connection. With no anon/authenticated policies, browser clients
-- cannot enumerate or mutate chat messages or lifecycle audit records.

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_lifecycle_events ENABLE ROW LEVEL SECURITY;
