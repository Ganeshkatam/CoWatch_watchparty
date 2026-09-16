import React from "react";
import { Modal, Button, Text, Stack, Card, Group, Badge } from "@mantine/core";
import { IconVideo, IconServer, IconArrowsShuffle } from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";

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
      size={MODAL_SIZES.md}
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
                <Text size="sm" fw={600}>Smooth Sharing</Text>
              </Group>
              <Badge color="violet" variant="light">Recommended</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              The best way to share! It saves your internet and plays perfectly for your friends.
            </Text>
          </Stack>
        </Card>

        <Card withBorder padding="sm" radius="md" style={{ background: "var(--bg-surface)" }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconArrowsShuffle size={18} color="var(--accent-primary)" />
                <Text size="sm" fw={600}>Fix Video Format</Text>
              </Group>
              <Badge color="blue" variant="light">Works Everywhere</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Use this if your video won't play for everyone. We'll magically change it so it works on any phone or computer!
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
            Direct Share
          </Button>
          <Button
            variant="outline"
            color="blue"
            onClick={() => {
              props.startConvert();
              props.closeModal();
            }}
          >
            Fix Format & Share
          </Button>
          <Button
            color="violet"
            leftSection={<IconVideo size={16} />}
            onClick={() => {
              props.startFileShare(true);
              props.closeModal();
            }}
          >
            Share Smoothly
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
