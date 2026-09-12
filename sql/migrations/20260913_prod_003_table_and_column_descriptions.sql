-- PROD-003: Comprehensive Table and Column Descriptions for all 25 Public Tables
-- Provides complete schema documentation for database clarity, operations, and audit compliance.

-- 1. abuse_reports
COMMENT ON TABLE public.abuse_reports IS 'Intake abuse reports for safety, terms violations, harassment, and room moderation.';
COMMENT ON COLUMN public.abuse_reports.id IS 'Unique identifier for the abuse report.';
COMMENT ON COLUMN public.abuse_reports.reporter_user_id IS 'User ID of the account filing the abuse report.';
COMMENT ON COLUMN public.abuse_reports.target_user_id IS 'User ID of the reported user (optional if reporting room).';
COMMENT ON COLUMN public.abuse_reports.target_room_id IS 'Room ID where the alleged abuse occurred (optional if reporting user directly).';
COMMENT ON COLUMN public.abuse_reports.category IS 'Category of violation (harassment, spam, hate_speech, inappropriate_content, copyright, other).';
COMMENT ON COLUMN public.abuse_reports.reason IS 'Detailed text rationale submitted by the reporter.';
COMMENT ON COLUMN public.abuse_reports.context IS 'Structured JSON payload containing room state, message snippets, and client metadata.';
COMMENT ON COLUMN public.abuse_reports.status IS 'Lifecycle triage status (pending, investigating, resolved, dismissed).';
COMMENT ON COLUMN public.abuse_reports.created_at IS 'Timestamp when the report was submitted.';
COMMENT ON COLUMN public.abuse_reports.resolved_at IS 'Timestamp when moderation triage concluded.';
COMMENT ON COLUMN public.abuse_reports.resolved_by IS 'User ID of the moderator or administrator who resolved the report.';

-- 2. account_room_limits
COMMENT ON TABLE public.account_room_limits IS 'Per-account subscription tier binding, capacity entitlements, and optional administrative overrides.';
COMMENT ON COLUMN public.account_room_limits.account_id IS 'Supabase auth user identifier owning the entitlement limits.';
COMMENT ON COLUMN public.account_room_limits.enabled IS 'Flag indicating whether the account is currently allowed to create rooms.';
COMMENT ON COLUMN public.account_room_limits.created_at IS 'Timestamp when the account entitlement record was provisioned.';
COMMENT ON COLUMN public.account_room_limits.updated_at IS 'Timestamp of the latest entitlement revision or override.';
COMMENT ON COLUMN public.account_room_limits.plan_id IS 'Foreign key reference to subscription_plans (e.g. free, pro, permanent).';
COMMENT ON COLUMN public.account_room_limits.override_total_rooms IS 'Explicit manual limit override for maximum concurrent active rooms.';
COMMENT ON COLUMN public.account_room_limits.override_watch_rooms IS 'Explicit manual limit override for maximum concurrent watch party rooms.';
COMMENT ON COLUMN public.account_room_limits.override_permanent_rooms IS 'Explicit manual limit override for maximum permanent persistent rooms.';
COMMENT ON COLUMN public.account_room_limits.override_participant_capacity IS 'Explicit manual limit override for maximum participants per room.';
COMMENT ON COLUMN public.account_room_limits.override_room_duration_hours IS 'Explicit manual limit override for maximum active room session duration in hours.';
COMMENT ON COLUMN public.account_room_limits.override_vbrowser_allowed IS 'Explicit manual override enabling or disabling virtual browser capability.';
COMMENT ON COLUMN public.account_room_limits.override_vbrowser_concurrency IS 'Explicit manual limit override for concurrent virtual browser sessions.';

-- 3. account_room_usage
COMMENT ON TABLE public.account_room_usage IS 'Per-account active room counters used for atomic concurrency quota enforcement.';
COMMENT ON COLUMN public.account_room_usage.account_id IS 'Supabase auth user identifier tracked for quota usage.';
COMMENT ON COLUMN public.account_room_usage.total_rooms IS 'Current count of active rooms created by this account.';
COMMENT ON COLUMN public.account_room_usage.watch_rooms IS 'Current count of active watch party rooms created by this account.';
COMMENT ON COLUMN public.account_room_usage.permanent_rooms IS 'Current count of active permanent rooms created by this account.';
COMMENT ON COLUMN public.account_room_usage.updated_at IS 'Timestamp when usage counters were last updated.';

-- 4. active_user
COMMENT ON TABLE public.active_user IS 'Ephemeral tracking of user sessions and presence across room instances.';
COMMENT ON COLUMN public.active_user.uid IS 'Unique user or guest session identifier.';
COMMENT ON COLUMN public.active_user."lastActiveTime" IS 'Timestamp of the users latest recorded activity heartbeat.';

