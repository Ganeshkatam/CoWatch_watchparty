/**
 * NOTIFY-003B Canonical Notification Action Resolver
 *
 * This module is the single client authority for resolving the actionable
 * behavior, label, and navigation URL for any notification.
 *
 * It guarantees that:
 *   1. No notification action is inferred from roomId alone.
 *   2. Expired rooms and moderation events (kick/ban) never render "Join Room".
 *   3. metadata.action is authoritative, with robust fallback for legacy items.
 */

export interface NotificationActionSource {
  id?: string;
  user_id?: string;
  type: string;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  read_at?: string | null;
  expires_at?: string | null;
  event_id?: string;
}

export type NotificationActionType = 'open_room' | 'join_room' | 'go_home' | 'dismiss';

export interface ResolvedNotificationAction {
  action: NotificationActionType;
  label: string;
  url?: string;
}

export function resolveNotificationAction(notification: NotificationActionSource): ResolvedNotificationAction {
  const metadata = notification.metadata || {};
  const explicitAction = typeof metadata.action === 'string' ? (metadata.action as NotificationActionType) : undefined;
  const rawRoomId = typeof metadata.roomId === 'string' ? metadata.roomId.trim() : undefined;
  const cleanRoomId = rawRoomId ? encodeURIComponent(rawRoomId) : undefined;
  const explicitTargetUrl = typeof metadata.targetUrl === 'string' ? metadata.targetUrl.trim() : undefined;

  // 1. Authoritative explicit action in metadata
  if (explicitAction) {
    switch (explicitAction) {
      case 'go_home':
        return {
          action: 'go_home',
          label: 'Go Home',
          url: explicitTargetUrl || '/home',
        };
      case 'join_room':
        return {
          action: 'join_room',
          label: 'Join Room',
          url: explicitTargetUrl || (cleanRoomId ? `/room/${cleanRoomId}` : '/home'),
        };
      case 'open_room':
        return {
          action: 'open_room',
          label: 'Open Room',
          url: explicitTargetUrl || (cleanRoomId ? `/room/${cleanRoomId}` : '/home'),
        };
      case 'dismiss':
        return {
          action: 'dismiss',
          label: 'Dismiss',
          url: explicitTargetUrl,
        };
    }
  }

  // 2. Safe fallback for legacy/unversioned notifications
  switch (notification.type) {
    case 'ROOM_ENDED':
    case 'MODERATION_ACTION':
      return {
        action: 'go_home',
        label: 'Go Home',
        url: '/home',
      };

    case 'ROOM_INVITATION':
      return {
        action: 'join_room',
        label: 'Join Room',
        url: cleanRoomId ? `/room/${cleanRoomId}` : '/home',
      };

    case 'ROOM_STARTED':
    case 'ROOM_HOST_TRANSFER':
    case 'ROOM_ENDING':
    case 'VBROWSER_FAILURE':
      return {
        action: 'open_room',
        label: 'Open Room',
        url: cleanRoomId ? `/room/${cleanRoomId}` : '/home',
      };

    case 'SYSTEM_ANNOUNCEMENT':
    default: {
      const ctaUrl = typeof metadata.ctaUrl === 'string' ? metadata.ctaUrl.trim() : undefined;
      const ctaLabel = typeof metadata.ctaLabel === 'string' ? metadata.ctaLabel.trim() : 'Dismiss';
      if (ctaUrl) {
        return {
          action: 'open_room',
          label: ctaLabel,
          url: ctaUrl,
        };
      }
      return {
        action: 'dismiss',
        label: 'Dismiss',
      };
    }
  }
}
