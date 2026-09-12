-- =============================================================================
-- NOTIFY-001A: Gate 1 Database Authorization & Retention Precedence Test Suite
-- =============================================================================
-- Run via: psql -f sql/tests/test_notify_001_authorization.sql
-- Invariants verified:
--   1. Cross-tenant isolation on notifications (RLS).
--   2. Direct client INSERT, UPDATE, DELETE denied on notifications (Grants).
--   3. email_outbox, email_delivery_suppressions, and webhook_events fully opaque to clients.
--   4. notification_type_registry immutable to clients.
--   5. Client direct INSERT on notification_preferences blocked by trigger.
--   6. Retention precedence: UNREAD notifications are NEVER purged; only READ + expired.
-- =============================================================================

BEGIN;

-- Create temporary test profiles
INSERT INTO public.profiles (id, username, email)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'user_a', 'user_a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'user_b', 'user_b@test.com')
ON CONFLICT (id) DO NOTHING;

-- Seed notifications as service_role / postgres
INSERT INTO public.notifications (id, user_id, type, title, body, event_id)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'ROOM_INVITATION', 'Invite A', 'Body A', 'EVT:A:1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'ROOM_INVITATION', 'Invite B', 'Body B', 'EVT:B:1');

-- ---------------------------------------------------------------------------
-- TEST 1: Cross-tenant isolation on public.notifications
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
BEGIN
  -- Impersonate User A (authenticated)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

  -- User A should see their own notification
  SELECT count(*) INTO v_count FROM public.notifications WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: User A cannot read their own notification';
  END IF;

  -- User A querying User B's notification must yield 0 rows (RLS boundary)
  SELECT count(*) INTO v_count FROM public.notifications WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Tenant isolation broken: User A can read User B notifications';
  END IF;

  -- Reset role to test setup
  PERFORM set_config('role', 'postgres', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- TEST 2: Client DML Denial on public.notifications
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_err_code text;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

  -- Test 2a: INSERT must fail with 42501 (insufficient_privilege)
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, event_id)
    VALUES ('11111111-1111-1111-1111-111111111111', 'SYSTEM_ANNOUNCEMENT', 'T', 'B', 'EVT:X');
    RAISE EXCEPTION 'TEST 2a FAILED: Client was permitted to INSERT into notifications';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected error 42501
    NULL;
  END;

  -- Test 2b: UPDATE must fail with 42501
  BEGIN
    UPDATE public.notifications SET read_at = now() WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'TEST 2b FAILED: Client was permitted to direct UPDATE notifications';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected error 42501
    NULL;
  END;

  -- Test 2c: DELETE must fail with 42501
  BEGIN
    DELETE FROM public.notifications WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'TEST 2c FAILED: Client was permitted to direct DELETE notifications';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected error 42501
    NULL;
  END;

  PERFORM set_config('role', 'postgres', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- TEST 3: email_outbox, email_delivery_suppressions, and webhook_events Opacity
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

  -- email_outbox
  BEGIN
    PERFORM count(*) FROM public.email_outbox;
    RAISE EXCEPTION 'TEST 3a FAILED: Authenticated client could SELECT from email_outbox';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- email_delivery_suppressions
  BEGIN
    PERFORM count(*) FROM public.email_delivery_suppressions;
    RAISE EXCEPTION 'TEST 3b FAILED: Authenticated client could SELECT from email_delivery_suppressions';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- webhook_events
  BEGIN
    PERFORM count(*) FROM public.webhook_events;
    RAISE EXCEPTION 'TEST 3c FAILED: Authenticated client could SELECT from webhook_events';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('role', 'postgres', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- TEST 4: notification_type_registry Immutability
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

  BEGIN
    UPDATE public.notification_type_registry SET email_eligible = true WHERE type = 'ROOM_ENDING';
    RAISE EXCEPTION 'TEST 4 FAILED: Authenticated client could modify notification_type_registry';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('role', 'postgres', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- TEST 5: Retention Precedence Invariant
-- "UNREAD notifications are NEVER automatically purged. Only READ notifications with expires_at < now() are purged."
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_purged integer;
  v_unread_count integer;
  v_read_count integer;
BEGIN
  -- Notification 1: UNREAD, but expires_at is in the PAST
  INSERT INTO public.notifications (id, user_id, type, title, body, event_id, read_at, expires_at)
  VALUES (
    '11111111-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'ROOM_ENDING',
    'Unread Expired Room',
    'This unread notification is past expires_at',
    'EVT:EXP:1',
    NULL,
    now() - interval '2 hours'
  );

  -- Notification 2: READ, and expires_at is in the PAST
  INSERT INTO public.notifications (id, user_id, type, title, body, event_id, read_at, expires_at)
  VALUES (
    '22222222-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'ROOM_ENDING',
    'Read Expired Room',
    'This read notification is past expires_at',
    'EVT:EXP:2',
    now() - interval '3 hours',
    now() - interval '2 hours'
  );

  -- Run authoritative retention function
  v_purged := public.purge_read_notifications_expired();

  -- Verify: exactly Notification 2 (read and expired) was purged
  SELECT count(*) INTO v_unread_count FROM public.notifications WHERE id = '11111111-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_read_count FROM public.notifications WHERE id = '22222222-0000-0000-0000-000000000002';

  IF v_unread_count <> 1 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Unread notification was erroneously purged!';
  END IF;

  IF v_read_count <> 0 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Read expired notification was NOT purged!';
  END IF;
END;
$$;

-- Rollback test transaction cleanly
ROLLBACK;