-- 5. announcements
COMMENT ON TABLE public.announcements IS 'System-wide announcements and operational notices displayed in the global banner.';
COMMENT ON COLUMN public.announcements.id IS 'Unique identifier for the announcement.';
COMMENT ON COLUMN public.announcements.title IS 'Short headline of the announcement.';
COMMENT ON COLUMN public.announcements.body IS 'Detailed message text or markdown description.';
COMMENT ON COLUMN public.announcements.level IS 'Visual severity and style level (info, warning, critical, maintenance).';
COMMENT ON COLUMN public.announcements.action_label IS 'Optional call-to-action button label.';
COMMENT ON COLUMN public.announcements.action_url IS 'Optional destination URL for the call-to-action button.';
COMMENT ON COLUMN public.announcements.is_active IS 'Boolean flag controlling whether the announcement is published.';
COMMENT ON COLUMN public.announcements.published_at IS 'Scheduled or actual publication timestamp.';
COMMENT ON COLUMN public.announcements.created_at IS 'Timestamp when the announcement was drafted.';
COMMENT ON COLUMN public.announcements.updated_at IS 'Timestamp of the latest revision to the announcement.';

-- 6. durable_rate_limits
COMMENT ON TABLE public.durable_rate_limits IS 'Distributed token bucket rate limit counters persisted in PostgreSQL.';
COMMENT ON COLUMN public.durable_rate_limits.key IS 'Unique rate limit discriminator combining endpoint, client IP, or user identifier.';
COMMENT ON COLUMN public.durable_rate_limits.tokens IS 'Current available token balance in the bucket.';
COMMENT ON COLUMN public.durable_rate_limits.last_refill_at IS 'Timestamp when tokens were last replenished.';
COMMENT ON COLUMN public.durable_rate_limits.created_at IS 'Timestamp when the rate limit tracker was initialized.';

-- 7. email_delivery_suppressions
COMMENT ON TABLE public.email_delivery_suppressions IS 'Cryptographic hash suppressions preventing email dispatch to unsubscribed, bounced, or complained addresses.';
COMMENT ON COLUMN public.email_delivery_suppressions.email_hash IS 'SHA-256 hash of normalized recipient email address.';
COMMENT ON COLUMN public.email_delivery_suppressions.reason IS 'Suppression cause (unsubscribe, hard_bounce, spam_complaint, manual).';
COMMENT ON COLUMN public.email_delivery_suppressions.source IS 'Upstream provider or event triggering the suppression (resend_webhook, brevo_webhook, user_action).';
COMMENT ON COLUMN public.email_delivery_suppressions.created_at IS 'Timestamp when the suppression entry was created.';

-- 8. email_outbox
COMMENT ON TABLE public.email_outbox IS 'Transactional email queue polled and dispatched by the background email worker.';
COMMENT ON COLUMN public.email_outbox.id IS 'Unique identifier for the queued email item.';
COMMENT ON COLUMN public.email_outbox.notification_id IS 'Optional reference to the initiating in-app notification.';
COMMENT ON COLUMN public.email_outbox.user_id IS 'Target user account receiving the email.';
COMMENT ON COLUMN public.email_outbox.template_key IS 'Template key identifying the email markup (e.g. room_invite, room_expiring_15m).';
COMMENT ON COLUMN public.email_outbox.recipient_email IS 'Destination email address.';
COMMENT ON COLUMN public.email_outbox.payload IS 'Template variables and rendering parameters as a JSON payload.';
COMMENT ON COLUMN public.email_outbox.status IS 'Queue lifecycle status (pending, processing, sent, failed, suppressed).';
COMMENT ON COLUMN public.email_outbox.attempt_count IS 'Number of dispatch attempts made by worker processes.';
COMMENT ON COLUMN public.email_outbox.available_at IS 'Earliest timestamp when this message is eligible for worker pickup.';
COMMENT ON COLUMN public.email_outbox.last_attempt_at IS 'Timestamp of the most recent dispatch attempt.';
COMMENT ON COLUMN public.email_outbox.sent_at IS 'Timestamp when delivery was confirmed by the email provider.';
COMMENT ON COLUMN public.email_outbox.provider_message_id IS 'Upstream message ID assigned by the delivery provider.';
COMMENT ON COLUMN public.email_outbox.provider_idempotency_key IS 'Idempotency key supplied to the delivery provider to prevent duplicates.';
COMMENT ON COLUMN public.email_outbox.last_error_code IS 'Error code or message returned from the most recent failed dispatch.';
COMMENT ON COLUMN public.email_outbox.created_at IS 'Timestamp when the email message was enqueued.';
COMMENT ON COLUMN public.email_outbox.updated_at IS 'Timestamp of the latest queue state transition.';
COMMENT ON COLUMN public.email_outbox.provider_delivery_status IS 'Webhook delivery feedback status (delivered, bounced, complained).';
COMMENT ON COLUMN public.email_outbox.delivered_at IS 'Timestamp when final mailbox delivery was acknowledged by webhook.';
COMMENT ON COLUMN public.email_outbox.bounced_at IS 'Timestamp when a delivery bounce event was received.';
COMMENT ON COLUMN public.email_outbox.complained_at IS 'Timestamp when a spam complaint event was received.';
COMMENT ON COLUMN public.email_outbox.locked_at IS 'Lease acquisition timestamp for distributed worker locking.';
COMMENT ON COLUMN public.email_outbox.locked_by IS 'Worker instance identifier holding the active lease.';
COMMENT ON COLUMN public.email_outbox.provider IS 'Active email delivery service provider used (resend, brevo, mock).';
COMMENT ON COLUMN public.email_outbox.provider_metadata IS 'Provider-specific response metadata and diagnostics.';
COMMENT ON COLUMN public.email_outbox.delivery_profile IS 'Environment delivery profile routing (sandbox, staging, production).';
COMMENT ON COLUMN public.email_outbox.dispatch_started_at IS 'Timestamp when active transmission to the provider commenced.';

