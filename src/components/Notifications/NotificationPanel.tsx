/**
 * NOTIFY-001 NotificationPanel Component
 */

import React, { useState } from 'react';
import {
  ActionIcon,
  Tooltip,
  Skeleton,
  Button,
  Modal,
  Text,
  Group,
} from '@mantine/core';
import {
  IconChecks,
  IconSettings,
  IconBellOff,
  IconTrash,
} from '@tabler/icons-react';
import type {
  NotificationItem as NotificationItemType,
  NotificationPreferences,
} from './notificationTypes';
import { NotificationItem } from './NotificationItem';
import { useHistory } from 'react-router-dom';
import { MODAL_SIZES } from '../../utils/designSystem';
import styles from './NotificationPanel.module.css';

interface NotificationPanelProps {
  notifications: NotificationItemType[];
  unreadCount: number;
  isLoading: boolean;
  preferences: NotificationPreferences | null;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDeleteNotification?: (id: string) => void;
  onClearAll?: () => void;
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
  onDeleteNotification,
  onClearAll,
  onUpdatePreferences,
  onClose,
}) => {
  const history = useHistory();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const handleSettingsClick = () => {
    if (onClose) onClose();
    history.push("/account/preferences");
  };

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
            {onClearAll && notifications.length > 0 && (
              <Tooltip label="Clear all notifications" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={() => setConfirmClearOpen(true)}
                  aria-label="Clear all notifications"
                >
                  <IconTrash size={16} stroke={1.75} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Notification settings" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleSettingsClick}
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
                onDelete={onDeleteNotification}
                onClosePanel={onClose}
              />
            ))
          )}
        </div>
      </div>

      <Modal
        opened={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear all notifications"
        centered
        size={MODAL_SIZES.sm}
        zIndex={1100}
      >
        <Text size="sm" c="dimmed" mb="lg">
          Are you sure you want to delete all notifications? This action cannot be undone.
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" size="xs" onClick={() => setConfirmClearOpen(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            size="xs"
            onClick={() => {
              setConfirmClearOpen(false);
              if (onClearAll) onClearAll();
            }}
          >
            Clear all
          </Button>
        </Group>
      </Modal>
    </>
  );
};
