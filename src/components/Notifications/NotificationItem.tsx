/**
 * NOTIFY-001 NotificationItem Component
 */

import React from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  IconMail,
  IconUserCheck,
  IconPlayerPlay,
  IconPlayerStop,
  IconAlertTriangle,
  IconSpeakerphone,
  IconDoorEnter,
} from '@tabler/icons-react';
import type { NotificationItem as NotificationItemType } from './notificationTypes';
import styles from './NotificationItem.module.css';

dayjs.extend(relativeTime);

interface NotificationItemProps {
  notification: NotificationItemType;
  onMarkRead: (id: string) => void;
  onClosePanel?: () => void;
}

export const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkRead,
  onClosePanel,
}) => {
  const isUnread = !notification.read_at;

  const handleClick = () => {
    if (isUnread) {
      onMarkRead(notification.id);
    }
  };

  const renderIcon = () => {
    switch (notification.type) {
      case 'ROOM_INVITATION':
        return (
          <div className={styles.iconWrapper}>
            <IconMail size={18} stroke={1.75} />
          </div>
        );
      case 'ROOM_HOST_TRANSFER':
        return (
          <div className={styles.iconWrapper}>
            <IconUserCheck size={18} stroke={1.75} />
          </div>
        );
      case 'ROOM_STARTED':
        return (
          <div className={styles.iconWrapper}>
            <IconPlayerPlay size={18} stroke={1.75} />
          </div>
        );
      case 'ROOM_ENDING':
        return (
          <div className={`${styles.iconWrapper} ${styles.iconWarning}`}>
            <IconAlertTriangle size={18} stroke={1.75} />
          </div>
        );
      case 'ROOM_ENDED':
        return (
          <div className={styles.iconWrapper}>
            <IconPlayerStop size={18} stroke={1.75} />
          </div>
        );
      case 'MODERATION_ACTION':
        return (
          <div className={`${styles.iconWrapper} ${styles.iconModeration}`}>
            <IconAlertTriangle size={18} stroke={1.75} />
          </div>
        );
      case 'VBROWSER_FAILURE':
        return (
          <div className={`${styles.iconWrapper} ${styles.iconWarning}`}>
            <IconAlertTriangle size={18} stroke={1.75} />
          </div>
        );
      case 'SYSTEM_ANNOUNCEMENT':
      default:
        return (
          <div className={`${styles.iconWrapper} ${styles.iconSystem}`}>
            <IconSpeakerphone size={18} stroke={1.75} />
          </div>
        );
    }
  };

  const roomId = notification.metadata?.roomId as string | undefined;
  const timeFormatted = dayjs(notification.created_at).fromNow();

  return (
    <div
      className={`${styles.item} ${isUnread ? styles.unread : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick();
        }
      }}
    >
      {renderIcon()}
      <div className={styles.content}>
        <div className={styles.headerRow}>
          <div className={styles.title}>{notification.title}</div>
          <div className={styles.time}>{timeFormatted}</div>
        </div>
        <div className={styles.body}>{notification.body}</div>
        {roomId && (
          <Link
            to={`/room/${encodeURIComponent(roomId)}`}
            className={styles.actionLink}
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
              if (onClosePanel) onClosePanel();
            }}
          >
            <IconDoorEnter size={14} /> Join Room
          </Link>
        )}
      </div>
      {isUnread && <div className={styles.unreadDot} />}
    </div>
  );
};
