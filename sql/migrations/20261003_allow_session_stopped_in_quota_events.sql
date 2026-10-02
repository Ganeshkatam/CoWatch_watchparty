-- Migration: Allow SESSION_STOPPED in room_quota_events_event_type_check constraint
--
-- Context:
--   Migration 20260917_permanent_room_session_stop.sql updated end_room_authoritative
--   to log 'SESSION_STOPPED' in room_quota_events when a host concludes a permanent room
--   session. However, room_quota_events_event_type_check was missing 'SESSION_STOPPED',
--   causing end_room_authoritative to abort with check constraint violation (23514),
--   which resulted in /endRoom returning a 403 Forbidden error to the client.
--
-- Safety:
--   Non-destructive constraint widening to include 'SESSION_STOPPED'.

ALTER TABLE public.room_quota_events
  DROP CONSTRAINT IF EXISTS room_quota_events_event_type_check,
  ADD CONSTRAINT room_quota_events_event_type_check
    CHECK (event_type = ANY (ARRAY[
      'CREATED'::text,
      'DELETED'::text,
      'EXPIRED'::text,
      'ENDED'::text,
      'SESSION_STOPPED'::text,
      'PERMANENCE_CHANGED'::text,
      'REJECTED'::text,
      'PURGED'::text
    ]));
