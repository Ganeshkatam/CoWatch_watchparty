/**
 * NOTIFY-001 NotificationPreferences Modal
 *
 * Provides granular user toggles for transactional email notifications.
 */

import React, { useState } from 'react';
import {
  Modal,
  Switch,
  Stack,
  Group,
  Text,
  Divider,
  Button,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import type { NotificationPreferences as PreferencesType } from './notificationTypes';

interface NotificationPreferencesModalProps {
  opened: boolean;
  onClose: () => void;
  preferences: PreferencesType | null;
  onUpdate: (patch: Partial<PreferencesType>) => Promise<boolean>;
}

export const NotificationPreferencesModal: React.FC<NotificationPreferencesModalProps> = ({
  opened,
  onClose,
  preferences,
  onUpdate,
}) => {
  const [isSaving, setIsSaving] = useState(false);

  const handleToggle = async (key: keyof PreferencesType, value: boolean) => {
    setIsSaving(true);
    const success = await onUpdate({ [key]: value });
    setIsSaving(false);

    if (success) {
      notifications.show({
        title: 'Preferences Updated',
        message: 'Your notification delivery settings have been saved.',
        color: 'violet',
        icon: <IconCheck size={16} />,
        autoClose: 2500,
      });
    } else {
      notifications.show({
        title: 'Update Failed',
        message: 'Could not save notification preferences. Please try again.',
        color: 'red',
        icon: <IconX size={16} />,
        autoClose: 3500,
      });
    }
  };

  const emailEnabled = preferences?.email_enabled ?? true;
  const roomInvitations = preferences?.room_invitations ?? true;
  const roomEvents = preferences?.room_events ?? false;
  const moderationEvents = preferences?.moderation_events ?? false;
  const systemAnnouncements = preferences?.system_announcements ?? true;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Notification Preferences"
      centered
      radius="md"
      size="md"
      overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Choose which notifications you receive by email. In-app notifications will always be
          delivered to your notification inbox.
        </Text>

        <Group justify="space-between" align="center">
          <div>
            <Text size="sm" fw={600}>
              Email Notifications
            </Text>
            <Text size="xs" c="dimmed">
              Master switch for transactional email delivery
            </Text>
          </div>
          <Switch
            checked={emailEnabled}
            disabled={isSaving}
            onChange={(e) => handleToggle('email_enabled', e.currentTarget.checked)}
            color="violet"
            size="md"
          />
        </Group>

        <Divider my="xs" label="Categories" labelPosition="center" />

        <Group justify="space-between" align="center">
          <div>
            <Text size="sm" fw={500}>
              Room Invitations
            </Text>
            <Text size="xs" c="dimmed">
              Receive an email when someone invites you to a room
            </Text>
          </div>
          <Switch
            checked={roomInvitations}
            disabled={!emailEnabled || isSaving}
            onChange={(e) => handleToggle('room_invitations', e.currentTarget.checked)}
            color="violet"
          />
        </Group>

        <Group justify="space-between" align="center">
          <div>
            <Text size="sm" fw={500}>
              Room Events
            </Text>
            <Text size="xs" c="dimmed">
              Emails when your rooms start, expire, or host changes
            </Text>
          </div>
          <Switch
            checked={roomEvents}
            disabled={!emailEnabled || isSaving}
            onChange={(e) => handleToggle('room_events', e.currentTarget.checked)}
            color="violet"
          />
        </Group>

        <Group justify="space-between" align="center">
          <div>
            <Text size="sm" fw={500}>
              Moderation Notices
            </Text>
            <Text size="xs" c="dimmed">
              Emails regarding room kicks, bans, or warnings
            </Text>
          </div>
          <Switch
            checked={moderationEvents}
            disabled={!emailEnabled || isSaving}
            onChange={(e) => handleToggle('moderation_events', e.currentTarget.checked)}
            color="violet"
          />
        </Group>

        <Group justify="space-between" align="center">
          <div>
            <Text size="sm" fw={500}>
              System Announcements
            </Text>
            <Text size="xs" c="dimmed">
              Important service announcements and updates from CoWatch
            </Text>
          </div>
          <Switch
            checked={systemAnnouncements}
            disabled={!emailEnabled || isSaving}
            onChange={(e) => handleToggle('system_announcements', e.currentTarget.checked)}
            color="violet"
          />
        </Group>

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
