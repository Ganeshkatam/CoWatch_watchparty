/**
 * NOTIFY-001 NotificationPanel Component
 */

import React, { useState } from 'react';
import {
  ActionIcon,
  Tooltip,
  Skeleton,
  Button,
} from '@mantine/core';
import {
  IconChecks,
  IconSettings,
  IconBellOff,
} from '@tabler/icons-react';
import type {
  NotificationItem as NotificationItemType,
  NotificationPreferences,
} from './notificationTypes';
import { NotificationItem } from './NotificationItem';
import { NotificationPreferencesModal } from './NotificationPreferences';
import styles from './NotificationPanel.module.css';

interface NotificationPanelProps {
  notifications: NotificationItemType[];
  unreadCount: number;
  isLoading: boolean;
  preferences: NotificationPreferences | null;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onUpdatePreferences: (patch: Partial<NotificationPreferences>) => Promise<boolean>;
  onClose?: () => void;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  notifications,
  unreadCount,
  isLoading,
  preferences,
  onMarkRead,
  onMarkAllRead,
  onUpdatePreferences,
  onClose,
}) => {
  const [prefsOpen, setPrefsOpen] = useState(false);

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            Notifications
            {unreadCount > 0 && (
              <span className={styles.badge}>{unreadCount}</span>
            )}
          </div>
          <div className={styles.actions}>
            {unreadCount > 0 && (
              <Tooltip label="Mark all as read" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="violet"
                  size="sm"
                  onClick={onMarkAllRead}
                  aria-label="Mark all as read"
                >
                  <IconChecks size={16} stroke={1.75} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Notification settings" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => setPrefsOpen(true)}
                aria-label="Notification settings"
              >
                <IconSettings size={16} stroke={1.75} />
              </ActionIcon>
            </Tooltip>
          </div>
        </div>

        <div className={styles.list}>
          {isLoading && notifications.length === 0 ? (
            <div className={styles.loadingWrapper}>
              <Skeleton height={50} radius="md" />
              <Skeleton height={50} radius="md" />
              <Skeleton height={50} radius="md" />
            </div>
          ) : notifications.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <IconBellOff size={22} stroke={1.5} />
              </div>
              <div className={styles.emptyText}>No notifications yet</div>
              <div className={styles.emptySubtext}>
                You will see invitations, room events, and important updates here.
              </div>
            </div>
          ) : (
            notifications.map((notif) => (
              <NotificationItem
                key={notif.id}
                notification={notif}
                onMarkRead={onMarkRead}
                onClosePanel={onClose}
              />
            ))
          )}
        </div>
      </div>

      <NotificationPreferencesModal
        opened={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        preferences={preferences}
        onUpdate={onUpdatePreferences}
      />
    </>
  );
};
