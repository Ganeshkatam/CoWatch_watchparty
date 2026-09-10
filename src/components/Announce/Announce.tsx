import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ActionIcon, Badge, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconExternalLink,
  IconInfoCircle,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import {
  AppAnnouncement,
  AnnouncementLevel,
  dismissAnnouncement,
  fetchAnnouncements,
  isAnnouncementDismissed,
  isValidActionUrl,
  sortAnnouncements,
} from "../../utils/announcements";
import styles from "./Announce.module.css";

const LEVEL_ICONS: Record<AnnouncementLevel, React.ReactElement> = {
  info: <IconInfoCircle size={18} />,
  success: <IconSparkles size={18} />,
  warning: <IconAlertTriangle size={18} />,
  critical: <IconAlertCircle size={18} />,
};

const LEVEL_BADGES: Record<AnnouncementLevel, { label: string; color: string }> = {
  info: { label: "Announcement", color: "violet" },
  success: { label: "Update", color: "teal" },
  warning: { label: "Notice", color: "yellow" },
  critical: { label: "Critical", color: "red" },
};

const LEVEL_STYLES: Record<AnnouncementLevel, string> = {
  info: styles.levelInfo,
  success: styles.levelSuccess,
  warning: styles.levelWarning,
  critical: styles.levelCritical,
};

export const Announce: React.FC = () => {
  const [announcement, setAnnouncement] = useState<AppAnnouncement | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadAnnouncements = async () => {
      try {
        const items = await fetchAnnouncements();
        if (!isMounted) return;

        // Filter out items dismissed for their current version
        const visible = items.filter((item) => !isAnnouncementDismissed(item));
        if (visible.length > 0) {
          const sorted = sortAnnouncements(visible);
          setAnnouncement(sorted[0]);
        }
      } catch (err) {
        console.warn("Failed to load in-app announcements:", err);
      }
    };

    loadAnnouncements();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (!announcement) return;
    setIsDismissing(true);
    dismissAnnouncement(announcement);
    // Smooth transition before completely removing from DOM
    setTimeout(() => {
      setAnnouncement(null);
      setIsDismissing(false);
    }, 200);
  }, [announcement]);

  if (!announcement) {
    return null;
  }

  const level = announcement.level || "info";
  const badgeInfo = LEVEL_BADGES[level] || LEVEL_BADGES.info;
  const levelClass = LEVEL_STYLES[level] || styles.levelInfo;
  const hasValidAction =
    Boolean(announcement.action_label) && isValidActionUrl(announcement.action_url);

  return (
    <aside
      className={`${styles.banner} ${levelClass} ${isDismissing ? styles.dismissing : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className={styles.contentWrapper}>
        <div className={styles.iconWrap}>{LEVEL_ICONS[level]}</div>
        <Badge size="xs" color={badgeInfo.color} variant="light" radius="sm">
          {badgeInfo.label}
        </Badge>
        <div className={styles.textGroup}>
          <Text size="xs" fw={600} className={styles.title}>
            {announcement.title}
          </Text>
          <Text size="xs" className={styles.body}>
            {announcement.body}
          </Text>
        </div>
      </div>

      <div className={styles.actionsGroup}>
        {hasValidAction && announcement.action_url && (
          announcement.action_url.startsWith("/") ? (
            <Link to={announcement.action_url} className={styles.actionBtn}>
              <span>{announcement.action_label}</span>
              <IconArrowRight size={13} />
            </Link>
          ) : (
            <a
              href={announcement.action_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.actionBtn}
            >
              <span>{announcement.action_label}</span>
              <IconExternalLink size={13} />
            </a>
          )
        )}
        <ActionIcon
          size="sm"
          variant="subtle"
          onClick={handleDismiss}
          className={styles.dismissBtn}
          aria-label="Dismiss announcement"
          title="Dismiss announcement"
        >
          <IconX size={15} />
        </ActionIcon>
      </div>
    </aside>
  );
};

export default Announce;