-- 9. feedback
COMMENT ON TABLE public.feedback IS 'User-submitted product feedback, bug reports, feature requests, and satisfaction ratings.';
COMMENT ON COLUMN public.feedback.id IS 'Unique identifier for the feedback submission.';
COMMENT ON COLUMN public.feedback.user_id IS 'Authenticated user ID who submitted the feedback, or NULL for anonymous submissions.';
COMMENT ON COLUMN public.feedback.type IS 'Feedback category (bug, feature, praise, question, other).';
COMMENT ON COLUMN public.feedback.rating IS 'Optional numeric satisfaction rating from 1 to 5.';
COMMENT ON COLUMN public.feedback.message IS 'User-submitted feedback message body.';
COMMENT ON COLUMN public.feedback.context IS 'Application surface or action context where feedback was prompted.';
COMMENT ON COLUMN public.feedback.app_version IS 'Client application release version at submission time.';
COMMENT ON COLUMN public.feedback.platform IS 'Client platform, operating system, and browser architecture.';
COMMENT ON COLUMN public.feedback.created_at IS 'Timestamp when feedback was submitted.';
COMMENT ON COLUMN public.feedback.status IS 'Triage and resolution status (new, under_review, resolved, archived).';
COMMENT ON COLUMN public.feedback.reviewer_id IS 'Moderator or administrator reviewing the feedback.';
COMMENT ON COLUMN public.feedback.review_notes IS 'Internal administrative review notes.';
COMMENT ON COLUMN public.feedback.reviewed_at IS 'Timestamp when review was performed.';
COMMENT ON COLUMN public.feedback.updated_at IS 'Timestamp when feedback status was updated.';
COMMENT ON COLUMN public.feedback.idempotency_key IS 'Client-generated idempotency token preventing duplicate submissions.';

-- 10. notification_preferences
COMMENT ON TABLE public.notification_preferences IS 'Per-user notification settings controlling email and in-app channel dispatch.';
COMMENT ON COLUMN public.notification_preferences.user_id IS 'Unique user identifier matching auth.users.';
COMMENT ON COLUMN public.notification_preferences.email_enabled IS 'Master toggle enabling or disabling transactional email notifications.';
COMMENT ON COLUMN public.notification_preferences.room_invitations IS 'Preference toggle for room invitation notifications.';
COMMENT ON COLUMN public.notification_preferences.room_events IS 'Preference toggle for room lifecycle and join notifications.';
COMMENT ON COLUMN public.notification_preferences.moderation_events IS 'Preference toggle for room moderation and warning notifications.';
COMMENT ON COLUMN public.notification_preferences.system_announcements IS 'Preference toggle for platform announcements and update emails.';
COMMENT ON COLUMN public.notification_preferences.updated_at IS 'Timestamp of the latest preference change.';

-- 11. notification_type_registry
COMMENT ON TABLE public.notification_type_registry IS 'Authoritative catalog of notification types and supported delivery channels.';
COMMENT ON COLUMN public.notification_type_registry.type IS 'Unique notification type code (e.g. room_invite, room_expiring_15m, room_ended).';
COMMENT ON COLUMN public.notification_type_registry.description IS 'Human-readable summary of the notification purpose.';
COMMENT ON COLUMN public.notification_type_registry.email_eligible IS 'Whether this notification type may be dispatched over email.';
COMMENT ON COLUMN public.notification_type_registry.in_app_eligible IS 'Whether this notification type may be rendered in the in-app notification inbox.';
COMMENT ON COLUMN public.notification_type_registry.category IS 'Grouping category (room, moderation, account, system).';
COMMENT ON COLUMN public.notification_type_registry.created_at IS 'Timestamp when the notification type was registered.';

