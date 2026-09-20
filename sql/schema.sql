-- ============================================================================
-- CoWatch WatchParty: Authoritative Production Database Schema
-- Standalone Cold-Boot Bootstrap Schema
-- Snapshot Date: September 2026
-- Catalog Parity: 100% synchronized with live production database
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------
-- 2.1 Table: public.subscription_plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text NOT NULL,
  display_name text NOT NULL,
  description text,
  is_default boolean DEFAULT false NOT NULL,
  max_total_rooms integer NOT NULL,
  max_watch_rooms integer NOT NULL,
  max_permanent_rooms integer NOT NULL,
  max_participant_capacity integer NOT NULL,
  max_room_duration_hours integer DEFAULT 24 NOT NULL,
  is_vbrowser_allowed boolean DEFAULT false NOT NULL,
  max_vbrowser_concurrency integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT check_permanent_lte_total CHECK (max_permanent_rooms <= max_total_rooms),
  CONSTRAINT check_vbrowser_concurrency_allowed CHECK (is_vbrowser_allowed OR max_vbrowser_concurrency = 0),
  CONSTRAINT check_watch_lte_total CHECK (max_watch_rooms <= max_total_rooms),
  CONSTRAINT subscription_plans_id_check CHECK (length(id) > 0 AND id ~ '^[a-z0-9_-]+$'::text),
  CONSTRAINT subscription_plans_max_participant_capacity_check CHECK (max_participant_capacity >= 2 AND max_participant_capacity <= 500),
  CONSTRAINT subscription_plans_max_permanent_rooms_check CHECK (max_permanent_rooms >= 0),
  CONSTRAINT subscription_plans_max_room_duration_hours_check CHECK (max_room_duration_hours >= 1 AND max_room_duration_hours <= 720),
  CONSTRAINT subscription_plans_max_total_rooms_check CHECK (max_total_rooms >= 0),
  CONSTRAINT subscription_plans_max_vbrowser_concurrency_check CHECK (max_vbrowser_concurrency >= 0),
  CONSTRAINT subscription_plans_max_watch_rooms_check CHECK (max_watch_rooms >= 0),
  CONSTRAINT subscription_plans_pkey PRIMARY KEY (id)
);

-- 2.2 Table: public.profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  username text,
  avatar_url text,
  pref_show_chat_column boolean DEFAULT true NOT NULL,
  pref_show_people_column boolean DEFAULT false NOT NULL,
  pref_disable_chat_sound boolean DEFAULT false NOT NULL,
  display_name text,
  pref_camera_on boolean DEFAULT false NOT NULL,
  pref_mic_on boolean DEFAULT false NOT NULL,
  pref_appearance_mode text DEFAULT 'system'::text NOT NULL,
  terms_agreed_at timestamptz,
  age_verified_at timestamptz,
  CONSTRAINT profiles_display_name_length CHECK (display_name IS NULL OR char_length(display_name) >= 1 AND char_length(display_name) <= 50),
  CONSTRAINT profiles_pref_appearance_mode_check CHECK (pref_appearance_mode = ANY (ARRAY['light'::text, 'mantine'::text, 'system'::text])),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

-- 2.3 Table: public.account_room_limits
CREATE TABLE IF NOT EXISTS public.account_room_limits (
  account_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  plan_id text NOT NULL,
  override_total_rooms integer,
  override_watch_rooms integer,
  override_permanent_rooms integer,
  override_participant_capacity integer,
  override_room_duration_hours integer,
  override_vbrowser_allowed boolean,
  override_vbrowser_concurrency integer,
  CONSTRAINT account_room_limits_override_participant_capacity_check CHECK (override_participant_capacity IS NULL OR override_participant_capacity >= 2 AND override_participant_capacity <= 500),
  CONSTRAINT account_room_limits_override_permanent_rooms_check CHECK (override_permanent_rooms IS NULL OR override_permanent_rooms >= 0),
  CONSTRAINT account_room_limits_override_room_duration_hours_check CHECK (override_room_duration_hours IS NULL OR override_room_duration_hours >= 1 AND override_room_duration_hours <= 720),
  CONSTRAINT account_room_limits_override_total_rooms_check CHECK (override_total_rooms IS NULL OR override_total_rooms >= 0),
  CONSTRAINT account_room_limits_override_vbrowser_concurrency_check CHECK (override_vbrowser_concurrency IS NULL OR override_vbrowser_concurrency >= 0),
  CONSTRAINT account_room_limits_override_watch_rooms_check CHECK (override_watch_rooms IS NULL OR override_watch_rooms >= 0),
  CONSTRAINT check_override_permanent_lte_total CHECK (override_permanent_rooms IS NULL OR override_total_rooms IS NULL OR override_permanent_rooms <= override_total_rooms),
  CONSTRAINT check_override_watch_lte_total CHECK (override_watch_rooms IS NULL OR override_total_rooms IS NULL OR override_watch_rooms <= override_total_rooms),
  CONSTRAINT account_room_limits_account_id_fkey FOREIGN KEY (account_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT account_room_limits_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT account_room_limits_pkey PRIMARY KEY (account_id)
);

-- 2.4 Table: public.account_room_usage
CREATE TABLE IF NOT EXISTS public.account_room_usage (
  account_id uuid NOT NULL,
  total_rooms integer DEFAULT 0 NOT NULL,
  watch_rooms integer DEFAULT 0 NOT NULL,
  permanent_rooms integer DEFAULT 0 NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT account_room_usage_permanent_rooms_check CHECK (permanent_rooms >= 0),
  CONSTRAINT account_room_usage_total_rooms_check CHECK (total_rooms >= 0),
  CONSTRAINT account_room_usage_watch_rooms_check CHECK (watch_rooms >= 0),
  CONSTRAINT account_room_usage_account_id_fkey FOREIGN KEY (account_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT account_room_usage_pkey PRIMARY KEY (account_id)
);

-- 2.5 Table: public.rooms
CREATE TABLE IF NOT EXISTS public.rooms (
  "roomId" text NOT NULL,
  "creationTime" timestamptz,
  passcode text NOT NULL,
  owner_id uuid NOT NULL,
  "isChatDisabled" boolean DEFAULT false NOT NULL,
  "isSubRoom" boolean,
  data jsonb,
  "lastUpdateTime" timestamptz,
  "roomTitle" text NOT NULL,
  "roomDescription" text,
  "mediaPath" text,
  status text DEFAULT 'active'::text NOT NULL,
  "startedAt" timestamptz NOT NULL,
  "expiresAt" timestamptz,
  "endedAt" timestamptz,
  "isPermanent" boolean DEFAULT false NOT NULL,
  "coverPhoto" text,
  "lastActiveAt" timestamptz,
  owner_passcode text NOT NULL,
  "scheduledStartsAt" timestamptz,
  passcode_fingerprint text NOT NULL,
  room_kind text DEFAULT 'watch'::text NOT NULL,
  participants_locked boolean DEFAULT false NOT NULL,
  max_participants integer DEFAULT 10 NOT NULL,
  lifecycle_revision integer DEFAULT 1 NOT NULL,
  schema_version integer DEFAULT 1 NOT NULL,
  "endingNotifiedAt" timestamptz,
  CONSTRAINT room_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'active'::text, 'inactive'::text, 'ended'::text, 'expired'::text])),
  CONSTRAINT room_title_not_empty CHECK (btrim("roomTitle") <> ''::text),
  CONSTRAINT rooms_expiration_policy_check CHECK ("isPermanent" = true AND "expiresAt" IS NULL OR "isPermanent" = false AND "expiresAt" IS NOT NULL),
  CONSTRAINT rooms_kind_permanent_check CHECK (room_kind = 'permanent'::text AND "isPermanent" = true AND "expiresAt" IS NULL OR room_kind = 'watch'::text AND "isPermanent" = false AND "expiresAt" IS NOT NULL),
  CONSTRAINT rooms_max_participants_check CHECK (max_participants >= 2 AND max_participants <= 10),
  CONSTRAINT room_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT room_pkey PRIMARY KEY ("roomId"),
  CONSTRAINT rooms_passcode_fingerprint_key UNIQUE (passcode_fingerprint)
);

-- 2.6 Table: public.room_admissions
CREATE TABLE IF NOT EXISTS public.room_admissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  room_id text NOT NULL,
  user_id uuid NOT NULL,
  admission_method text DEFAULT 'passcode'::text NOT NULL,
  admitted_at timestamptz DEFAULT now() NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT room_admissions_admission_method_check CHECK (admission_method = ANY (ARRAY['passcode'::text, 'invite'::text, 'host'::text])),
  CONSTRAINT room_admissions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT room_admissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT room_admissions_pkey PRIMARY KEY (id),
  CONSTRAINT room_admissions_room_user_unique UNIQUE (room_id, user_id)
);

-- 2.7 Table: public.room_bans
CREATE TABLE IF NOT EXISTS public.room_bans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  room_id text NOT NULL,
  client_identity text NOT NULL,
  user_id uuid,
  banned_by text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT room_bans_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT room_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT room_bans_pkey PRIMARY KEY (id),
  CONSTRAINT room_bans_room_identity_unique UNIQUE (room_id, client_identity)
);

-- 2.8 Table: public.room_invitations
CREATE TABLE IF NOT EXISTS public.room_invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  room_id text NOT NULL,
  inviter_id uuid NOT NULL,
  target_user_id uuid,
  token_hash text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by_user_id uuid,
  is_reusable boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT room_invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT room_invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT room_invitations_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT room_invitations_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT room_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT room_invitations_token_hash_key UNIQUE (token_hash)
);

-- 2.9 Table: public.room_lifecycle_events
CREATE TABLE IF NOT EXISTS public.room_lifecycle_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  "roomId" text NOT NULL,
  actor text NOT NULL,
  event text NOT NULL,
  "previousStatus" text,
  "newStatus" text,
  "previousExpiresAt" timestamptz,
  "newExpiresAt" timestamptz,
  reason text,
  timestamp timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT room_lifecycle_events_room_fk FOREIGN KEY ("roomId") REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT room_lifecycle_events_pkey PRIMARY KEY (id)
);

-- 2.10 Table: public.room_media_sessions
CREATE TABLE IF NOT EXISTS public.room_media_sessions (
  media_id uuid DEFAULT gen_random_uuid() NOT NULL,
  room_id text NOT NULL,
  owner_user_id uuid NOT NULL,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  duration_seconds numeric DEFAULT 0 NOT NULL,
  codec text DEFAULT ''::text NOT NULL,
  container text DEFAULT 'mp4'::text NOT NULL,
  content_hash text NOT NULL,
  chunk_size integer DEFAULT 131072 NOT NULL,
  total_chunks integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz DEFAULT (now() + '24:00:00'::interval) NOT NULL,
  CONSTRAINT room_media_sessions_status_check CHECK (status = ANY (ARRAY['ACTIVE'::text, 'ENDED'::text, 'FAILED'::text])),
  CONSTRAINT room_media_sessions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT room_media_sessions_pkey PRIMARY KEY (media_id)
);

-- 2.11 Table: public.room_messages
CREATE TABLE IF NOT EXISTS public.room_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  room_id text NOT NULL,
  user_id uuid,
  message text NOT NULL,
  message_type text DEFAULT 'user'::text NOT NULL,
  event_type text,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz,
  client_message_id uuid,
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  deleted_by text,
  CONSTRAINT room_messages_event_check CHECK (message_type = 'user'::text AND event_type IS NULL OR message_type = 'system'::text AND event_type IS NOT NULL),
  CONSTRAINT room_messages_not_empty CHECK (btrim(message) <> ''::text),
  CONSTRAINT room_messages_type_check CHECK (message_type = ANY (ARRAY['user'::text, 'system'::text])),
  CONSTRAINT room_messages_updated_at_check CHECK (updated_at IS NULL OR updated_at >= created_at),
  CONSTRAINT room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT room_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT room_messages_pkey PRIMARY KEY (id),
  CONSTRAINT room_messages_client_message_id_key UNIQUE (room_id, user_id, client_message_id)
);

