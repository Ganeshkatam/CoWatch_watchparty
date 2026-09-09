import React from "react";
import { Modal, Button, Text, Stack, Card, Group, Badge } from "@mantine/core";
import { IconVideo, IconServer, IconArrowsShuffle } from "@tabler/icons-react";

export const FileShareModal = (props: {
  closeModal: () => void;
  startFileShare: (useMediaSoup: boolean) => void;
  startConvert: () => void;
}) => {
  const { closeModal } = props;
  return (
    <Modal
      opened
      onClose={closeModal}
      title="Share Video File"
      size="md"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Select a video file from your device to stream directly to everyone in this room.
        </Text>

        <Card withBorder padding="sm" radius="md" style={{ background: "var(--bg-surface)" }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconServer size={18} color="var(--accent-primary)" />
                <Text size="sm" fw={600}>Relay Streaming</Text>
              </Group>
              <Badge color="violet" variant="light">Recommended</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Streams through our relay server to optimize upload bandwidth from your device.
            </Text>
          </Stack>
        </Card>

        <Card withBorder padding="sm" radius="md" style={{ background: "var(--bg-surface)" }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconArrowsShuffle size={18} color="var(--accent-primary)" />
                <Text size="sm" fw={600}>Auto-Transcode</Text>
              </Group>
              <Badge color="blue" variant="light">Broad Codec Support</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Transcodes video in real-time to ensure playback compatibility across all browsers and devices.
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
              props.startFileShare(false);
              props.closeModal();
            }}
          >
            Direct
          </Button>
          <Button
            variant="outline"
            color="blue"
            onClick={() => {
              props.startConvert();
              props.closeModal();
            }}
          >
            Transcode & Stream
          </Button>
          <Button
            color="violet"
            leftSection={<IconVideo size={16} />}
            onClick={() => {
              props.startFileShare(true);
              props.closeModal();
            }}
          >
            Share with Relay
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