-- 12. notifications
COMMENT ON TABLE public.notifications IS 'In-app user notification inbox records.';
COMMENT ON COLUMN public.notifications.id IS 'Unique identifier for the in-app notification.';
COMMENT ON COLUMN public.notifications.user_id IS 'Target recipient user identifier matching auth.users.';
COMMENT ON COLUMN public.notifications.type IS 'Notification type reference matching notification_type_registry.';
COMMENT ON COLUMN public.notifications.title IS 'Headline title of the notification.';
COMMENT ON COLUMN public.notifications.body IS 'Primary content or markdown text of the notification.';
COMMENT ON COLUMN public.notifications.metadata IS 'Structured JSON payload with actionable route targets, room IDs, or sender info.';
COMMENT ON COLUMN public.notifications.created_at IS 'Timestamp when the notification was created.';
COMMENT ON COLUMN public.notifications.read_at IS 'Timestamp when the recipient marked the notification as read, or NULL if unread.';
COMMENT ON COLUMN public.notifications.expires_at IS 'Expiration timestamp after which the notification is purged or hidden.';
COMMENT ON COLUMN public.notifications.event_id IS 'Unique domain event idempotency identifier preventing duplicate notifications.';

-- 13. profiles
COMMENT ON TABLE public.profiles IS 'Public user profiles and client customization preferences.';
COMMENT ON COLUMN public.profiles.id IS 'Unique user identifier linked directly to Supabase Auth.';
COMMENT ON COLUMN public.profiles.updated_at IS 'Timestamp of the most recent profile update.';
COMMENT ON COLUMN public.profiles.username IS 'Unique chosen handle used for mentions and display.';
COMMENT ON COLUMN public.profiles.avatar_url IS 'Public URL to the users avatar image in storage.';
COMMENT ON COLUMN public.profiles.pref_show_chat_column IS 'User preference to show the chat sidebar column by default.';
COMMENT ON COLUMN public.profiles.pref_show_people_column IS 'User preference to show the participant sidebar column by default.';
COMMENT ON COLUMN public.profiles.pref_disable_chat_sound IS 'User preference to mute audible chat message alerts.';
COMMENT ON COLUMN public.profiles.display_name IS 'Formatted human-readable name displayed in rooms.';
COMMENT ON COLUMN public.profiles.pref_camera_on IS 'User preference to enable camera preview on room entry.';
COMMENT ON COLUMN public.profiles.pref_mic_on IS 'User preference to un-mute microphone on room entry.';
COMMENT ON COLUMN public.profiles.pref_appearance_mode IS 'UI color scheme preference (system, light, dark, mantine).';

-- 14. room_bans
COMMENT ON TABLE public.room_bans IS 'Moderation ban records restricting banned users and client identities from re-entering rooms.';
COMMENT ON COLUMN public.room_bans.id IS 'Unique identifier for the ban entry.';
COMMENT ON COLUMN public.room_bans.room_id IS 'Room identifier where the ban is enforced.';
COMMENT ON COLUMN public.room_bans.client_identity IS 'Fingerprint, IP, or socket client identity banned from the room.';
COMMENT ON COLUMN public.room_bans.user_id IS 'Authenticated user ID banned from the room, if authenticated.';
COMMENT ON COLUMN public.room_bans.banned_by IS 'User ID or host identity executing the ban.';
COMMENT ON COLUMN public.room_bans.reason IS 'Optional moderation rationale for the ban.';
COMMENT ON COLUMN public.room_bans.created_at IS 'Timestamp when the ban was imposed.';

-- 15. room_lifecycle_events
COMMENT ON TABLE public.room_lifecycle_events IS 'Authoritative audit trail for room state changes, extensions, and terminations.';
COMMENT ON COLUMN public.room_lifecycle_events.id IS 'Unique identifier for the lifecycle event.';
COMMENT ON COLUMN public.room_lifecycle_events."roomId" IS 'Room identifier associated with the lifecycle transition.';
COMMENT ON COLUMN public.room_lifecycle_events.actor IS 'Entity triggering the transition (host, system_reaper, timeout, admin).';
COMMENT ON COLUMN public.room_lifecycle_events.event IS 'Event name (created, activated, extended, locked, unlocked, ended, expired).';
COMMENT ON COLUMN public.room_lifecycle_events."previousStatus" IS 'Room status prior to the transition.';
COMMENT ON COLUMN public.room_lifecycle_events."newStatus" IS 'Room status after the transition.';
COMMENT ON COLUMN public.room_lifecycle_events."previousExpiresAt" IS 'Scheduled expiration timestamp before this event.';
COMMENT ON COLUMN public.room_lifecycle_events."newExpiresAt" IS 'Scheduled expiration timestamp resulting from this event.';
COMMENT ON COLUMN public.room_lifecycle_events.reason IS 'Rationale or trigger code for the state transition.';
COMMENT ON COLUMN public.room_lifecycle_events.timestamp IS 'Precise timestamp when the lifecycle transition occurred.';