-- 2.12 Table: public.room_quota_events
CREATE TABLE IF NOT EXISTS public.room_quota_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  account_id uuid NOT NULL,
  room_id text,
  room_kind text NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT room_quota_events_event_type_check CHECK (event_type = ANY (ARRAY['CREATED'::text, 'DELETED'::text, 'EXPIRED'::text, 'ENDED'::text, 'PERMANENCE_CHANGED'::text, 'REJECTED'::text, 'PURGED'::text])),
  CONSTRAINT room_quota_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT room_quota_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE SET NULL,
  CONSTRAINT room_quota_events_pkey PRIMARY KEY (id)
);

-- 2.13 Table: public.vbrowser_providers
CREATE TABLE IF NOT EXISTS public.vbrowser_providers (
  id text NOT NULL,
  display_name text NOT NULL,
  provider_type text NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  lifecycle text DEFAULT 'DRAFT'::text NOT NULL,
  max_concurrent_sessions integer,
  max_sessions_per_user integer,
  max_sessions_per_room integer,
  max_large_sessions integer,
  max_session_duration_seconds integer,
  max_large_session_duration_seconds integer,
  CONSTRAINT vbrowser_providers_display_name_not_empty CHECK (btrim(display_name) <> ''::text),
  CONSTRAINT vbrowser_providers_enabled_lifecycle_check CHECK (NOT enabled OR lifecycle = 'ENABLED'::text),
  CONSTRAINT vbrowser_providers_id_not_empty CHECK (btrim(id) <> ''::text),
  CONSTRAINT vbrowser_providers_lifecycle_check CHECK (lifecycle = ANY (ARRAY['DRAFT'::text, 'ENABLED'::text, 'DISABLED'::text, 'RETIRED'::text])),
  CONSTRAINT vbrowser_providers_policy_nonnegative CHECK ((max_concurrent_sessions IS NULL OR max_concurrent_sessions >= 0) AND (max_sessions_per_user IS NULL OR max_sessions_per_user >= 0) AND (max_sessions_per_room IS NULL OR max_sessions_per_room >= 0) AND (max_large_sessions IS NULL OR max_large_sessions >= 0) AND (max_session_duration_seconds IS NULL OR max_session_duration_seconds > 0) AND (max_large_session_duration_seconds IS NULL OR max_large_session_duration_seconds > 0)),
  CONSTRAINT vbrowser_providers_provider_type_check CHECK (provider_type = ANY (ARRAY['cloud'::text, 'docker'::text])),
  CONSTRAINT vbrowser_providers_pkey PRIMARY KEY (id)
);

-- 2.14 Table: public.vbrowser_pools
CREATE TABLE IF NOT EXISTS public.vbrowser_pools (
  id text NOT NULL,
  provider_id text NOT NULL,
  region text NOT NULL,
  is_large boolean DEFAULT false NOT NULL,
  min_size integer DEFAULT 0 NOT NULL,
  limit_size integer,
  enabled boolean DEFAULT false NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  lifecycle text DEFAULT 'DRAFT'::text NOT NULL,
  max_sessions_per_user integer,
  max_sessions_per_room integer,
  max_large_sessions integer,
  max_session_duration_seconds integer,
  max_large_session_duration_seconds integer,
  CONSTRAINT vbrowser_pools_check CHECK (limit_size IS NULL OR limit_size >= min_size),
  CONSTRAINT vbrowser_pools_enabled_lifecycle_check CHECK (NOT enabled OR lifecycle = 'ENABLED'::text),
  CONSTRAINT vbrowser_pools_id_not_empty CHECK (btrim(id) <> ''::text),
  CONSTRAINT vbrowser_pools_lifecycle_check CHECK (lifecycle = ANY (ARRAY['DRAFT'::text, 'ENABLED'::text, 'DISABLED'::text, 'RETIRED'::text])),
  CONSTRAINT vbrowser_pools_min_size_check CHECK (min_size >= 0),
  CONSTRAINT vbrowser_pools_policy_nonnegative CHECK ((max_sessions_per_user IS NULL OR max_sessions_per_user >= 0) AND (max_sessions_per_room IS NULL OR max_sessions_per_room >= 0) AND (max_large_sessions IS NULL OR max_large_sessions >= 0) AND (max_session_duration_seconds IS NULL OR max_session_duration_seconds > 0) AND (max_large_session_duration_seconds IS NULL OR max_large_session_duration_seconds > 0)),
  CONSTRAINT vbrowser_pools_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES vbrowser_providers(id) ON DELETE RESTRICT,
  CONSTRAINT vbrowser_pools_pkey PRIMARY KEY (id)
);

-- 2.15 Table: public.vbrowser
CREATE TABLE IF NOT EXISTS public.vbrowser (
  id bigserial NOT NULL,
  pool text NOT NULL,
  vmid text NOT NULL,
  state text NOT NULL,
  "creationTime" timestamptz NOT NULL,
  "heartbeatTime" timestamptz,
  "assignTime" timestamptz,
  "roomId" text,
  uid text,
  data json,
  retries integer DEFAULT 0,
  pass text,
  image text,
  provider_id text,
  pool_id text,
  expires_at timestamptz,
  released_at timestamptz,
  CONSTRAINT vbrowser_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES vbrowser_pools(id) ON DELETE RESTRICT,
  CONSTRAINT vbrowser_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES vbrowser_providers(id) ON DELETE RESTRICT,
  CONSTRAINT vbrowser_pkey PRIMARY KEY (id)
);

-- 2.16 Table: public.vbrowser_reservations
CREATE TABLE IF NOT EXISTS public.vbrowser_reservations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id text NOT NULL,
  pool_id text NOT NULL,
  room_id text NOT NULL,
  user_id text NOT NULL,
  is_large boolean DEFAULT false NOT NULL,
  status text DEFAULT 'RESERVED'::text NOT NULL,
  assigned_at timestamptz DEFAULT now() NOT NULL,
  heartbeat_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  failure_reason text,
  operation_id text,
  vmid text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT vbrowser_reservations_release_timestamp_check CHECK ((status = ANY (ARRAY['RELEASED'::text, 'FAILED'::text, 'EXPIRED'::text])) = (released_at IS NOT NULL)),
  CONSTRAINT vbrowser_reservations_status_check CHECK (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text, 'RELEASING'::text, 'RELEASED'::text, 'FAILED'::text, 'EXPIRED'::text])),
  CONSTRAINT vbrowser_reservations_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES vbrowser_pools(id) ON DELETE RESTRICT,
  CONSTRAINT vbrowser_reservations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES vbrowser_providers(id) ON DELETE RESTRICT,
  CONSTRAINT vbrowser_reservations_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms("roomId") ON DELETE CASCADE,
  CONSTRAINT vbrowser_reservations_pkey PRIMARY KEY (id)
);

-- 2.17 Table: public.notification_type_registry
CREATE TABLE IF NOT EXISTS public.notification_type_registry (
  type text NOT NULL,
  description text NOT NULL,
  email_eligible boolean DEFAULT false NOT NULL,
  in_app_eligible boolean DEFAULT true NOT NULL,
  category text DEFAULT 'system'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT notification_type_registry_category_check CHECK (category = ANY (ARRAY['room'::text, 'moderation'::text, 'infrastructure'::text, 'system'::text])),
  CONSTRAINT notification_type_registry_pkey PRIMARY KEY (type)
);

-- 2.18 Table: public.notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL,
  email_enabled boolean DEFAULT true NOT NULL,
  room_invitations boolean DEFAULT true NOT NULL,
  room_events boolean DEFAULT false NOT NULL,
  moderation_events boolean DEFAULT false NOT NULL,
  system_announcements boolean DEFAULT true NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id)
);

-- 2.19 Table: public.notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  read_at timestamptz,
  expires_at timestamptz,
  event_id text DEFAULT ''::text NOT NULL,
  CONSTRAINT notifications_body_check CHECK (btrim(body) <> ''::text),
  CONSTRAINT notifications_expires_at_after_created CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT notifications_read_at_after_created CHECK (read_at IS NULL OR read_at >= created_at),
  CONSTRAINT notifications_title_check CHECK (btrim(title) <> ''::text),
  CONSTRAINT notifications_type_fkey FOREIGN KEY (type) REFERENCES notification_type_registry(type),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_event_type_unique UNIQUE (user_id, event_id, type)
);

-- 2.20 Table: public.email_outbox
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  notification_id uuid,
  user_id uuid NOT NULL,
  template_key text NOT NULL,
  recipient_email text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  available_at timestamptz DEFAULT now() NOT NULL,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  provider_idempotency_key text,
  last_error_code text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  provider_delivery_status text,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  provider varchar(50) DEFAULT 'smtp'::character varying NOT NULL,
  provider_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  delivery_profile varchar(50) DEFAULT 'transactional_default'::character varying NOT NULL,
  dispatch_started_at timestamptz,
  CONSTRAINT email_outbox_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT email_outbox_provider_delivery_status_check CHECK (provider_delivery_status = ANY (ARRAY['SENT'::text, 'DELIVERED'::text, 'DELIVERY_DELAYED'::text, 'BOUNCED'::text, 'COMPLAINED'::text])),
  CONSTRAINT email_outbox_recipient_email_check CHECK (btrim(recipient_email) <> ''::text),
  CONSTRAINT email_outbox_sent_at_after_attempt CHECK (sent_at IS NULL OR last_attempt_at IS NOT NULL),
  CONSTRAINT email_outbox_status_check CHECK (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'SENT'::text, 'RETRY'::text, 'FAILED'::text, 'CANCELLED'::text])),
  CONSTRAINT email_outbox_template_key_check CHECK (btrim(template_key) <> ''::text),
  CONSTRAINT email_outbox_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL,
  CONSTRAINT email_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT email_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT email_outbox_provider_idempotency_key_key UNIQUE (provider_idempotency_key)
);

-- 2.21 Table: public.email_delivery_suppressions
CREATE TABLE IF NOT EXISTS public.email_delivery_suppressions (
  email_hash text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT email_delivery_suppressions_reason_check CHECK (reason = ANY (ARRAY['bounced'::text, 'complained'::text, 'manual'::text])),
  CONSTRAINT email_delivery_suppressions_pkey PRIMARY KEY (email_hash)
);

-- 2.22 Table: public.durable_rate_limits
CREATE TABLE IF NOT EXISTS public.durable_rate_limits (
  key text NOT NULL,
  tokens integer NOT NULL,
  last_refill_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT durable_rate_limits_pkey PRIMARY KEY (key)
);

-- 2.23 Table: public.abuse_reports
CREATE TABLE IF NOT EXISTS public.abuse_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reporter_user_id uuid NOT NULL,
  target_user_id uuid,
  target_room_id text,
  category text NOT NULL,
  reason text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid,
  CONSTRAINT abuse_reports_category_check CHECK (category = ANY (ARRAY['harassment'::text, 'spam'::text, 'hate_speech'::text, 'inappropriate_content'::text, 'copyright'::text, 'other'::text])),
  CONSTRAINT abuse_reports_no_self_report CHECK (reporter_user_id <> target_user_id),
  CONSTRAINT abuse_reports_status_check CHECK (status = ANY (ARRAY['pending'::text, 'investigating'::text, 'resolved'::text, 'dismissed'::text])),
  CONSTRAINT abuse_reports_target_check CHECK (target_user_id IS NOT NULL OR target_room_id IS NOT NULL),
  CONSTRAINT abuse_reports_reporter_user_id_fkey FOREIGN KEY (reporter_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT abuse_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT abuse_reports_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT abuse_reports_pkey PRIMARY KEY (id)
);

-- 2.24 Table: public.announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  level text NOT NULL,
  action_label text,
  action_url text,
  is_active boolean DEFAULT true NOT NULL,
  published_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT announcements_level_check CHECK (level = ANY (ARRAY['info'::text, 'success'::text, 'warning'::text, 'critical'::text])),
  CONSTRAINT announcements_pkey PRIMARY KEY (id)
);

