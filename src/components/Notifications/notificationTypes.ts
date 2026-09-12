/**
 * NOTIFY-001 Client Notification Types
 */

export type NotificationType =
  | 'ROOM_INVITATION'
  | 'ROOM_HOST_TRANSFER'
  | 'ROOM_STARTED'
  | 'ROOM_ENDING'
  | 'ROOM_ENDED'
  | 'MODERATION_ACTION'
  | 'VBROWSER_FAILURE'
  | 'SYSTEM_ANNOUNCEMENT';

export interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  expires_at: string | null;
  event_id: string;
}

export interface NotificationPreferences {
  user_id: string;
  email_enabled: boolean;
  room_invitations: boolean;
  room_events: boolean;
  moderation_events: boolean;
  system_announcements: boolean;
  updated_at: string;
}

export interface NotificationListResponse {
  notifications: NotificationItem[];
}

export interface UnreadCountResponse {
  count: number;
}

export interface PreferencesResponse {
  preferences: NotificationPreferences;
}