-- 16. room_media_sessions
COMMENT ON TABLE public.room_media_sessions IS 'Active media playback synchronization sessions and content chunk distribution metadata.';
COMMENT ON COLUMN public.room_media_sessions.media_id IS 'Unique identifier for the media session.';
COMMENT ON COLUMN public.room_media_sessions.room_id IS 'Room identifier hosting this media session.';
COMMENT ON COLUMN public.room_media_sessions.owner_user_id IS 'User ID of the participant who initiated the media session.';
COMMENT ON COLUMN public.room_media_sessions.status IS 'Current streaming status (initializing, active, paused, ended).';
COMMENT ON COLUMN public.room_media_sessions.filename IS 'Original file name of the loaded media asset.';
COMMENT ON COLUMN public.room_media_sessions.mime_type IS 'MIME media type of the stream (e.g. video/mp4, audio/webm).';
COMMENT ON COLUMN public.room_media_sessions.byte_size IS 'Total byte size of the media file.';
COMMENT ON COLUMN public.room_media_sessions.duration_seconds IS 'Total runtime duration in seconds.';
COMMENT ON COLUMN public.room_media_sessions.codec IS 'Video and audio codec encoding descriptors.';
COMMENT ON COLUMN public.room_media_sessions.container IS 'Media container format (e.g. mp4, mkv, webm).';
COMMENT ON COLUMN public.room_media_sessions.content_hash IS 'Cryptographic hash validating chunk integrity.';
COMMENT ON COLUMN public.room_media_sessions.chunk_size IS 'Byte size of individual streaming chunks.';
COMMENT ON COLUMN public.room_media_sessions.total_chunks IS 'Total number of chunks comprising the complete media file.';
COMMENT ON COLUMN public.room_media_sessions.created_at IS 'Timestamp when the media session was initialized.';
COMMENT ON COLUMN public.room_media_sessions.expires_at IS 'Expiration timestamp for the media session cache.';

-- 17. room_messages
COMMENT ON TABLE public.room_messages IS 'Chat message history and system events within rooms.';
COMMENT ON COLUMN public.room_messages.id IS 'Unique identifier for the chat message.';
COMMENT ON COLUMN public.room_messages.room_id IS 'Room identifier where the message was sent.';
COMMENT ON COLUMN public.room_messages.user_id IS 'Sender user ID, or NULL for system broadcast messages.';
COMMENT ON COLUMN public.room_messages.message IS 'Text content of the chat message.';
COMMENT ON COLUMN public.room_messages.message_type IS 'Message classification (user message or system notification).';
COMMENT ON COLUMN public.room_messages.event_type IS 'Optional event classifier for system messages (join, leave, kick, media_change).';
COMMENT ON COLUMN public.room_messages.metadata IS 'Structured JSON metadata attached to the message.';
COMMENT ON COLUMN public.room_messages.created_at IS 'Timestamp when the message was sent.';
COMMENT ON COLUMN public.room_messages.updated_at IS 'Timestamp of any message edit.';
COMMENT ON COLUMN public.room_messages.client_message_id IS 'Client-generated UUID for optimistic UI deduplication.';
COMMENT ON COLUMN public.room_messages.is_deleted IS 'Soft deletion flag indicating whether the message was retracted.';
COMMENT ON COLUMN public.room_messages.deleted_at IS 'Timestamp when the message was deleted.';
COMMENT ON COLUMN public.room_messages.deleted_by IS 'User ID or moderator identity that deleted the message.';

-- 18. room_quota_events
COMMENT ON TABLE public.room_quota_events IS 'Audit log recording room quota checks, increments, and releases.';
COMMENT ON COLUMN public.room_quota_events.id IS 'Unique identifier for the quota event.';
COMMENT ON COLUMN public.room_quota_events.account_id IS 'User account ID whose room quota was evaluated.';
COMMENT ON COLUMN public.room_quota_events.room_id IS 'Room identifier associated with the quota event.';
COMMENT ON COLUMN public.room_quota_events.room_kind IS 'Category of room (watch, permanent).';
COMMENT ON COLUMN public.room_quota_events.event_type IS 'Quota transition type (allocated, released, rejected, adjusted).';
COMMENT ON COLUMN public.room_quota_events.created_at IS 'Timestamp when the quota event occurred.';
COMMENT ON COLUMN public.room_quota_events.metadata IS 'Snapshot of quota counters, tier limits, and evaluation details.';

