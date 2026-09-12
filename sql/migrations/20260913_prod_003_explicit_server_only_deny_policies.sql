-- PROD-003 Gate 2: Explicit Declarative Deny Policies on Server-Only Tables
-- Enforces explicit defense-in-depth on all 15 server-only tables in public schema.
-- Closes Supabase Database Linter warning (RLS Enabled No Policy) without granting any client permissions.

CREATE POLICY "abuse_reports_deny_client_access"
  ON public.abuse_reports FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "active_user_deny_client_access"
  ON public.active_user FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "durable_rate_limits_deny_client_access"
  ON public.durable_rate_limits FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "email_delivery_suppressions_deny_client_access"
  ON public.email_delivery_suppressions FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "email_outbox_deny_client_access"
  ON public.email_outbox FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "room_bans_deny_client_access"
  ON public.room_bans FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "room_lifecycle_events_deny_client_access"
  ON public.room_lifecycle_events FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "room_media_sessions_deny_client_access"
  ON public.room_media_sessions FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "room_messages_deny_client_access"
  ON public.room_messages FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "room_quota_events_deny_client_access"
  ON public.room_quota_events FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "vbrowser_deny_client_access"
  ON public.vbrowser FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "vbrowser_pools_deny_client_access"
  ON public.vbrowser_pools FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "vbrowser_providers_deny_client_access"
  ON public.vbrowser_providers FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "vbrowser_reservations_deny_client_access"
  ON public.vbrowser_reservations FOR ALL TO public
  USING (false) WITH CHECK (false);

CREATE POLICY "webhook_events_deny_client_access"
  ON public.webhook_events FOR ALL TO public
  USING (false) WITH CHECK (false);
