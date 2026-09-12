import React, { useState, useEffect, useCallback } from "react";
import { Switch, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { serverPath } from "../../utils/utils";
import { getAccessToken } from "../../utils/supabaseClient";
import type { NotificationPreferences } from "../Notifications/notificationTypes";
import styles from "./Profile.module.css";

export const NotificationPreferencesSection: React.FC = () => {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await fetch(`${serverPath}/api/notifications/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setPreferences(data.preferences);
      }
    } catch (err) {
      console.warn("Failed to fetch notification preferences:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!preferences) return;

    // Optimistic update
    const previous = { ...preferences };
    setPreferences((prev) => (prev ? { ...prev, [key]: value } : null));
    setSavingKey(key);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("No session token");

      const res = await fetch(`${serverPath}/api/notifications/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: value }),
      });

      if (res.ok) {
        const data = await res.json();
        setPreferences(data.preferences);
        notifications.show({
          title: "Preference Saved",
          message: "Notification preference successfully updated.",
          color: "violet",
          icon: <IconCheck size={16} />,
          autoClose: 2000,
        });
      } else {
        throw new Error("Failed to persist preference");
      }
    } catch (err) {
      // Revert optimistic update
      setPreferences(previous);
      notifications.show({
        title: "Update Failed",
        message: "Could not save notification preference. Please try again.",
        color: "red",
        icon: <IconX size={16} />,
        autoClose: 3500,
      });
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.settingsSection} style={{ textAlign: "center", padding: "32px 0" }}>
        <Loader size="sm" color="violet" />
      </div>
    );
  }

  const emailEnabled = preferences?.email_enabled ?? true;
  const roomInvitations = preferences?.room_invitations ?? true;
  const roomEvents = preferences?.room_events ?? false;
  const moderationEvents = preferences?.moderation_events ?? false;
  const systemAnnouncements = preferences?.system_announcements ?? true;

  return (
    <div className={styles.settingsSection}>
      <h3 className={styles.settingsSectionTitle}>Email Notifications</h3>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>Transactional Email Delivery</span>
          <span className={styles.settingDescription}>
            Master toggle for email notifications. In-app notifications will always be delivered to your inbox.
          </span>
        </div>
        <div className={styles.settingAction}>
          <Switch
            size="md"
            color="violet"
            checked={emailEnabled}
            disabled={savingKey === "email_enabled"}
            onChange={(e) => handleToggle("email_enabled", e.currentTarget.checked)}
          />
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>Room Invitations</span>
          <span className={styles.settingDescription}>
            Receive email when friends invite you to a watch party room.
          </span>
        </div>
        <div className={styles.settingAction}>
          <Switch
            size="md"
            color="violet"
            checked={emailEnabled && roomInvitations}
            disabled={!emailEnabled || savingKey === "room_invitations"}
            onChange={(e) => handleToggle("room_invitations", e.currentTarget.checked)}
          />
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>Room Status &amp; Lifecycle</span>
          <span className={styles.settingDescription}>
            Receive email when rooms you host or follow are starting, ending, or reaching capacity.
          </span>
        </div>
        <div className={styles.settingAction}>
          <Switch
            size="md"
            color="violet"
            checked={emailEnabled && roomEvents}
            disabled={!emailEnabled || savingKey === "room_events"}
            onChange={(e) => handleToggle("room_events", e.currentTarget.checked)}
          />
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>Moderation &amp; Safety</span>
          <span className={styles.settingDescription}>
            Receive email alerts for host reassignments, kicks, bans, or room policy updates.
          </span>
        </div>
        <div className={styles.settingAction}>
          <Switch
            size="md"
            color="violet"
            checked={emailEnabled && moderationEvents}
            disabled={!emailEnabled || savingKey === "moderation_events"}
            onChange={(e) => handleToggle("moderation_events", e.currentTarget.checked)}
          />
        </div>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>System Announcements</span>
          <span className={styles.settingDescription}>
            Important platform maintenance notices and security advisories.
          </span>
        </div>
        <div className={styles.settingAction}>
          <Switch
            size="md"
            color="violet"
            checked={emailEnabled && systemAnnouncements}
            disabled={!emailEnabled || savingKey === "system_announcements"}
            onChange={(e) => handleToggle("system_announcements", e.currentTarget.checked)}
          />
        </div>
      </div>
    </div>
  );
};