-- 2.25 Table: public.feedback
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  type text NOT NULL,
  rating integer,
  message text NOT NULL,
  context text NOT NULL,
  app_version text DEFAULT '1.0.3'::text,
  platform text DEFAULT 'web'::text,
  created_at timestamptz DEFAULT now() NOT NULL,
  status text DEFAULT 'new'::text NOT NULL,
  reviewer_id uuid,
  review_notes text,
  reviewed_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  idempotency_key text,
  CONSTRAINT feedback_context_check CHECK (context = ANY (ARRAY['room'::text, 'playback'::text, 'host'::text, 'participants'::text, 'chat'::text, 'video'::text, 'virtual-browser'::text, 'connection'::text])),
  CONSTRAINT feedback_message_check CHECK (char_length(message) >= 1 AND char_length(message) <= 2000),
  CONSTRAINT feedback_rating_check CHECK (rating >= 1 AND rating <= 5),
  CONSTRAINT feedback_status_check CHECK (status = ANY (ARRAY['new'::text, 'reviewed'::text, 'actioned'::text, 'dismissed'::text])),
  CONSTRAINT feedback_type_check CHECK (type = ANY (ARRAY['bug'::text, 'suggestion'::text, 'problem'::text, 'experience'::text])),
  CONSTRAINT feedback_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT feedback_pkey PRIMARY KEY (id)
);

-- 2.26 Table: public.active_user
CREATE TABLE IF NOT EXISTS public.active_user (
  uid text NOT NULL,
  "lastActiveTime" timestamptz,
  CONSTRAINT active_user_pkey PRIMARY KEY (uid)
);

-- 2.27 Table: public.webhook_events
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  received_at timestamptz DEFAULT now() NOT NULL,
  processed_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT webhook_events_pkey PRIMARY KEY (id),
  CONSTRAINT webhook_events_provider_event_id_key UNIQUE (provider, event_id)
);

-- ----------------------------------------------------------------------------
-- 3. VIEWS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_profiles WITH (security_invoker = false) AS
  SELECT id, username, display_name, avatar_url
  FROM public.profiles;

-- ----------------------------------------------------------------------------
-- 4. ROUTINES & FUNCTIONS (Authoritative)
-- ----------------------------------------------------------------------------
-- 4.1 Function: public.check_user_email_domain
CREATE OR REPLACE FUNCTION public.check_user_email_domain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  normalized_email text;
  email_domain text;
BEGIN
  normalized_email := lower(trim(coalesce(NEW.email, '')));

  IF normalized_email = ''
     OR position('@' IN normalized_email) <= 1
     OR position('@' IN substring(normalized_email FROM position('@' IN normalized_email) + 1)) > 0
     OR normalized_email ~ '[[:space:]]'
  THEN
    RAISE EXCEPTION 'Email provider is not supported.';
  END IF;

  email_domain := split_part(normalized_email, '@', 2);

  IF email_domain NOT IN (
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'zoho.com',
    'proton.me',
    'protonmail.com'
  ) THEN
    RAISE EXCEPTION 'Email provider is not supported.';
  END IF;

  RETURN NEW;
END;
$function$;

-- 4.2 Function: public.consume_durable_rate_limit
CREATE OR REPLACE FUNCTION public.consume_durable_rate_limit(p_key text, p_max_tokens integer, p_refill_interval_seconds integer, p_cost integer DEFAULT 1)
 RETURNS TABLE(allowed boolean, remaining integer, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_tokens integer;
  v_last_refill timestamp with time zone;
  v_elapsed_seconds numeric;
  v_refill_tokens integer;
BEGIN
  INSERT INTO public.durable_rate_limits (key, tokens, last_refill_at)
  VALUES (p_key, p_max_tokens, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT tokens, last_refill_at
  INTO v_tokens, v_last_refill
  FROM public.durable_rate_limits
  WHERE key = p_key
  FOR UPDATE;

  v_elapsed_seconds := EXTRACT(EPOCH FROM (v_now - v_last_refill));
  IF v_elapsed_seconds > 0 AND p_refill_interval_seconds > 0 THEN
    v_refill_tokens := FLOOR((v_elapsed_seconds / p_refill_interval_seconds) * p_max_tokens);
    IF v_refill_tokens > 0 THEN
      v_tokens := LEAST(p_max_tokens, v_tokens + v_refill_tokens);
      v_last_refill := v_now;
    END IF;
  END IF;

  IF v_tokens >= p_cost THEN
    v_tokens := v_tokens - p_cost;
    UPDATE public.durable_rate_limits
    SET tokens = v_tokens,
        last_refill_at = v_last_refill
    WHERE key = p_key;

    RETURN QUERY SELECT true, v_tokens, 0;
  ELSE
    DECLARE
      v_needed integer := p_cost - v_tokens;
      v_retry_after integer;
    BEGIN
      v_retry_after := CEIL((v_needed::numeric / p_max_tokens) * p_refill_interval_seconds);
      IF v_retry_after < 1 THEN v_retry_after := 1; END IF;
      RETURN QUERY SELECT false, v_tokens, v_retry_after;
    END;
  END IF;
END;
$function$;

-- 4.3 Function: public.create_room_authoritative
CREATE OR REPLACE FUNCTION public.create_room_authoritative(p_account_id uuid, p_room_id text, p_room_kind text, p_room_title text, p_room_description text, p_passcode_hash text, p_owner_passcode text, p_passcode_fingerprint text, p_cover_photo text, p_is_chat_disabled boolean, p_expires_at timestamp with time zone, p_requested_participants integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_is_permanent boolean := (p_room_kind = 'permanent');
  v_usage RECORD;
  v_entitlement RECORD;
  v_effective_capacity integer;
  v_effective_expires_at timestamptz;
BEGIN
  IF p_room_kind NOT IN ('watch', 'permanent') THEN
    RAISE EXCEPTION 'ROOM_KIND_INVALID';
  END IF;

  -- 1. Ensure usage row exists
  INSERT INTO public.account_room_usage (account_id, updated_at)
  VALUES (p_account_id, v_now)
  ON CONFLICT (account_id) DO NOTHING;

  -- 2. UNIFIED ATOMIC LOCK: Lock entitlement row AND usage row in order
  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 3. Resolve centralized effective entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', jsonb_build_object('reason', 'ACCOUNT_ROOMS_DISABLED', 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 4. Auto-expire overdue rooms for this account to immediately reclaim capacity
  UPDATE public.rooms
  SET status = 'expired', "endedAt" = v_now
  WHERE owner_id = p_account_id 
    AND status IN ('active', 'inactive') 
    AND "isPermanent" = false 
    AND "expiresAt" IS NOT NULL 
    AND "expiresAt" <= v_now;

  -- 5. Single-Pass Aggregate Room Count: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 6. Enforce Total Room Ceiling (Grandfathering: existing rooms preserved, new creation blocked if at/above limit)
  IF v_usage.total >= v_entitlement.max_total_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'TOTAL_ROOM_LIMIT_EXCEEDED', 'limit', v_entitlement.max_total_rooms, 'current', v_usage.total, 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'TOTAL_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 7. Enforce Room Kind Sub-Limit
  IF p_room_kind = 'watch' AND v_usage.watch >= v_entitlement.max_watch_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'watch', 'limit', v_entitlement.max_watch_rooms, 'current', v_usage.watch, 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
  ELSIF p_room_kind = 'permanent' AND v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, p_room_kind, 'REJECTED', 
            jsonb_build_object('reason', 'KIND_ROOM_LIMIT_EXCEEDED', 'kind', 'permanent', 'limit', v_entitlement.max_permanent_rooms, 'current', v_usage.permanent, 'attempted_room_id', p_room_id));
    RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
  END IF;

  -- 8. Enforce Participant Capacity Cap (Bounded by plan capacity)
  v_effective_capacity := COALESCE(p_requested_participants, v_entitlement.max_participant_capacity);
  IF v_effective_capacity < 2 OR v_effective_capacity > v_entitlement.max_participant_capacity THEN
    RAISE EXCEPTION 'INVALID_PARTICIPANT_CAPACITY';
  END IF;

  -- 9. Enforce Expiration Duration (Server-side validation against plan max_room_duration_hours)
  IF v_is_permanent THEN
    v_effective_expires_at := NULL;
  ELSE
    IF p_expires_at IS NULL THEN
      v_effective_expires_at := v_now + make_interval(hours => v_entitlement.max_room_duration_hours);
    ELSE
      IF p_expires_at <= v_now THEN
        RAISE EXCEPTION 'INVALID_EXPIRATION_TIME';
      END IF;
      IF p_expires_at > v_now + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
        RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
      END IF;
      v_effective_expires_at := p_expires_at;
    END IF;
  END IF;

  -- 10. Insert Authoritative Room Row
  INSERT INTO public.rooms (
    "roomId", "creationTime", "lastUpdateTime", passcode, owner_passcode,
    passcode_fingerprint, "roomTitle", "roomDescription", "coverPhoto",
    owner_id, "isSubRoom", status, "startedAt", "expiresAt", "isPermanent",
    "isChatDisabled", room_kind, max_participants
  ) VALUES (
    p_room_id, v_now, v_now, p_passcode_hash, p_owner_passcode,
    p_passcode_fingerprint, p_room_title, p_room_description, p_cover_photo,
    p_account_id, v_is_permanent, 'inactive', v_now, v_effective_expires_at, v_is_permanent,
    p_is_chat_disabled, p_room_kind, v_effective_capacity
  );

  -- 11. Update Materialized Usage Record
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total + 1,
      watch_rooms = v_usage.watch + CASE WHEN p_room_kind = 'watch' THEN 1 ELSE 0 END,
      permanent_rooms = v_usage.permanent + CASE WHEN p_room_kind = 'permanent' THEN 1 ELSE 0 END,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 12. Audit Record & Lifecycle Event
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, p_room_kind, 'CREATED', jsonb_build_object('total_rooms', v_usage.total + 1));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "newStatus", "newExpiresAt", reason)
  VALUES (p_room_id, p_account_id::text, 'room.created', 'inactive', v_effective_expires_at, 'authorized room creation');

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'roomKind', p_room_kind,
    'totalRooms', v_usage.total + 1,
    'maxTotal', v_entitlement.max_total_rooms,
    'maxCapacity', v_effective_capacity,
    'maxParticipants', v_effective_capacity,
    'expiresAt', v_effective_expires_at
  );
END;
$function$;

-- 4.4 Function: public.delete_room_authoritative
CREATE OR REPLACE FUNCTION public.delete_room_authoritative(p_account_id uuid, p_room_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_usage RECORD;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'active' THEN
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_DELETE';
  END IF;

  -- 3. Delete Room Row (cascades chat/lifecycle events, sets room_quota_events.room_id to NULL)
  DELETE FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 4. Single-Pass Aggregate Recalculation: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 5. Update Usage Row
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 6. Audit Event (room_id set to NULL as room is deleted, id preserved in metadata)
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, NULL, v_room.room_kind, 'DELETED', jsonb_build_object('room_id', p_room_id, 'total_rooms', v_usage.total));

  RETURN jsonb_build_object(
    'deletedRoomId', p_room_id,
    'roomKind', v_room.room_kind,
    'totalRoomsRemaining', v_usage.total
  );
END;
$function$;

-- 4.5 Function: public.delete_unconfirmed_users
CREATE OR REPLACE FUNCTION public.delete_unconfirmed_users()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT id FROM auth.users 
        WHERE email_confirmed_at IS NULL AND created_at < now() - interval '7 days'
    LOOP
        -- 1. Delete rooms
        DELETE FROM public.rooms WHERE owner_id = rec.id;
        
        -- 2. Delete linked accounts (if table exists)
        BEGIN
            EXECUTE 'DELETE FROM public.link_account WHERE uid = $1' USING rec.id::text;
        EXCEPTION
            WHEN undefined_table THEN
                -- Do nothing
        END;

        -- 3. Delete avatars
        DELETE FROM storage.objects 
        WHERE bucket_id = 'avatars' 
          AND (name LIKE rec.id::text || '/%');
          
        -- 4. Delete the user
        DELETE FROM auth.users WHERE id = rec.id;
    END LOOP;
END;
$function$;

-- 4.6 Function: public.email_outbox_set_updated_at
CREATE OR REPLACE FUNCTION public.email_outbox_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$function$;