-- 19. rooms
COMMENT ON TABLE public.rooms IS 'Authoritative watch party and persistent room session records.';
COMMENT ON COLUMN public.rooms."roomId" IS 'Unique alphanumeric identifier for the room.';
COMMENT ON COLUMN public.rooms."creationTime" IS 'Timestamp when the room was originally created.';
COMMENT ON COLUMN public.rooms.passcode IS 'Bcrypt hash of the room passcode for private room entry.';
COMMENT ON COLUMN public.rooms.owner_id IS 'Supabase auth user ID owning the room.';
COMMENT ON COLUMN public.rooms."isChatDisabled" IS 'Boolean flag indicating whether chat is disabled room-wide.';
COMMENT ON COLUMN public.rooms."isSubRoom" IS 'Boolean flag indicating breakout or sub-room status.';
COMMENT ON COLUMN public.rooms.data IS 'Flexible JSON payload for room settings, playlists, and state.';
COMMENT ON COLUMN public.rooms."lastUpdateTime" IS 'Timestamp of the latest room interaction or state sync.';
COMMENT ON COLUMN public.rooms."roomTitle" IS 'Display title of the room.';
COMMENT ON COLUMN public.rooms."roomDescription" IS 'Optional text summary or agenda for the room.';
COMMENT ON COLUMN public.rooms."mediaPath" IS 'Current active media stream URL or path.';
COMMENT ON COLUMN public.rooms.status IS 'Authoritative room lifecycle state (scheduled, active, inactive, expiring, expired, ended).';
COMMENT ON COLUMN public.rooms."startedAt" IS 'Timestamp when the room transitioned to active state.';
COMMENT ON COLUMN public.rooms."expiresAt" IS 'Scheduled expiration timestamp after which the room is automatically terminated.';
COMMENT ON COLUMN public.rooms."endedAt" IS 'Timestamp when the room was explicitly ended by the host.';
COMMENT ON COLUMN public.rooms."isPermanent" IS 'Whether this room is permanent (never expires) or temporary.';
COMMENT ON COLUMN public.rooms."coverPhoto" IS 'Public storage URL of the room cover image.';
COMMENT ON COLUMN public.rooms."lastActiveAt" IS 'Timestamp of the latest participant heartbeat or activity.';
COMMENT ON COLUMN public.rooms.owner_passcode IS 'Securely stored encrypted passcode accessible only to the room owner.';
COMMENT ON COLUMN public.rooms."scheduledStartsAt" IS 'Scheduled future start time for planned watch parties.';
COMMENT ON COLUMN public.rooms.passcode_fingerprint IS 'Cryptographic fingerprint of the passcode for rapid collision detection.';
COMMENT ON COLUMN public.rooms.room_kind IS 'Room classification type (watch, permanent).';
COMMENT ON COLUMN public.rooms.participants_locked IS 'Boolean flag indicating whether new participant joins are locked by host.';
COMMENT ON COLUMN public.rooms.max_participants IS 'Hard participant capacity ceiling enforced for this room.';
COMMENT ON COLUMN public.rooms.lifecycle_revision IS 'Optimistic concurrency revision counter for state transitions.';
COMMENT ON COLUMN public.rooms.schema_version IS 'Room state schema version for data migration compatibility.';
COMMENT ON COLUMN public.rooms."endingNotifiedAt" IS 'Timestamp when the 15-minute advance expiration notice was claimed and dispatched.';

-- 20. subscription_plans
COMMENT ON TABLE public.subscription_plans IS 'Authoritative product and tier catalog defining quota, capacity, and feature entitlements.';
COMMENT ON COLUMN public.subscription_plans.id IS 'Unique tier identifier (e.g. free, pro, permanent).';
COMMENT ON COLUMN public.subscription_plans.display_name IS 'Human-readable name of the plan tier.';
COMMENT ON COLUMN public.subscription_plans.description IS 'Marketing and feature description of the plan tier.';
COMMENT ON COLUMN public.subscription_plans.is_default IS 'Whether new user signups default to this plan.';
COMMENT ON COLUMN public.subscription_plans.max_total_rooms IS 'Maximum concurrent active rooms allowed under this plan.';
COMMENT ON COLUMN public.subscription_plans.max_watch_rooms IS 'Maximum concurrent watch party rooms allowed under this plan.';
COMMENT ON COLUMN public.subscription_plans.max_permanent_rooms IS 'Maximum permanent persistent rooms allowed under this plan.';
COMMENT ON COLUMN public.subscription_plans.max_participant_capacity IS 'Maximum participant capacity ceiling per room for this tier.';
COMMENT ON COLUMN public.subscription_plans.max_room_duration_hours IS 'Maximum active session duration in hours before automatic expiration.';
COMMENT ON COLUMN public.subscription_plans.is_vbrowser_allowed IS 'Whether virtual cloud browsers are unlocked for this tier.';
COMMENT ON COLUMN public.subscription_plans.max_vbrowser_concurrency IS 'Maximum concurrent virtual browsers allowed under this plan.';
COMMENT ON COLUMN public.subscription_plans.is_active IS 'Whether this plan tier is actively available for subscription.';
COMMENT ON COLUMN public.subscription_plans.created_at IS 'Timestamp when the plan tier was registered.';
COMMENT ON COLUMN public.subscription_plans.updated_at IS 'Timestamp of the latest tier configuration update.';

