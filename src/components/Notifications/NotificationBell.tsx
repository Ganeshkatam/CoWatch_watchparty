/**
 * NOTIFY-001 NotificationBell Component
 *
 * Renders the top-bar notification bell with unread badge and popover dropdown.
 */

import React, { useState, useContext } from 'react';
import { Popover, ActionIcon, Tooltip, Indicator } from '@mantine/core';
import { IconBell, IconBellFilled } from '@tabler/icons-react';
import { MetadataContext } from '../../MetadataContext';
import { useNotifications } from './useNotifications';
import { NotificationPanel } from './NotificationPanel';

export const NotificationBell: React.FC = () => {
  const context = useContext(MetadataContext);
  const [opened, setOpened] = useState(false);

  const {
    notifications,
    unreadCount,
    isLoading,
    preferences,
    markRead,
    markAllRead,
    updatePreferences,
  } = useNotifications(context.user);

  if (!context.user) return null;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      offset={10}
      withArrow
      shadow="xl"
      radius="md"
    >
      <Popover.Target>
        <Tooltip label="Notifications" withArrow>
          <Indicator
            inline
            disabled={unreadCount === 0}
            label={unreadCount > 99 ? '99+' : unreadCount}
            size={16}
            offset={4}
            color="violet"
            withBorder
          >
            <ActionIcon
              variant="subtle"
              color={opened || unreadCount > 0 ? 'violet' : 'gray'}
              size="lg"
              radius="xl"
              onClick={() => setOpened((o) => !o)}
              aria-label="Toggle notifications"
            >
              {unreadCount > 0 || opened ? (
                <IconBellFilled size={20} />
              ) : (
                <IconBell size={20} stroke={1.5} />
              )}
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ border: 'none', background: 'transparent' }}>
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={isLoading}
          preferences={preferences}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onUpdatePreferences={updatePreferences}
          onClose={() => setOpened(false)}
        />
      </Popover.Dropdown>
    </Popover>
  );
};