-- 4.7 Function: public.end_room_authoritative
CREATE OR REPLACE FUNCTION public.end_room_authoritative(p_account_id uuid, p_room_id text, p_actor text DEFAULT 'host'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_usage RECORD;
  v_new_status text;
  v_event_name text;
  v_quota_event text;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  -- For temporary rooms: ended/expired are terminal
  -- For permanent rooms: inactive is already stopped, but not terminal
  IF v_room."isPermanent" = false AND v_room.status IN ('ended', 'expired') THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', v_room.status, 'isPermanent', false, 'alreadyConcluded', true);
  ELSIF v_room."isPermanent" = true AND v_room.status = 'inactive' THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', 'inactive', 'isPermanent', true, 'alreadyConcluded', true);
  END IF;

  -- 3. Atomic transition:
  -- Permanent rooms stop session -> 'inactive' (reusable indefinitely)
  -- Temporary rooms end session -> 'ended' (permanently terminal)
  IF v_room."isPermanent" = true THEN
    v_new_status := 'inactive';
    v_event_name := 'session.stopped';
    v_quota_event := 'SESSION_STOPPED';

    UPDATE public.rooms
    SET status = 'inactive',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE "roomId" = p_room_id AND owner_id = p_account_id;
  ELSE
    v_new_status := 'ended';
    v_event_name := 'room.ended';
    v_quota_event := 'ENDED';

    UPDATE public.rooms
    SET status = 'ended',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE "roomId" = p_room_id AND owner_id = p_account_id;
  END IF;

  -- 4. Single-Pass Aggregate Recalculation: O(N_account)
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  -- 5. Update Usage Row
  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 6. Audit & Lifecycle Logs
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, v_room.room_kind, v_quota_event, jsonb_build_object('total_rooms', v_usage.total, 'status', v_new_status));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_actor, v_event_name, v_room.status, v_new_status, v_room."expiresAt", v_room."expiresAt", 'session ended by host', v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', v_new_status,
    'isPermanent', v_room."isPermanent",
    'totalRoomsRemaining', v_usage.total
  );
END;
$function$;

-- 4.8 Function: public.enforce_notification_preferences_server_insert
CREATE OR REPLACE FUNCTION public.enforce_notification_preferences_server_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF current_setting('role', true) = 'authenticated' OR current_setting('role', true) = 'anon' THEN
    RAISE EXCEPTION 'NOTIFICATION_PREFERENCES_INSERT_FORBIDDEN'
      USING HINT = 'Preference rows are provisioned automatically by the server.',
            ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- 4.9 Function: public.enforce_notifications_server_only
CREATE OR REPLACE FUNCTION public.enforce_notifications_server_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'NOTIFICATIONS_MUTATION_FORBIDDEN'
      USING HINT = 'Notifications are mutated exclusively via server-authoritative RPC.',
            ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- 4.10 Function: public.expire_rooms_authoritative
CREATE OR REPLACE FUNCTION public.expire_rooms_authoritative()
 RETURNS TABLE(room_id text, owner_id uuid, room_kind text, previous_expires_at timestamp with time zone, ended_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_account RECORD;
  r RECORD;
  v_usage RECORD;
BEGIN
  -- 1. Discover all distinct accounts with candidate expired rooms
  FOR v_account IN
    SELECT DISTINCT public.rooms.owner_id
    FROM public.rooms
    WHERE status IN ('active', 'inactive')
      AND "isPermanent" = false
      AND "expiresAt" IS NOT NULL
      AND "expiresAt" <= v_now
  LOOP
    -- 2. UNIFIED LOCK: Lock this account's usage row FIRST
    PERFORM 1 
    FROM public.account_room_usage 
    WHERE account_room_usage.account_id = v_account.owner_id 
    FOR UPDATE;

    -- 3. Transition expired rooms for this account (re-verifying under lock)
    FOR r IN
      UPDATE public.rooms
      SET status = 'expired', "endedAt" = v_now
      WHERE public.rooms.owner_id = v_account.owner_id
        AND public.rooms.status IN ('active', 'inactive') 
        AND public.rooms."isPermanent" = false 
        AND public.rooms."expiresAt" IS NOT NULL 
        AND public.rooms."expiresAt" <= v_now
      RETURNING public.rooms."roomId", public.rooms.owner_id, public.rooms.room_kind, public.rooms."expiresAt", public.rooms."endedAt"
    LOOP
      room_id := r."roomId";
      owner_id := r.owner_id;
      room_kind := r.room_kind;
      previous_expires_at := r."expiresAt";
      ended_at := r."endedAt";

      -- Audit Event
      INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
      VALUES (r.owner_id, r."roomId", r.room_kind, 'EXPIRED', '{}'::jsonb);

      INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
      VALUES (r."roomId", 'system', 'room.expired', 'active_or_inactive', 'expired', r."expiresAt", r."expiresAt", 'time limit reached', v_now);

      RETURN NEXT;
    END LOOP;

    -- 4. Recompute usage for this account in a single aggregate scan
    SELECT 
      count(*)::int AS total,
      count(*) FILTER (WHERE public.rooms.room_kind = 'watch')::int AS watch,
      count(*) FILTER (WHERE public.rooms.room_kind = 'permanent')::int AS permanent
    INTO v_usage
    FROM public.rooms
    WHERE public.rooms.owner_id = v_account.owner_id
      AND public.rooms.status IN ('scheduled', 'active', 'inactive')
      AND (public.rooms."isPermanent" = true OR public.rooms."expiresAt" > v_now);

    UPDATE public.account_room_usage
    SET total_rooms = v_usage.total,
        watch_rooms = v_usage.watch,
        permanent_rooms = v_usage.permanent,
        updated_at = v_now
    WHERE account_room_usage.account_id = v_account.owner_id;
  END LOOP;
END;
$function$;

-- 4.11 Function: public.extend_room_authoritative
CREATE OR REPLACE FUNCTION public.extend_room_authoritative(p_account_id uuid, p_room_id text, p_new_expires_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
  v_entitlement RECORD;
BEGIN
  -- 1. UNIFIED ATOMIC LOCK: Lock entitlement row AND usage row in order
  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Resolve centralized effective entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 3. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room."isPermanent" = true THEN
    RAISE EXCEPTION 'ROOM_IS_PERMANENT';
  END IF;

  IF v_room.status IN ('ended', 'expired') THEN
    RAISE EXCEPTION 'ROOM_ENDED_CANNOT_EXTEND';
  END IF;

  IF v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
    UPDATE public.rooms SET status = 'expired', "endedAt" = v_now WHERE public.rooms."roomId" = p_room_id;
    RAISE EXCEPTION 'ROOM_ALREADY_EXPIRED';
  END IF;

  IF p_new_expires_at <= v_room."expiresAt" THEN
    RAISE EXCEPTION 'INVALID_EXTENSION_TIME';
  END IF;

  -- Server-side max room duration enforcement
  IF p_new_expires_at > v_room."creationTime" + make_interval(hours => v_entitlement.max_room_duration_hours) THEN
    RAISE EXCEPTION 'ROOM_DURATION_EXCEEDS_PLAN_LIMIT';
  END IF;

  -- 4. Atomically update expiresAt
  UPDATE public.rooms
  SET "expiresAt" = p_new_expires_at,
      "lastUpdateTime" = v_now
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id;

  -- 5. Audit
  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_account_id::text, 'room.extended', v_room.status, v_room.status, v_room."expiresAt", p_new_expires_at, 'user extended', v_now);

  RETURN p_new_expires_at;
END;
$function$;

-- 4.12 Function: public.generate_unique_username
CREATE OR REPLACE FUNCTION public.generate_unique_username(p_email text, p_requested_username text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base text := '';
  v_candidate text;
  v_suffix int;
  v_counter int := 0;
BEGIN
  -- Derive from email prefix first
  IF p_email IS NOT NULL AND trim(p_email) != '' THEN
    v_base := regexp_replace(lower(split_part(trim(p_email), '@', 1)), '[^a-z0-9_]', '', 'g');
    v_base := regexp_replace(v_base, '_+', '_', 'g');
    v_base := trim(both '_' from v_base);
  END IF;

  -- Fallback to requested username if email prefix was empty
  IF v_base = '' OR v_base IS NULL THEN
    IF p_requested_username IS NOT NULL AND trim(p_requested_username) != '' THEN
      v_base := regexp_replace(lower(trim(p_requested_username)), '[^a-z0-9_]', '', 'g');
      v_base := regexp_replace(v_base, '_+', '_', 'g');
      v_base := trim(both '_' from v_base);
    END IF;
  END IF;

  -- Final fallback if still empty
  IF v_base = '' OR v_base IS NULL THEN
    v_base := 'user';
  END IF;

  -- Truncate base to 18 characters
  v_base := substr(v_base, 1, 18);

  -- Strip any trailing numeric suffix so we don't double append
  v_base := regexp_replace(v_base, '_[0-9]+$', '');
  IF v_base = '' THEN
    v_base := 'user';
  END IF;

  -- Loop to guarantee uniqueness and numbers
  LOOP
    v_counter := v_counter + 1;
    v_suffix := floor(1000 + random() * 9000)::int;
    v_candidate := v_base || '_' || v_suffix::text;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_candidate)) THEN
      RETURN v_candidate;
    END IF;

    IF v_counter >= 15 THEN
      v_suffix := floor(10000 + random() * 90000)::int;
      RETURN v_base || '_' || v_suffix::text;
    END IF;
  END LOOP;
END;
$function$;

-- 4.13 Function: public.get_default_subscription_plan_id
CREATE OR REPLACE FUNCTION public.get_default_subscription_plan_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_plan_id text;
BEGIN
  SELECT id INTO v_plan_id
  FROM public.subscription_plans
  WHERE is_default = true AND is_active = true
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'DEFAULT_SUBSCRIPTION_PLAN_NOT_CONFIGURED';
  END IF;

  RETURN v_plan_id;
END;
$function$;

-- 4.14 Function: public.get_unread_notification_count
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.notifications
  WHERE user_id = p_user_id
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
  RETURN v_count;
END;
$function$;

-- 4.15 Function: public.handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_default_plan text;
  v_terms_agreed_at timestamptz;
  v_age_verified_at timestamptz;
  v_username text;
BEGIN
  v_default_plan := public.get_default_subscription_plan_id();

  -- Parse terms_agreed_at from user metadata or default to clock_timestamp() if terms_agreed is true
  v_terms_agreed_at := COALESCE(
    (NEW.raw_user_meta_data ->> 'terms_agreed_at')::timestamptz,
    CASE WHEN (NEW.raw_user_meta_data ->> 'terms_agreed')::boolean = true THEN clock_timestamp() ELSE clock_timestamp() END
  );

  -- Parse age_verified_at from user metadata or default to clock_timestamp()
  v_age_verified_at := COALESCE(
    (NEW.raw_user_meta_data ->> 'age_verified_at')::timestamptz,
    clock_timestamp()
  );

  -- Authoritatively generate a clean, unique, lowercase username from email with numbers
  v_username := public.generate_unique_username(
    NEW.email,
    NEW.raw_user_meta_data ->> 'username'
  );

  INSERT INTO public.profiles (id, username, avatar_url, display_name, terms_agreed_at, age_verified_at)
  VALUES (
    NEW.id,
    v_username,
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture'
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    v_terms_agreed_at,
    v_age_verified_at
  )
  ON CONFLICT (id) DO UPDATE SET
    avatar_url        = COALESCE(public.profiles.avatar_url, excluded.avatar_url),
    display_name      = COALESCE(public.profiles.display_name, excluded.display_name),
    terms_agreed_at   = COALESCE(public.profiles.terms_agreed_at, excluded.terms_agreed_at),
    age_verified_at   = COALESCE(public.profiles.age_verified_at, excluded.age_verified_at);

  INSERT INTO public.account_room_limits (account_id, plan_id, enabled, created_at, updated_at)
  VALUES (NEW.id, v_default_plan, true, clock_timestamp(), clock_timestamp())
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO public.account_room_usage (account_id, total_rooms, watch_rooms, permanent_rooms, updated_at)
  VALUES (NEW.id, 0, 0, 0, clock_timestamp())
  ON CONFLICT (account_id) DO NOTHING;

  PERFORM public.provision_notification_preferences(NEW.id);

  RETURN NEW;
END;
$function$;

-- 4.16 Function: public.mark_all_notifications_read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.notifications
  SET read_at = clock_timestamp()
  WHERE user_id = p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

-- 4.17 Function: public.mark_notification_read
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_user_id uuid, p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.notifications
  SET read_at = clock_timestamp()
  WHERE id = p_notification_id
    AND user_id = p_user_id
    AND read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

