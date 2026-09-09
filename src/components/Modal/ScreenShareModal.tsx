import React from "react";
import { Modal, Button, Text, Stack, Card, Group, Badge } from "@mantine/core";
import { IconScreenShare, IconServer } from "@tabler/icons-react";

export const ScreenShareModal = ({
  closeModal,
  startScreenShare,
}: {
  closeModal: () => void;
  startScreenShare: (useMediaSoup: boolean) => void;
}) => {
  return (
    <Modal
      opened={true}
      onClose={closeModal}
      title="Share Your Screen"
      centered
      size="md"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Share your screen or a browser tab with everyone in the room. Audio sharing is supported when sharing a browser tab or entire screen.
        </Text>

        <Card withBorder padding="sm" radius="md" style={{ background: "var(--bg-surface)" }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconServer size={18} color="var(--accent-primary)" />
                <Text size="sm" fw={600}>Streaming Mode</Text>
              </Group>
              <Badge color="violet" variant="light">Recommended</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Relay server optimizes upload bandwidth and delivers smooth, low-latency streaming to all viewers.
            </Text>
          </Stack>
        </Card>

        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="outline"
            color="gray"
            onClick={() => {
              startScreenShare(false);
              closeModal();
            }}
          >
            Direct (P2P)
          </Button>
          <Button
            color="violet"
            leftSection={<IconScreenShare size={16} />}
            onClick={() => {
              startScreenShare(true);
              closeModal();
            }}
          >
            Start Screenshare
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
