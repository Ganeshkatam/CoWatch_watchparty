/**
 * NOTIFY-001 useNotifications Hook
 *
 * Provides real-time notification synchronization, unread tracking,
 * mark-read mutations, and preference controls.
 *
 * Invariants:
 *   - Authentication token is sent via Socket.IO handshake auth object: { token }
 *   - Query-string authentication is never used.
 *   - State reconciliation occurs on socket connect / reconnect.
 *   - No notification data is ever saved to localStorage.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { serverPath, apiFetch } from '../../utils/utils';
import { getAccessToken } from '../../utils/supabaseClient';
import type { User } from '@supabase/supabase-js';
import type {
  NotificationItem,
  NotificationPreferences,
  NotificationListResponse,
  UnreadCountResponse,
  PreferencesResponse,
} from './notificationTypes';

export function useNotifications(user: User | null | undefined) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // ---------------------------------------------------------------------------
  // REST API Helpers
  // ---------------------------------------------------------------------------

  const fetchInbox = useCallback(async () => {
    if (!user || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);

    try {
      const [inboxData, unreadData] = await Promise.all([
        apiFetch<NotificationListResponse>('/api/notifications?limit=30', { requireAuth: true }),
        apiFetch<UnreadCountResponse>('/api/notifications/unread-count', { requireAuth: true }),
      ]);

      if (inboxData) {
        setNotifications(inboxData.notifications || []);
      }
      if (unreadData) {
        setUnreadCount(unreadData.count ?? 0);
      }
      setError(null);
    } catch (err) {
      console.warn('[useNotifications] Failed to reconcile inbox:', err);
      setError('Failed to load notifications');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [user]);

  const fetchPreferences = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<PreferencesResponse>('/api/notifications/preferences', { requireAuth: true });
      if (data?.preferences) {
        setPreferences(data.preferences);
      }
    } catch (err) {
      console.warn('[useNotifications] Failed to load preferences:', err);
    }
  }, [user]);

  const updatePreferences = useCallback(
    async (patch: Partial<NotificationPreferences>): Promise<boolean> => {
      if (!user) return false;
      try {
        const data = await apiFetch<PreferencesResponse>('/api/notifications/preferences', {
          method: 'PUT',
          requireAuth: true,
          body: patch,
        });

        if (data?.preferences) {
          setPreferences(data.preferences);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[useNotifications] Failed to update preferences:', err);
        return false;
      }
    },
    [user],
  );

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!user) return;
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));

      try {
        await apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
          method: 'POST',
          requireAuth: true,
        });
      } catch (err) {
        console.warn('[useNotifications] Failed to mark notification read:', err);
        // Reconcile on failure
        fetchInbox();
      }
    },
    [user, fetchInbox],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    // Optimistic update
    const nowIso = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? nowIso })));
    setUnreadCount(0);

    try {
      await apiFetch('/api/notifications/read-all', {
        method: 'POST',
        requireAuth: true,
      });
    } catch (err) {
      console.warn('[useNotifications] Failed to mark all notifications read:', err);
      fetchInbox();
    }
  }, [user, fetchInbox]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (!user) return;
      // Optimistic update
      setNotifications((prev) => {
        const target = prev.find((n) => n.id === notificationId);
        if (target && !target.read_at) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }
        return prev.filter((n) => n.id !== notificationId);
      });

      try {
        await apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}`, {
          method: 'DELETE',
          requireAuth: true,
        });
      } catch (err) {
        console.warn('[useNotifications] Failed to delete notification:', err);
        fetchInbox();
      }
    },
    [user, fetchInbox],
  );

  const clearAll = useCallback(async () => {
    if (!user) return;
    // Optimistic update
    setNotifications([]);
    setUnreadCount(0);

    try {
      await apiFetch('/api/notifications/clear-all', {
        method: 'DELETE',
        requireAuth: true,
      });
    } catch (err) {
      console.warn('[useNotifications] Failed to clear notifications:', err);
      fetchInbox();
    }
  }, [user, fetchInbox]);

  // ---------------------------------------------------------------------------
  // Realtime Socket.IO Connection & Reconnection Lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setNotifications([]);
      setUnreadCount(0);
      setPreferences(null);
      return;
    }

    let isDisposed = false;

    async function initSocket() {
      const token = await getAccessToken();
      if (!token || isDisposed) return;

      // Connect strictly via handshake auth token
      const namespaceUrl = `${serverPath.replace(/\/+$/, '')}/notifications`;
      const socket = io(namespaceUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        // Reconcile on connect and every reconnection
        fetchInbox();
      });

      socket.on('notification:created', (newNotif: NotificationItem) => {
        setNotifications((prev) => {
          // Avoid duplicate insertions
          if (prev.some((n) => n.id === newNotif.id)) return prev;
          return [newNotif, ...prev];
        });
        if (!newNotif.read_at) {
          setUnreadCount((c) => c + 1);
        }
      });

      socket.on('notification:read', (data: { id: string }) => {
        setNotifications((prev) =>
          prev.map((n) => (n.id === data.id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      });

      socket.on('notifications:read-all', () => {
        const nowIso = new Date().toISOString();
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? nowIso })));
        setUnreadCount(0);
      });

      socket.on('notification:deleted', (data: { id: string }) => {
        setNotifications((prev) => {
          const target = prev.find((n) => n.id === data.id);
          if (target && !target.read_at) {
            setUnreadCount((c) => Math.max(0, c - 1));
          }
          return prev.filter((n) => n.id !== data.id);
        });
      });

      socket.on('notifications:cleared', () => {
        setNotifications([]);
        setUnreadCount(0);
      });

      socket.on('connect_error', (err) => {
        console.debug('[useNotifications] Socket connection error:', err.message);
      });
    }

    initSocket();
    fetchInbox();
    fetchPreferences();

    return () => {
      isDisposed = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [user, fetchInbox, fetchPreferences]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    preferences,
    markRead,
    markAllRead,
    deleteNotification,
    clearAll,
    refresh: fetchInbox,
    fetchPreferences,
    updatePreferences,
  };
}