-- 4.18 Function: public.provision_notification_preferences
CREATE OR REPLACE FUNCTION public.provision_notification_preferences(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$function$;

-- 4.19 Function: public.purge_account_rooms_authoritative
CREATE OR REPLACE FUNCTION public.purge_account_rooms_authoritative(p_account_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_deleted_ids text[] := ARRAY[]::text[];
  r RECORD;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = p_account_id 
  FOR UPDATE;

  -- 2. Audit and delete all rooms for this account
  FOR r IN
    SELECT public.rooms."roomId", public.rooms.room_kind, public.rooms.status
    FROM public.rooms
    WHERE public.rooms.owner_id = p_account_id
    FOR UPDATE
  LOOP
    v_deleted_ids := array_append(v_deleted_ids, r."roomId");

    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (p_account_id, NULL, r.room_kind, 'PURGED', jsonb_build_object('room_id', r."roomId", 'account_purge', true));

    INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", reason, timestamp)
    VALUES (r."roomId", p_account_id::text, 'room.deleted', r.status, 'deleted', 'account purged', v_now);
  END LOOP;

  DELETE FROM public.rooms WHERE public.rooms.owner_id = p_account_id;

  -- 3. Reset materialized usage to zero under lock
  UPDATE public.account_room_usage
  SET total_rooms = 0,
      watch_rooms = 0,
      permanent_rooms = 0,
      updated_at = v_now
  WHERE account_room_usage.account_id = p_account_id;

  RETURN v_deleted_ids;
END;
$function$;

-- 4.20 Function: public.purge_expired_rate_limits
CREATE OR REPLACE FUNCTION public.purge_expired_rate_limits(p_older_than_seconds integer DEFAULT 86400)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.durable_rate_limits
  WHERE last_refill_at < clock_timestamp() - (p_older_than_seconds || ' seconds')::interval;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- 4.21 Function: public.purge_failed_email_outbox
CREATE OR REPLACE FUNCTION public.purge_failed_email_outbox(p_retention_days integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.email_outbox
  WHERE status = 'FAILED'
    AND updated_at < now() - (p_retention_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 4.22 Function: public.purge_read_notifications_expired
CREATE OR REPLACE FUNCTION public.purge_read_notifications_expired()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 4.23 Function: public.purge_sent_email_outbox
CREATE OR REPLACE FUNCTION public.purge_sent_email_outbox(p_retention_days integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.email_outbox
  WHERE status = 'SENT'
    AND updated_at < now() - (p_retention_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 4.24 Function: public.reserve_vbrowser_capacity
CREATE OR REPLACE FUNCTION public.reserve_vbrowser_capacity(p_provider_id text, p_pool_id text, p_room_id text, p_user_id text, p_is_large boolean, p_config_provider_limit integer, p_config_pool_limit integer, p_lease_seconds integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  provider_row public.vbrowser_providers%ROWTYPE;
  pool_row public.vbrowser_pools%ROWTYPE;
  active_provider integer;
  active_pool integer;
  active_user integer;
  active_room integer;
  active_large integer;
  effective_provider integer;
  effective_pool integer;
  effective_user integer;
  effective_room integer;
  effective_large integer;
  reservation_id uuid;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_config_provider_limit < 0 OR p_config_pool_limit < 0 THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pool_id, 0));
  SELECT * INTO provider_row FROM public.vbrowser_providers WHERE id = p_provider_id FOR UPDATE;
  SELECT * INTO pool_row FROM public.vbrowser_pools WHERE id = p_pool_id FOR UPDATE;
  IF NOT FOUND OR pool_row.provider_id <> p_provider_id OR NOT provider_row.enabled OR provider_row.lifecycle <> 'ENABLED' OR NOT pool_row.enabled OR pool_row.lifecycle <> 'ENABLED' THEN
    RAISE EXCEPTION 'POLICY_MISSING_OR_DISABLED';
  END IF;
  IF provider_row.max_concurrent_sessions IS NULL OR provider_row.max_sessions_per_user IS NULL OR provider_row.max_sessions_per_room IS NULL OR provider_row.max_large_sessions IS NULL OR pool_row.limit_size IS NULL OR pool_row.max_sessions_per_user IS NULL OR pool_row.max_sessions_per_room IS NULL OR pool_row.max_large_sessions IS NULL THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;
  effective_provider := LEAST(provider_row.max_concurrent_sessions, p_config_provider_limit);
  effective_pool := LEAST(pool_row.limit_size, effective_provider, p_config_pool_limit);
  effective_user := LEAST(provider_row.max_sessions_per_user, pool_row.max_sessions_per_user);
  effective_room := LEAST(provider_row.max_sessions_per_room, pool_row.max_sessions_per_room);
  effective_large := LEAST(provider_row.max_large_sessions, pool_row.max_large_sessions);
  UPDATE public.vbrowser_reservations SET status = 'EXPIRED', released_at = now(), failure_reason = 'LEASE_EXPIRED' WHERE status IN ('RESERVED', 'ALLOCATED') AND expires_at <= now();
  SELECT count(*) INTO active_provider FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_pool FROM public.vbrowser_reservations WHERE pool_id = p_pool_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_user FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND user_id = p_user_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_room FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND room_id = p_room_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_large FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND is_large AND status IN ('RESERVED', 'ALLOCATED');
  IF active_provider >= effective_provider THEN RAISE EXCEPTION 'PROVIDER_CAPACITY_EXCEEDED'; END IF;
  IF active_pool >= effective_pool THEN RAISE EXCEPTION 'POOL_CAPACITY_EXCEEDED'; END IF;
  IF active_user >= effective_user THEN RAISE EXCEPTION 'USER_CAPACITY_EXCEEDED'; END IF;
  IF active_room >= effective_room THEN RAISE EXCEPTION 'ROOM_CAPACITY_EXCEEDED'; END IF;
  IF p_is_large AND active_large >= effective_large THEN RAISE EXCEPTION 'LARGE_CAPACITY_EXCEEDED'; END IF;
  INSERT INTO public.vbrowser_reservations(provider_id, pool_id, room_id, user_id, is_large, expires_at) VALUES (p_provider_id, p_pool_id, p_room_id, p_user_id, p_is_large, now() + make_interval(secs => p_lease_seconds)) RETURNING id INTO reservation_id;
  RETURN reservation_id;
END;
$function$;

-- 4.25 Function: public.resolve_account_entitlement
CREATE OR REPLACE FUNCTION public.resolve_account_entitlement(p_account_id uuid)
 RETURNS TABLE(account_id uuid, plan_id text, plan_display_name text, enabled boolean, max_total_rooms integer, max_watch_rooms integer, max_permanent_rooms integer, max_participant_capacity integer, max_room_duration_hours integer, is_vbrowser_allowed boolean, max_vbrowser_concurrency integer, has_overrides boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_rec RECORD;
  v_eff_total integer;
  v_eff_watch integer;
  v_eff_permanent integer;
  v_eff_capacity integer;
  v_eff_duration integer;
  v_eff_vbrowser_allowed boolean;
  v_eff_vbrowser_concurrency integer;
  v_has_overrides boolean;
BEGIN
  SELECT 
    l.account_id,
    l.plan_id,
    p.display_name AS plan_display_name,
    l.enabled,
    p.max_total_rooms AS base_total,
    p.max_watch_rooms AS base_watch,
    p.max_permanent_rooms AS base_permanent,
    p.max_participant_capacity AS base_capacity,
    p.max_room_duration_hours AS base_duration,
    p.is_vbrowser_allowed AS base_vbrowser_allowed,
    p.max_vbrowser_concurrency AS base_vbrowser_concurrency,
    l.override_total_rooms,
    l.override_watch_rooms,
    l.override_permanent_rooms,
    l.override_participant_capacity,
    l.override_room_duration_hours,
    l.override_vbrowser_allowed,
    l.override_vbrowser_concurrency
  INTO v_rec
  FROM public.account_room_limits l
  JOIN public.subscription_plans p ON l.plan_id = p.id
  WHERE l.account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_ENTITLEMENT_NOT_FOUND';
  END IF;

  v_eff_total := COALESCE(v_rec.override_total_rooms, v_rec.base_total);
  v_eff_watch := LEAST(COALESCE(v_rec.override_watch_rooms, v_rec.base_watch), v_eff_total);
  v_eff_permanent := LEAST(COALESCE(v_rec.override_permanent_rooms, v_rec.base_permanent), v_eff_total);
  v_eff_capacity := COALESCE(v_rec.override_participant_capacity, v_rec.base_capacity);
  v_eff_duration := COALESCE(v_rec.override_room_duration_hours, v_rec.base_duration);
  v_eff_vbrowser_allowed := COALESCE(v_rec.override_vbrowser_allowed, v_rec.base_vbrowser_allowed);
  v_eff_vbrowser_concurrency := CASE 
    WHEN NOT v_eff_vbrowser_allowed THEN 0
    ELSE COALESCE(v_rec.override_vbrowser_concurrency, v_rec.base_vbrowser_concurrency)
  END;

  v_has_overrides := (
    v_rec.override_total_rooms IS NOT NULL OR
    v_rec.override_watch_rooms IS NOT NULL OR
    v_rec.override_permanent_rooms IS NOT NULL OR
    v_rec.override_participant_capacity IS NOT NULL OR
    v_rec.override_room_duration_hours IS NOT NULL OR
    v_rec.override_vbrowser_allowed IS NOT NULL OR
    v_rec.override_vbrowser_concurrency IS NOT NULL
  );

  account_id := v_rec.account_id;
  plan_id := v_rec.plan_id;
  plan_display_name := v_rec.plan_display_name;
  enabled := v_rec.enabled;
  max_total_rooms := v_eff_total;
  max_watch_rooms := v_eff_watch;
  max_permanent_rooms := v_eff_permanent;
  max_participant_capacity := v_eff_capacity;
  max_room_duration_hours := v_eff_duration;
  is_vbrowser_allowed := v_eff_vbrowser_allowed;
  max_vbrowser_concurrency := v_eff_vbrowser_concurrency;
  has_overrides := v_has_overrides;

  RETURN NEXT;
END;
$function$;

-- 4.26 Function: public.set_room_activity_authoritative
CREATE OR REPLACE FUNCTION public.set_room_activity_authoritative(p_room_id text, p_status text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
  v_usage RECORD;
  v_new_status text := p_status;
BEGIN
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_room_usage.account_id = v_room.owner_id 
  FOR UPDATE;

  -- Re-read under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id
  FOR UPDATE;

  -- If room is already ended or expired, do not overwrite
  IF v_room.status IN ('ended') THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'status', v_room.status, 'unchanged', true);
  END IF;

  -- Authorization enforcement for user-initiated state transitions:
  IF p_status = 'active' THEN
    IF p_actor_id IS NULL OR p_actor_id != v_room.owner_id THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_ROOM_OWNER';
    END IF;
  ELSIF p_status = 'inactive' THEN
    -- If an actor is explicitly provided, verify they own the room; system inactivity timeouts pass NULL.
    IF p_actor_id IS NOT NULL AND p_actor_id != v_room.owner_id THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_ROOM_OWNER';
    END IF;
  END IF;

  -- Canonical lifecycle check: if temporary room has passed its canonical expiresAt, transition to expired
  IF v_room."isPermanent" = false AND v_room."expiresAt" IS NOT NULL AND v_room."expiresAt" <= v_now THEN
    UPDATE public.rooms
    SET status = 'expired',
        "endedAt" = v_now,
        "lastUpdateTime" = v_now
    WHERE public.rooms."roomId" = p_room_id;

    -- Audit
    INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
    VALUES (v_room.owner_id, p_room_id, v_room.room_kind, 'EXPIRED', '{"reason": "overdue_during_activity_change"}'::jsonb);

    INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
    VALUES (p_room_id, COALESCE(p_actor_id::text, 'system'), 'room.expired', v_room.status, 'expired', v_room."expiresAt", v_room."expiresAt", 'canonical expiry reached', v_now);

    v_new_status := 'expired';
  ELSE
    -- Active / Inactive state transition
    IF p_status = 'active' THEN
      UPDATE public.rooms
      SET status = 'active',
          "startedAt" = COALESCE("startedAt", v_now),
          "lastActiveAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE public.rooms."roomId" = p_room_id;
    ELSE
      UPDATE public.rooms
      SET status = 'inactive',
          "lastActiveAt" = v_now,
          "lastUpdateTime" = v_now
      WHERE public.rooms."roomId" = p_room_id;
    END IF;

    IF v_room.status != p_status THEN
      INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
      VALUES (p_room_id, COALESCE(p_actor_id::text, 'system'), 'room.status_changed', v_room.status, p_status, v_room."expiresAt", v_room."expiresAt", 'activity transition', v_now);
    END IF;
  END IF;

  -- 2. Recompute materialized usage under lock
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE public.rooms.room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE public.rooms.room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE public.rooms.owner_id = v_room.owner_id
    AND public.rooms.status IN ('scheduled', 'active', 'inactive')
    AND (public.rooms."isPermanent" = true OR public.rooms."expiresAt" > v_now);

  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_room_usage.account_id = v_room.owner_id;

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'status', v_new_status,
    'expiresAt', v_room."expiresAt",
    'isPermanent', v_room."isPermanent"
  );
END;
$function$;

-- 4.27 Function: public.set_room_participants_lock_authoritative
CREATE OR REPLACE FUNCTION public.set_room_participants_lock_authoritative(p_account_id uuid, p_room_id text, p_locked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
BEGIN
  -- 1. UNIFIED LOCK: Lock account usage record FIRST
  PERFORM 1
  FROM public.account_room_usage
  WHERE account_room_usage.account_id = p_account_id
  FOR UPDATE;

  -- 2. Lock and verify room ownership
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.owner_id != p_account_id THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  -- 3. Update field
  UPDATE public.rooms
  SET participants_locked = p_locked,
      "lastUpdateTime" = v_now
  WHERE public.rooms."roomId" = p_room_id;

  -- 4. Emit lifecycle audit event (no credentials)
  INSERT INTO public.room_lifecycle_events (
    "roomId", actor, event, "previousStatus", "newStatus", reason, timestamp
  )
  VALUES (
    p_room_id,
    p_account_id::text,
    CASE WHEN p_locked THEN 'room.participants_locked' ELSE 'room.participants_unlocked' END,
    v_room.status,
    v_room.status,
    CASE WHEN p_locked THEN 'participants locked' ELSE 'participants unlocked' END,
    v_now
  );

  -- 5. Return resulting state
  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'participants_locked', p_locked
  );
END;
$function$;

-- 4.28 Function: public.set_room_permanence_authoritative
CREATE OR REPLACE FUNCTION public.set_room_permanence_authoritative(p_account_id uuid, p_room_id text, p_is_permanent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_entitlement RECORD;
  v_now timestamptz := clock_timestamp();
  v_new_kind text := CASE WHEN p_is_permanent THEN 'permanent' ELSE 'watch' END;
  v_new_expires timestamptz;
  v_usage RECORD;
BEGIN
  -- 1. UNIFIED ATOMIC LOCK: Lock entitlement row AND usage row in order
  PERFORM 1 
  FROM public.account_room_limits 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  PERFORM 1 
  FROM public.account_room_usage 
  WHERE account_id = p_account_id 
  FOR UPDATE;

  -- 2. Resolve centralized effective entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_account_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  -- 3. Re-read room under lock
  SELECT * INTO v_room
  FROM public.rooms
  WHERE "roomId" = p_room_id AND owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'active' THEN
    RAISE EXCEPTION 'ROOM_ACTIVE_CANNOT_CHANGE_PERMANENCE';
  END IF;

  IF v_room."isPermanent" = p_is_permanent THEN
    RETURN jsonb_build_object('roomId', p_room_id, 'isPermanent', p_is_permanent, 'unchanged', true);
  END IF;

  -- 4. Check quota for permanence change
  IF p_is_permanent THEN
    v_new_expires := NULL;

    SELECT count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
    INTO v_usage
    FROM public.rooms
    WHERE owner_id = p_account_id
      AND status IN ('scheduled', 'active', 'inactive')
      AND ("isPermanent" = true OR "expiresAt" > v_now);

    IF v_usage.permanent >= v_entitlement.max_permanent_rooms THEN
      RAISE EXCEPTION 'PERMANENT_ROOM_LIMIT_EXCEEDED';
    END IF;
  ELSE
    v_new_expires := v_now + make_interval(hours => v_entitlement.max_room_duration_hours);

    SELECT count(*) FILTER (WHERE room_kind = 'watch')::int AS watch
    INTO v_usage
    FROM public.rooms
    WHERE owner_id = p_account_id
      AND status IN ('scheduled', 'active', 'inactive')
      AND ("isPermanent" = true OR "expiresAt" > v_now);

    IF v_usage.watch >= v_entitlement.max_watch_rooms THEN
      RAISE EXCEPTION 'WATCH_ROOM_LIMIT_EXCEEDED';
    END IF;
  END IF;

  -- 5. Update room row
  UPDATE public.rooms
  SET "isPermanent" = p_is_permanent,
      room_kind = v_new_kind,
      "isSubRoom" = p_is_permanent,
      "expiresAt" = v_new_expires
  WHERE "roomId" = p_room_id AND owner_id = p_account_id;

  -- 6. Recompute usage
  SELECT 
    count(*)::int AS total,
    count(*) FILTER (WHERE room_kind = 'watch')::int AS watch,
    count(*) FILTER (WHERE room_kind = 'permanent')::int AS permanent
  INTO v_usage
  FROM public.rooms
  WHERE owner_id = p_account_id
    AND status IN ('scheduled', 'active', 'inactive')
    AND ("isPermanent" = true OR "expiresAt" > v_now);

  UPDATE public.account_room_usage
  SET total_rooms = v_usage.total,
      watch_rooms = v_usage.watch,
      permanent_rooms = v_usage.permanent,
      updated_at = v_now
  WHERE account_id = p_account_id;

  -- 7. Audit
  INSERT INTO public.room_quota_events(account_id, room_id, room_kind, event_type, metadata)
  VALUES (p_account_id, p_room_id, v_new_kind, 'PERMANENCE_CHANGED', 
          jsonb_build_object('isPermanent', p_is_permanent, 'permanent_rooms', v_usage.permanent));

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", "previousExpiresAt", "newExpiresAt", reason, timestamp)
  VALUES (p_room_id, p_account_id::text, 'room.permanence_changed', v_room.status, v_room.status, v_room."expiresAt", v_new_expires, 
          CASE WHEN p_is_permanent THEN 'converted to permanent' ELSE 'converted to temporary' END, v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'isPermanent', p_is_permanent,
    'roomKind', v_new_kind,
    'expiresAt', v_new_expires
  );
END;
$function$;

-- 4.29 Function: public.set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 4.30 Function: public.update_room_metadata_authoritative
CREATE OR REPLACE FUNCTION public.update_room_metadata_authoritative(p_account_id uuid, p_room_id text, p_title text, p_description text, p_is_chat_disabled boolean, p_cover_photo text, p_passcode_hash text, p_owner_passcode text, p_passcode_fingerprint text, p_clear_passcode boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room
  FROM public.rooms
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_passcode_fingerprint IS NOT NULL AND NOT p_clear_passcode THEN
    PERFORM 1
    FROM public.rooms
    WHERE public.rooms.passcode_fingerprint = p_passcode_fingerprint
      AND public.rooms."roomId" != p_room_id;

    IF FOUND THEN
      RAISE EXCEPTION 'PASSCODE_TAKEN';
    END IF;
  END IF;

  UPDATE public.rooms
  SET "roomTitle" = COALESCE(p_title, "roomTitle"),
      "roomDescription" = CASE WHEN p_description IS NOT NULL THEN p_description ELSE "roomDescription" END,
      "isChatDisabled" = COALESCE(p_is_chat_disabled, "isChatDisabled"),
      "coverPhoto" = CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE "coverPhoto" END,
      passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_hash IS NOT NULL THEN p_passcode_hash ELSE passcode END,
      owner_passcode = CASE WHEN p_clear_passcode THEN NULL WHEN p_owner_passcode IS NOT NULL THEN p_owner_passcode ELSE owner_passcode END,
      passcode_fingerprint = CASE WHEN p_clear_passcode THEN NULL WHEN p_passcode_fingerprint IS NOT NULL THEN p_passcode_fingerprint ELSE passcode_fingerprint END,
      "lastUpdateTime" = v_now
  WHERE public.rooms."roomId" = p_room_id AND public.rooms.owner_id = p_account_id;

  INSERT INTO public.room_lifecycle_events ("roomId", actor, event, "previousStatus", "newStatus", reason, timestamp)
  VALUES (p_room_id, p_account_id::text, 'room.metadata_updated', v_room.status, v_room.status, 'settings updated', v_now);

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'roomTitle', COALESCE(p_title, v_room."roomTitle"),
    'coverPhoto', CASE WHEN p_cover_photo IS NOT NULL THEN p_cover_photo ELSE v_room."coverPhoto" END
  );
END;
$function$;

-- 4.31 Function: public.vbrowser_acquire_reservation
CREATE OR REPLACE FUNCTION public.vbrowser_acquire_reservation(p_provider_id text, p_pool_id text, p_room_id text, p_user_id uuid, p_is_large boolean, p_lease_seconds integer, p_config_provider_limit integer, p_config_pool_limit integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  reservation_id text;
  provider_row public.vbrowser_providers%ROWTYPE;
  pool_row public.vbrowser_pools%ROWTYPE;
  effective_provider integer;
  effective_pool integer;
  effective_user integer;
  effective_room integer;
  effective_large integer;
  active_provider integer;
  active_pool integer;
  active_user integer;
  active_room integer;
  active_large integer;
  v_entitlement RECORD;
  v_active_user_vbrowser_allocations integer;
BEGIN
  -- Input validation
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_config_provider_limit < 0 OR p_config_pool_limit < 0 THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;

  -- 1. Deterministic Advisory Transaction Locks (Provider -> Pool -> User)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pool_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- 2. Resolve centralized subscription billing entitlement
  SELECT * INTO v_entitlement
  FROM public.resolve_account_entitlement(p_user_id);

  IF NOT v_entitlement.enabled THEN
    RAISE EXCEPTION 'ACCOUNT_ROOMS_DISABLED';
  END IF;

  IF NOT v_entitlement.is_vbrowser_allowed THEN
    RAISE EXCEPTION 'VBROWSER_NOT_ENTITLED';
  END IF;

  -- 3. Row-level locks on provider and pool with lifecycle verification
  SELECT * INTO provider_row 
  FROM public.vbrowser_providers 
  WHERE id = p_provider_id 
  FOR UPDATE;

  IF NOT FOUND OR NOT provider_row.enabled OR provider_row.lifecycle <> 'ENABLED' THEN
    RAISE EXCEPTION 'PROVIDER_UNAVAILABLE';
  END IF;

  SELECT * INTO pool_row 
  FROM public.vbrowser_pools 
  WHERE id = p_pool_id AND provider_id = p_provider_id 
  FOR UPDATE;

  IF NOT FOUND OR NOT pool_row.enabled OR pool_row.lifecycle <> 'ENABLED' THEN
    RAISE EXCEPTION 'POOL_UNAVAILABLE';
  END IF;

  IF provider_row.max_concurrent_sessions IS NULL OR provider_row.max_sessions_per_user IS NULL 
     OR provider_row.max_sessions_per_room IS NULL OR provider_row.max_large_sessions IS NULL 
     OR pool_row.limit_size IS NULL OR pool_row.max_sessions_per_user IS NULL 
     OR pool_row.max_sessions_per_room IS NULL OR pool_row.max_large_sessions IS NULL THEN
    RAISE EXCEPTION 'POLICY_INVALID';
  END IF;

  effective_provider := LEAST(provider_row.max_concurrent_sessions, p_config_provider_limit);
  effective_pool := LEAST(pool_row.limit_size, effective_provider, p_config_pool_limit);
  effective_user := LEAST(provider_row.max_sessions_per_user, pool_row.max_sessions_per_user);
  effective_room := LEAST(provider_row.max_sessions_per_room, pool_row.max_sessions_per_room);
  effective_large := LEAST(provider_row.max_large_sessions, pool_row.max_large_sessions);

  -- 4. Sweep expired reservations
  UPDATE public.vbrowser_reservations
  SET status = 'EXPIRED', released_at = now(), failure_reason = 'LEASE_EXPIRED'
  WHERE status IN ('RESERVED', 'ALLOCATED') AND expires_at <= now();

  -- 5. Enforce user plan concurrency limit under lock
  SELECT count(*) INTO v_active_user_vbrowser_allocations
  FROM public.vbrowser_reservations
  WHERE user_id = p_user_id::text AND status IN ('RESERVED', 'ALLOCATED');

  IF v_active_user_vbrowser_allocations >= v_entitlement.max_vbrowser_concurrency THEN
    RAISE EXCEPTION 'VBROWSER_CONCURRENCY_LIMIT_REACHED';
  END IF;

  -- 6. Count active allocations under lock
  SELECT count(*) INTO active_provider FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_pool FROM public.vbrowser_reservations WHERE pool_id = p_pool_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_user FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND user_id = p_user_id::text AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_room FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND room_id = p_room_id AND status IN ('RESERVED', 'ALLOCATED');
  SELECT count(*) INTO active_large FROM public.vbrowser_reservations WHERE provider_id = p_provider_id AND is_large AND status IN ('RESERVED', 'ALLOCATED');

  IF active_provider >= effective_provider THEN RAISE EXCEPTION 'PROVIDER_CAPACITY_EXCEEDED'; END IF;
  IF active_pool >= effective_pool THEN RAISE EXCEPTION 'POOL_CAPACITY_EXCEEDED'; END IF;
  IF active_user >= effective_user THEN RAISE EXCEPTION 'USER_CAPACITY_EXCEEDED'; END IF;
  IF active_room >= effective_room THEN RAISE EXCEPTION 'ROOM_CAPACITY_EXCEEDED'; END IF;
  IF p_is_large AND active_large >= effective_large THEN RAISE EXCEPTION 'LARGE_CAPACITY_EXCEEDED'; END IF;

  -- 7. Atomic insertion
  INSERT INTO public.vbrowser_reservations (provider_id, pool_id, room_id, user_id, is_large, expires_at)
  VALUES (p_provider_id, p_pool_id, p_room_id, p_user_id::text, p_is_large, now() + make_interval(secs => p_lease_seconds))
  RETURNING id::text INTO reservation_id;

  RETURN reservation_id;
END;
$function$;

-- 4.32 Function: public.vbrowser_release_reservation
CREATE OR REPLACE FUNCTION public.vbrowser_release_reservation(p_user_id uuid, p_room_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_released_count integer;
BEGIN
  UPDATE public.vbrowser_reservations
  SET status = 'RELEASED', released_at = now()
  WHERE user_id = p_user_id::text
    AND room_id = p_room_id
    AND status IN ('RESERVED', 'ALLOCATED');

  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  RETURN v_released_count > 0;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. TRIGGERS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS email_outbox_set_updated_at ON public.email_outbox;
CREATE TRIGGER email_outbox_set_updated_at
  BEFORE UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION email_outbox_set_updated_at();

DROP TRIGGER IF EXISTS notification_preferences_set_updated_at ON public.notification_preferences;
CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_enforce_notification_preferences_server_insert ON public.notification_preferences;
CREATE TRIGGER trg_enforce_notification_preferences_server_insert
  BEFORE INSERT ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION enforce_notification_preferences_server_insert();

DROP TRIGGER IF EXISTS trg_enforce_notifications_delete ON public.notifications;
CREATE TRIGGER trg_enforce_notifications_delete
  BEFORE DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION enforce_notifications_server_only();

DROP TRIGGER IF EXISTS trg_enforce_notifications_insert ON public.notifications;
CREATE TRIGGER trg_enforce_notifications_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION enforce_notifications_server_only();

DROP TRIGGER IF EXISTS trg_enforce_notifications_update ON public.notifications;
CREATE TRIGGER trg_enforce_notifications_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION enforce_notifications_server_only();

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS vbrowser_pools_set_updated_at ON public.vbrowser_pools;
CREATE TRIGGER vbrowser_pools_set_updated_at
  BEFORE UPDATE ON public.vbrowser_pools
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS vbrowser_providers_set_updated_at ON public.vbrowser_providers;
CREATE TRIGGER vbrowser_providers_set_updated_at
  BEFORE UPDATE ON public.vbrowser_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Triggers on auth.users
DROP TRIGGER IF EXISTS trg_check_user_email_domain ON auth.users;
CREATE TRIGGER trg_check_user_email_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION check_user_email_domain();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_abuse_reports_reporter ON public.abuse_reports USING btree (reporter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON public.abuse_reports USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_target_room ON public.abuse_reports USING btree (target_room_id) WHERE (target_room_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_target_user ON public.abuse_reports USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_announcements_active_published ON public.announcements USING btree (is_active, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_durable_rate_limits_last_refill ON public.durable_rate_limits USING btree (last_refill_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_notification_id ON public.email_outbox USING btree (notification_id) WHERE (notification_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending_claim ON public.email_outbox USING btree (available_at, created_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'RETRY'::text]));
CREATE INDEX IF NOT EXISTS idx_email_outbox_profile_status ON public.email_outbox USING btree (delivery_profile, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_outbox_provider_composite ON public.email_outbox USING btree (provider, provider_message_id) WHERE (provider_message_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_email_outbox_provider_message_id ON public.email_outbox USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_email_outbox_stalled ON public.email_outbox USING btree (last_attempt_at) WHERE (status = 'PROCESSING'::text);
CREATE INDEX IF NOT EXISTS idx_email_outbox_user_id ON public.email_outbox USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_context ON public.feedback USING btree (context);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_idempotency_key ON public.feedback USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON public.feedback USING btree (rating);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback USING btree (status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON public.feedback USING btree (type);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON public.notifications USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications USING btree (user_id, read_at, created_at DESC) WHERE (read_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_room_admissions_lookup ON public.room_admissions USING btree (room_id, user_id) WHERE (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_room_bans_client_identity ON public.room_bans USING btree (room_id, client_identity);
CREATE INDEX IF NOT EXISTS idx_room_bans_room_id ON public.room_bans USING btree (room_id);
CREATE INDEX IF NOT EXISTS idx_room_bans_user_id ON public.room_bans USING btree (room_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_room_invitations_inviter_id ON public.room_invitations USING btree (inviter_id);
CREATE INDEX IF NOT EXISTS idx_room_invitations_room_id ON public.room_invitations USING btree (room_id);
CREATE INDEX IF NOT EXISTS idx_room_invitations_target_user_id ON public.room_invitations USING btree (target_user_id);
CREATE INDEX IF NOT EXISTS idx_room_invitations_token_hash ON public.room_invitations USING btree (token_hash);
CREATE INDEX IF NOT EXISTS idx_room_lifecycle_events_room_id ON public.room_lifecycle_events USING btree ("roomId");
CREATE INDEX IF NOT EXISTS idx_room_lifecycle_events_timestamp ON public.room_lifecycle_events USING btree ("timestamp");
CREATE INDEX IF NOT EXISTS idx_room_media_sessions_room_id ON public.room_media_sessions USING btree (room_id);
CREATE INDEX IF NOT EXISTS room_messages_room_created_id_idx ON public.room_messages USING btree (room_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_room_quota_events_account ON public.room_quota_events USING btree (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_quota_events_room_id ON public.room_quota_events USING btree (room_id);
CREATE INDEX IF NOT EXISTS idx_room_expires_at ON public.rooms USING btree ("expiresAt") WHERE (("expiresAt" IS NOT NULL) AND (status = 'active'::text));
CREATE INDEX IF NOT EXISTS idx_rooms_ending_soon ON public.rooms USING btree ("expiresAt") WHERE ((status = 'active'::text) AND ("isPermanent" = false) AND ("endingNotifiedAt" IS NULL));
CREATE INDEX IF NOT EXISTS idx_rooms_lifecycle_status ON public.rooms USING btree (status, "isPermanent", "expiresAt");
CREATE INDEX IF NOT EXISTS idx_rooms_owner_quota_eval ON public.rooms USING btree (owner_id, status, "isPermanent", "expiresAt");
CREATE INDEX IF NOT EXISTS "room_creationTime_idx" ON public.rooms USING btree ("creationTime");
CREATE INDEX IF NOT EXISTS room_owner_id_idx ON public.rooms USING btree (owner_id);
CREATE INDEX IF NOT EXISTS "room_roomId_idx" ON public.rooms USING gin ("roomId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS rooms_inactivity_idx ON public.rooms USING btree ("lastActiveAt") WHERE (status = 'active'::text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_single_default ON public.subscription_plans USING btree (is_default) WHERE (is_default = true);
CREATE INDEX IF NOT EXISTS vbrowser_active_lease_idx ON public.vbrowser USING btree (provider_id, pool_id, "heartbeatTime") WHERE ((state = ANY (ARRAY['staging'::text, 'used'::text])) AND (released_at IS NULL));
CREATE INDEX IF NOT EXISTS vbrowser_pool_id_idx ON public.vbrowser USING btree (pool_id);
CREATE INDEX IF NOT EXISTS vbrowser_pool_state_idx ON public.vbrowser USING btree (pool, state);
CREATE UNIQUE INDEX IF NOT EXISTS vbrowser_pool_vmid_idx ON public.vbrowser USING btree (pool, vmid);
CREATE INDEX IF NOT EXISTS vbrowser_provider_id_idx ON public.vbrowser USING btree (provider_id);
CREATE INDEX IF NOT EXISTS "vbrowser_roomId_idx" ON public.vbrowser USING btree ("roomId");
CREATE INDEX IF NOT EXISTS vbrowser_uid_idx ON public.vbrowser USING btree (uid);
CREATE INDEX IF NOT EXISTS vbrowser_pools_provider_id_idx ON public.vbrowser_pools USING btree (provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vbrowser_res_active_room ON public.vbrowser_reservations USING btree (room_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text, 'RELEASING'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS idx_vbrowser_res_operation_id ON public.vbrowser_reservations USING btree (operation_id) WHERE (operation_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vbrowser_res_room_id_status ON public.vbrowser_reservations USING btree (room_id, status);
CREATE INDEX IF NOT EXISTS idx_vbrowser_res_status_created_at ON public.vbrowser_reservations USING btree (status, created_at);
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_pool_idx ON public.vbrowser_reservations USING btree (pool_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_provider_idx ON public.vbrowser_reservations USING btree (provider_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_room_idx ON public.vbrowser_reservations USING btree (provider_id, room_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_active_user_idx ON public.vbrowser_reservations USING btree (provider_id, user_id) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));
CREATE INDEX IF NOT EXISTS vbrowser_reservations_expiry_idx ON public.vbrowser_reservations USING btree (expires_at) WHERE (status = ANY (ARRAY['RESERVED'::text, 'ALLOCATED'::text]));

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY & POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_room_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_media_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_quota_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vbrowser_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_type_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.durable_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abuse_reports_deny_client_access" ON public.abuse_reports;
CREATE POLICY "abuse_reports_deny_client_access"
  ON public.abuse_reports
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "Users view own account limits" ON public.account_room_limits;
CREATE POLICY "Users view own account limits"
  ON public.account_room_limits
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = account_id))
;

DROP POLICY IF EXISTS "Users view own room usage" ON public.account_room_usage;
CREATE POLICY "Users view own room usage"
  ON public.account_room_usage
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = account_id))
;

DROP POLICY IF EXISTS "active_user_deny_client_access" ON public.active_user;
CREATE POLICY "active_user_deny_client_access"
  ON public.active_user
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "Public read active announcements" ON public.announcements;
CREATE POLICY "Public read active announcements"
  ON public.announcements
  FOR SELECT
  TO public
  USING (((is_active = true) AND (published_at <= now())))
;

DROP POLICY IF EXISTS "durable_rate_limits_deny_client_access" ON public.durable_rate_limits;
CREATE POLICY "durable_rate_limits_deny_client_access"
  ON public.durable_rate_limits
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "email_delivery_suppressions_deny_client_access" ON public.email_delivery_suppressions;
CREATE POLICY "email_delivery_suppressions_deny_client_access"
  ON public.email_delivery_suppressions
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "email_outbox_deny_client_access" ON public.email_outbox;
CREATE POLICY "email_outbox_deny_client_access"
  ON public.email_outbox
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "feedback_insert_hardened" ON public.feedback;
CREATE POLICY "feedback_insert_hardened"
  ON public.feedback
  FOR INSERT
  TO public
  WITH CHECK (((user_id IS NULL) OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid)))))
;

DROP POLICY IF EXISTS "feedback_select_owner_only" ON public.feedback;
CREATE POLICY "feedback_select_owner_only"
  ON public.feedback
  FOR SELECT
  TO public
  USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid))))
;

DROP POLICY IF EXISTS "Users select own preferences" ON public.notification_preferences;
CREATE POLICY "Users select own preferences"
  ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
;

DROP POLICY IF EXISTS "Users update own preferences" ON public.notification_preferences;
CREATE POLICY "Users update own preferences"
  ON public.notification_preferences
  FOR UPDATE
  TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)))
;

DROP POLICY IF EXISTS "Public read notification types" ON public.notification_type_registry;
CREATE POLICY "Public read notification types"
  ON public.notification_type_registry
  FOR SELECT
  TO anon,authenticated
  USING (true)
;

DROP POLICY IF EXISTS "Users select own notifications" ON public.notifications;
CREATE POLICY "Users select own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING ((user_id = ( SELECT auth.uid() AS uid)))
;

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((( SELECT auth.uid() AS uid) = id))
;

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((id = ( SELECT auth.uid() AS uid)))
;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = id))
;

DROP POLICY IF EXISTS "Users can read their own room admissions" ON public.room_admissions;
CREATE POLICY "Users can read their own room admissions"
  ON public.room_admissions
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id))
;

DROP POLICY IF EXISTS "room_bans_deny_client_access" ON public.room_bans;
CREATE POLICY "room_bans_deny_client_access"
  ON public.room_bans
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "Service role full access on room_invitations" ON public.room_invitations;
CREATE POLICY "Service role full access on room_invitations"
  ON public.room_invitations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true)
;

DROP POLICY IF EXISTS "Users can view their targeted or created invitations" ON public.room_invitations;
CREATE POLICY "Users can view their targeted or created invitations"
  ON public.room_invitations
  FOR SELECT
  TO authenticated
  USING (((( SELECT auth.uid() AS uid) = inviter_id) OR (( SELECT auth.uid() AS uid) = target_user_id)))
;

DROP POLICY IF EXISTS "room_lifecycle_events_deny_client_access" ON public.room_lifecycle_events;
CREATE POLICY "room_lifecycle_events_deny_client_access"
  ON public.room_lifecycle_events
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "room_media_sessions_deny_client_access" ON public.room_media_sessions;
CREATE POLICY "room_media_sessions_deny_client_access"
  ON public.room_media_sessions
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "room_messages_deny_client_access" ON public.room_messages;
CREATE POLICY "room_messages_deny_client_access"
  ON public.room_messages
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "room_quota_events_deny_client_access" ON public.room_quota_events;
CREATE POLICY "room_quota_events_deny_client_access"
  ON public.room_quota_events
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "Users can view their own rooms" ON public.rooms;
CREATE POLICY "Users can view their own rooms"
  ON public.rooms
  FOR SELECT
  TO public
  USING ((( SELECT auth.uid() AS uid) = owner_id))
;

DROP POLICY IF EXISTS "Public view active subscription plans" ON public.subscription_plans;
CREATE POLICY "Public view active subscription plans"
  ON public.subscription_plans
  FOR SELECT
  TO anon,authenticated
  USING ((is_active = true))
;

DROP POLICY IF EXISTS "vbrowser_deny_client_access" ON public.vbrowser;
CREATE POLICY "vbrowser_deny_client_access"
  ON public.vbrowser
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "vbrowser_pools_deny_client_access" ON public.vbrowser_pools;
CREATE POLICY "vbrowser_pools_deny_client_access"
  ON public.vbrowser_pools
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "vbrowser_providers_deny_client_access" ON public.vbrowser_providers;
CREATE POLICY "vbrowser_providers_deny_client_access"
  ON public.vbrowser_providers
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "vbrowser_reservations_deny_client_access" ON public.vbrowser_reservations;
CREATE POLICY "vbrowser_reservations_deny_client_access"
  ON public.vbrowser_reservations
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

DROP POLICY IF EXISTS "webhook_events_deny_client_access" ON public.webhook_events;
CREATE POLICY "webhook_events_deny_client_access"
  ON public.webhook_events
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false)
;

-- ----------------------------------------------------------------------------
-- 8. PRIVILEGES & ROLE GRANTS
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.subscription_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_room_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_room_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rooms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_admissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_bans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_invitations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_lifecycle_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_media_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.room_quota_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vbrowser_providers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vbrowser_pools FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vbrowser FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vbrowser_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_type_registry FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notification_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.email_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.email_delivery_suppressions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.durable_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.abuse_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.feedback FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.active_user FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.abuse_reports TO postgres;
GRANT ALL ON TABLE public.abuse_reports TO service_role;
GRANT SELECT ON TABLE public.account_room_limits TO authenticated;
GRANT ALL ON TABLE public.account_room_limits TO postgres;
GRANT ALL ON TABLE public.account_room_limits TO service_role;
GRANT SELECT ON TABLE public.account_room_usage TO authenticated;
GRANT ALL ON TABLE public.account_room_usage TO postgres;
GRANT ALL ON TABLE public.account_room_usage TO service_role;
GRANT ALL ON TABLE public.active_user TO postgres;
GRANT ALL ON TABLE public.active_user TO service_role;
GRANT SELECT ON TABLE public.announcements TO anon;
GRANT SELECT ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO postgres;
GRANT ALL ON TABLE public.announcements TO service_role;
GRANT ALL ON TABLE public.durable_rate_limits TO postgres;
GRANT ALL ON TABLE public.durable_rate_limits TO service_role;
GRANT ALL ON TABLE public.email_delivery_suppressions TO postgres;
GRANT ALL ON TABLE public.email_delivery_suppressions TO service_role;
GRANT ALL ON TABLE public.email_outbox TO postgres;
GRANT ALL ON TABLE public.email_outbox TO service_role;
GRANT INSERT, SELECT ON TABLE public.feedback TO anon;
GRANT INSERT, SELECT ON TABLE public.feedback TO authenticated;
GRANT ALL ON TABLE public.feedback TO postgres;
GRANT ALL ON TABLE public.feedback TO service_role;
GRANT SELECT, UPDATE ON TABLE public.notification_preferences TO authenticated;
GRANT ALL ON TABLE public.notification_preferences TO postgres;
GRANT ALL ON TABLE public.notification_preferences TO service_role;
GRANT SELECT ON TABLE public.notification_type_registry TO anon;
GRANT SELECT ON TABLE public.notification_type_registry TO authenticated;
GRANT ALL ON TABLE public.notification_type_registry TO postgres;
GRANT ALL ON TABLE public.notification_type_registry TO service_role;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO postgres;
GRANT ALL ON TABLE public.notifications TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.profiles TO anon;
GRANT INSERT, SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO postgres;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.public_profiles TO anon;
GRANT SELECT ON TABLE public.public_profiles TO authenticated;
GRANT ALL ON TABLE public.public_profiles TO postgres;
GRANT ALL ON TABLE public.public_profiles TO service_role;
GRANT ALL ON TABLE public.room_admissions TO postgres;
GRANT ALL ON TABLE public.room_admissions TO service_role;
GRANT ALL ON TABLE public.room_bans TO postgres;
GRANT ALL ON TABLE public.room_bans TO service_role;
GRANT ALL ON TABLE public.room_invitations TO postgres;
GRANT ALL ON TABLE public.room_invitations TO service_role;
GRANT ALL ON TABLE public.room_lifecycle_events TO postgres;
GRANT ALL ON TABLE public.room_lifecycle_events TO service_role;
GRANT ALL ON TABLE public.room_media_sessions TO postgres;
GRANT ALL ON TABLE public.room_media_sessions TO service_role;
GRANT ALL ON TABLE public.room_messages TO postgres;
GRANT ALL ON TABLE public.room_messages TO service_role;
GRANT ALL ON TABLE public.room_quota_events TO postgres;
GRANT ALL ON TABLE public.room_quota_events TO service_role;
GRANT SELECT ON TABLE public.rooms TO anon;
GRANT SELECT ON TABLE public.rooms TO authenticated;
GRANT ALL ON TABLE public.rooms TO postgres;
GRANT ALL ON TABLE public.rooms TO service_role;
GRANT SELECT ON TABLE public.subscription_plans TO anon;
GRANT SELECT ON TABLE public.subscription_plans TO authenticated;
GRANT ALL ON TABLE public.subscription_plans TO postgres;
GRANT ALL ON TABLE public.subscription_plans TO service_role;
GRANT ALL ON TABLE public.vbrowser TO postgres;
GRANT ALL ON TABLE public.vbrowser TO service_role;
GRANT ALL ON TABLE public.vbrowser_pools TO postgres;
GRANT ALL ON TABLE public.vbrowser_pools TO service_role;
GRANT ALL ON TABLE public.vbrowser_providers TO postgres;
GRANT ALL ON TABLE public.vbrowser_providers TO service_role;
GRANT ALL ON TABLE public.vbrowser_reservations TO postgres;
GRANT ALL ON TABLE public.vbrowser_reservations TO service_role;
GRANT ALL ON TABLE public.webhook_events TO postgres;
GRANT ALL ON TABLE public.webhook_events TO service_role;

GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;
GRANT ALL ON TABLE public.public_profiles TO postgres, service_role;

REVOKE ALL ON FUNCTION public.check_user_email_domain FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_durable_rate_limit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_unconfirmed_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_outbox_set_updated_at FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_notification_preferences_server_insert FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_notifications_server_only FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_rooms_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_room_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_unique_username FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_default_subscription_plan_id FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_unread_notification_count FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notification_read FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provision_notification_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_account_rooms_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_failed_email_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_read_notifications_expired FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_sent_email_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_vbrowser_capacity FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_account_entitlement FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_activity_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_participants_lock_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_room_permanence_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_room_metadata_authoritative FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vbrowser_acquire_reservation FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vbrowser_release_reservation FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_email_domain TO postgres;
GRANT EXECUTE ON FUNCTION public.check_user_email_domain TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_durable_rate_limit TO postgres;
GRANT EXECUTE ON FUNCTION public.consume_durable_rate_limit TO service_role;
GRANT EXECUTE ON FUNCTION public.create_room_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.create_room_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_room_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_unconfirmed_users TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_unconfirmed_users TO service_role;
GRANT EXECUTE ON FUNCTION public.email_outbox_set_updated_at TO postgres;
GRANT EXECUTE ON FUNCTION public.email_outbox_set_updated_at TO service_role;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.end_room_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_notification_preferences_server_insert TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_notification_preferences_server_insert TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_notifications_server_only TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_notifications_server_only TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_rooms_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.expire_rooms_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.extend_room_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_unique_username TO postgres;
GRANT EXECUTE ON FUNCTION public.generate_unique_username TO service_role;
GRANT EXECUTE ON FUNCTION public.get_default_subscription_plan_id TO postgres;
GRANT EXECUTE ON FUNCTION public.get_default_subscription_plan_id TO service_role;
GRANT EXECUTE ON FUNCTION public.get_default_subscription_plan_id TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count TO postgres;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO postgres;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO postgres;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO postgres;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO service_role;
GRANT EXECUTE ON FUNCTION public.provision_notification_preferences TO postgres;
GRANT EXECUTE ON FUNCTION public.provision_notification_preferences TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_account_rooms_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_account_rooms_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_failed_email_outbox TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_failed_email_outbox TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_read_notifications_expired TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_read_notifications_expired TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_sent_email_outbox TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_sent_email_outbox TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_vbrowser_capacity TO postgres;
GRANT EXECUTE ON FUNCTION public.reserve_vbrowser_capacity TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_account_entitlement TO postgres;
GRANT EXECUTE ON FUNCTION public.resolve_account_entitlement TO service_role;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.set_room_activity_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.set_room_participants_lock_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.set_room_permanence_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at TO postgres;
GRANT EXECUTE ON FUNCTION public.set_updated_at TO service_role;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative TO postgres;
GRANT EXECUTE ON FUNCTION public.update_room_metadata_authoritative TO service_role;
GRANT EXECUTE ON FUNCTION public.vbrowser_acquire_reservation TO postgres;
GRANT EXECUTE ON FUNCTION public.vbrowser_acquire_reservation TO service_role;
GRANT EXECUTE ON FUNCTION public.vbrowser_release_reservation TO postgres;
GRANT EXECUTE ON FUNCTION public.vbrowser_release_reservation TO service_role;