-- 21. vbrowser
COMMENT ON TABLE public.vbrowser IS 'Virtual browser cloud container instances, states, and connectivity endpoints.';
COMMENT ON COLUMN public.vbrowser.id IS 'Sequential numeric identifier for the VM container record.';
COMMENT ON COLUMN public.vbrowser.pool IS 'Name of the allocation pool hosting this VM (e.g. HetznerLargeUS).';
COMMENT ON COLUMN public.vbrowser.vmid IS 'Provider-specific VM container identifier.';
COMMENT ON COLUMN public.vbrowser.state IS 'Container provisioning state (staging, available, used, terminating).';
COMMENT ON COLUMN public.vbrowser."creationTime" IS 'Timestamp when the VM container was created.';
COMMENT ON COLUMN public.vbrowser."heartbeatTime" IS 'Timestamp of the latest heartbeat signal from the VM container.';
COMMENT ON COLUMN public.vbrowser."assignTime" IS 'Timestamp when the VM container was assigned to a room.';
COMMENT ON COLUMN public.vbrowser."roomId" IS 'Room identifier currently using this virtual browser.';
COMMENT ON COLUMN public.vbrowser.uid IS 'User ID of the participant controlling the virtual browser.';
COMMENT ON COLUMN public.vbrowser.data IS 'Provider connection endpoints, port mappings, and WebRTC candidate data.';
COMMENT ON COLUMN public.vbrowser.retries IS 'Counter tracking provisioning health-check retry attempts.';
COMMENT ON COLUMN public.vbrowser.pass IS 'Access credential for the remote Neko/vBrowser session.';
COMMENT ON COLUMN public.vbrowser.image IS 'Container image tag or snapshot ID deployed to this VM.';
COMMENT ON COLUMN public.vbrowser.provider_id IS 'Foreign key reference to vbrowser_providers.';
COMMENT ON COLUMN public.vbrowser.pool_id IS 'Foreign key reference to vbrowser_pools.';
COMMENT ON COLUMN public.vbrowser.expires_at IS 'Lease expiration timestamp for automatic VM reclamation.';
COMMENT ON COLUMN public.vbrowser.released_at IS 'Timestamp when the VM container was returned to the pool or terminated.';

-- 22. vbrowser_pools
COMMENT ON TABLE public.vbrowser_pools IS 'Virtual browser capacity pools partitioned by region, size, and provider.';
COMMENT ON COLUMN public.vbrowser_pools.id IS 'Unique identifier for the VM pool (e.g. hetzner-us-standard).';
COMMENT ON COLUMN public.vbrowser_pools.provider_id IS 'Reference to the cloud infrastructure provider hosting this pool.';
COMMENT ON COLUMN public.vbrowser_pools.region IS 'Cloud data center region code (e.g. us-east, eu-central).';
COMMENT ON COLUMN public.vbrowser_pools.is_large IS 'Whether this pool provides high-memory large VM instances.';
COMMENT ON COLUMN public.vbrowser_pools.min_size IS 'Target warm standby container pool size.';
COMMENT ON COLUMN public.vbrowser_pools.limit_size IS 'Maximum container pool capacity ceiling.';
COMMENT ON COLUMN public.vbrowser_pools.enabled IS 'Operational toggle enabling or disabling pool allocations.';
COMMENT ON COLUMN public.vbrowser_pools.config IS 'Pool-specific infrastructure configuration and scaling parameters.';
COMMENT ON COLUMN public.vbrowser_pools.created_at IS 'Timestamp when the pool was provisioned.';
COMMENT ON COLUMN public.vbrowser_pools.updated_at IS 'Timestamp of the latest pool configuration update.';
COMMENT ON COLUMN public.vbrowser_pools.lifecycle IS 'Pool management lifecycle mode (static, autoscale, drain).';
COMMENT ON COLUMN public.vbrowser_pools.max_sessions_per_user IS 'Maximum concurrent VM sessions per user in this pool.';
COMMENT ON COLUMN public.vbrowser_pools.max_sessions_per_room IS 'Maximum concurrent VM sessions per room in this pool.';
COMMENT ON COLUMN public.vbrowser_pools.max_large_sessions IS 'Cap on large VM sessions concurrently active in this pool.';
COMMENT ON COLUMN public.vbrowser_pools.max_session_duration_seconds IS 'Maximum session lease duration in seconds.';
COMMENT ON COLUMN public.vbrowser_pools.max_large_session_duration_seconds IS 'Maximum large session lease duration in seconds.';

