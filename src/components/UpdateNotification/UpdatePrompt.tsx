import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { updateDetector } from "../../utils/updateDetector";
import { shouldPromptUser } from "../../utils/updatePolicy";
import type { UpdateCheckResult } from "../../utils/appVersion";

const UPDATE_NOTIFICATION_ID = "cowatch-update-notification";

export const UpdatePrompt: React.FC = () => {
  const location = useLocation();
  const isWatchRoom = Boolean(location.pathname && location.pathname.startsWith("/watch/"));
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckResult>(() => updateDetector.getStatus());

  // 1. Subscribe to update detector results
  useEffect(() => {
    const unsubscribe = updateDetector.subscribe((result) => {
      setUpdateStatus(result);
    });
    return unsubscribe;
  }, []);

  // 2. Start background lifecycle triggers (startup delay, 5m timer, visibility, online)
  useEffect(() => {
    const stopDetector = updateDetector.start(() => {
      return Boolean(window.location.pathname && window.location.pathname.startsWith("/watch/"));
    });
    return stopDetector;
  }, []);

  // 3. React to route changes: re-evaluate active room context
  useEffect(() => {
    updateDetector.checkForUpdate(isWatchRoom);
  }, [location.pathname, isWatchRoom]);

  // 4. Manage notification display based on state and room context
  useEffect(() => {
    const latestBuildId = updateStatus.latest?.buildId;
    const dismissedBuildId = updateDetector.getDismissedBuildId();

    if (isWatchRoom) {
      // Defer prompt in active watch room to guarantee uninterrupted viewing
      notifications.hide(UPDATE_NOTIFICATION_ID);
      return;
    }

    if (shouldPromptUser(updateStatus.state, dismissedBuildId, latestBuildId)) {
      if (updateStatus.state === "recommended") {
        notifications.show({
          id: UPDATE_NOTIFICATION_ID,
          title: "Update Available",
          message: (
            <Stack gap={10} mt={4}>
              <Text size="xs" c="dimmed">
                A new version of CoWatch is available. Update now to get the latest features and improvements.
              </Text>
              <Group justify="flex-end" gap={8}>
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-xs"
                  onClick={() => {
                    if (latestBuildId) {
                      updateDetector.dismissUpdate(latestBuildId);
                    }
                    notifications.hide(UPDATE_NOTIFICATION_ID);
                  }}
                >
                  Later
                </Button>
                <Button
                  variant="filled"
                  color="violet"
                  size="compact-xs"
                  leftSection={<IconRefresh size={12} />}
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  Update Now
                </Button>
              </Group>
            </Stack>
          ),
          autoClose: false,
          withCloseButton: true,
        });
      }
    } else {
      if (updateStatus.state !== "required") {
        notifications.hide(UPDATE_NOTIFICATION_ID);
      }
    }
  }, [updateStatus, isWatchRoom]);

  // If update is strictly required (incompatible protocol), show persistent non-dismissible modal
  if (updateStatus.state === "required") {
    return (
      <Modal
        opened={true}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        radius="md"
        title={
          <Group gap={8}>
            <IconAlertTriangle size={20} color="var(--color-warning, #f59e0b)" />
            <Text fw={600} size="md">
              Update Required
            </Text>
          </Group>
        }
      >
        <Stack gap={14}>
          <Text size="sm">
            CoWatch has been updated with critical protocol improvements. Please refresh your browser to continue using the application.
          </Text>
          <Group justify="flex-end" mt={6}>
            <Button
              color="violet"
              size="sm"
              leftSection={<IconRefresh size={14} />}
              onClick={() => {
                window.location.reload();
              }}
            >
              Update Now
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  return null;
};