-- 23. vbrowser_providers
COMMENT ON TABLE public.vbrowser_providers IS 'Cloud VM infrastructure providers and API credentials.';
COMMENT ON COLUMN public.vbrowser_providers.id IS 'Provider identifier (e.g. hetzner, azure, digitalocean).';
COMMENT ON COLUMN public.vbrowser_providers.display_name IS 'Human-readable name of the cloud provider.';
COMMENT ON COLUMN public.vbrowser_providers.provider_type IS 'Provider driver implementation (hetzner, azure, docker_local).';
COMMENT ON COLUMN public.vbrowser_providers.enabled IS 'Operational toggle enabling or disabling this provider.';
COMMENT ON COLUMN public.vbrowser_providers.config IS 'Encrypted API credentials, endpoint URLs, and resource groups.';
COMMENT ON COLUMN public.vbrowser_providers.created_at IS 'Timestamp when the provider was configured.';
COMMENT ON COLUMN public.vbrowser_providers.updated_at IS 'Timestamp of the latest provider credential or setting update.';
COMMENT ON COLUMN public.vbrowser_providers.lifecycle IS 'Provider operational state (active, degraded, disabled).';
COMMENT ON COLUMN public.vbrowser_providers.max_concurrent_sessions IS 'Global concurrency ceiling across all pools on this provider.';
COMMENT ON COLUMN public.vbrowser_providers.max_sessions_per_user IS 'Per-user concurrency cap across this provider.';
COMMENT ON COLUMN public.vbrowser_providers.max_sessions_per_room IS 'Per-room concurrency cap across this provider.';
COMMENT ON COLUMN public.vbrowser_providers.max_large_sessions IS 'Large instance concurrency limit across this provider.';
COMMENT ON COLUMN public.vbrowser_providers.max_session_duration_seconds IS 'Maximum VM session duration permitted by this provider.';
COMMENT ON COLUMN public.vbrowser_providers.max_large_session_duration_seconds IS 'Maximum large VM session duration permitted by this provider.';

-- 24. vbrowser_reservations
COMMENT ON TABLE public.vbrowser_reservations IS 'Ephemeral virtual browser lease reservations and lifecycle state machines.';
COMMENT ON COLUMN public.vbrowser_reservations.id IS 'Unique identifier for the reservation request.';
COMMENT ON COLUMN public.vbrowser_reservations.provider_id IS 'Target cloud provider executing the reservation.';
COMMENT ON COLUMN public.vbrowser_reservations.pool_id IS 'Target pool fulfilling the reservation.';
COMMENT ON COLUMN public.vbrowser_reservations.room_id IS 'Room identifier requesting the virtual browser.';
COMMENT ON COLUMN public.vbrowser_reservations.user_id IS 'User identifier requesting the virtual browser.';
COMMENT ON COLUMN public.vbrowser_reservations.is_large IS 'Whether a large instance was requested.';
COMMENT ON COLUMN public.vbrowser_reservations.status IS 'Reservation lifecycle state (pending, assigned, active, released, failed).';
COMMENT ON COLUMN public.vbrowser_reservations.assigned_at IS 'Timestamp when a VM container was assigned to this reservation.';
COMMENT ON COLUMN public.vbrowser_reservations.heartbeat_at IS 'Timestamp of the latest active session heartbeat.';
COMMENT ON COLUMN public.vbrowser_reservations.expires_at IS 'Scheduled lease expiration timestamp.';
COMMENT ON COLUMN public.vbrowser_reservations.released_at IS 'Timestamp when the reservation concluded.';
COMMENT ON COLUMN public.vbrowser_reservations.failure_reason IS 'Error description if VM provisioning failed.';
COMMENT ON COLUMN public.vbrowser_reservations.operation_id IS 'Idempotency tracking identifier for the allocation operation.';
COMMENT ON COLUMN public.vbrowser_reservations.vmid IS 'Container VM identifier assigned to fulfill the reservation.';
COMMENT ON COLUMN public.vbrowser_reservations.created_at IS 'Timestamp when the reservation was initiated.';

-- 25. webhook_events
COMMENT ON TABLE public.webhook_events IS 'Inbound delivery webhook event ledger for idempotency and status synchronization.';
COMMENT ON COLUMN public.webhook_events.id IS 'Unique identifier for the webhook event record.';
COMMENT ON COLUMN public.webhook_events.provider IS 'Originating service provider (e.g. resend, brevo).';
COMMENT ON COLUMN public.webhook_events.event_id IS 'Upstream event identifier used for deduplication.';
COMMENT ON COLUMN public.webhook_events.event_type IS 'Webhook event type (delivered, bounced, complained, opened, clicked).';
COMMENT ON COLUMN public.webhook_events.received_at IS 'Timestamp when the webhook HTTP payload was received.';
COMMENT ON COLUMN public.webhook_events.processed_at IS 'Timestamp when the event handler finished processing the event.';
