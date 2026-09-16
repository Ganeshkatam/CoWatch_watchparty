import React, { useState } from "react";
import { Modal, Button, Text, Stack, Card, Group, Badge } from "@mantine/core";
import { IconVideo, IconServer, IconArrowsShuffle } from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";

export const FileShareModal = (props: {
  closeModal: () => void;
  startFileShare: (useMediaSoup: boolean) => void;
  startConvert: () => void;
}) => {
  const { closeModal } = props;
  const [selectedMode, setSelectedMode] = useState<"relay" | "transcode">("relay");

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

        <Card 
          withBorder 
          padding="sm" 
          radius="md" 
          style={{ 
            background: selectedMode === "relay" ? "rgba(132, 94, 247, 0.1)" : "var(--bg-surface)",
            borderColor: selectedMode === "relay" ? "var(--mantine-color-violet-filled)" : "var(--mantine-color-default-border)",
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
          onClick={() => setSelectedMode("relay")}
        >
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconServer size={18} color="var(--mantine-color-violet-filled)" />
                <Text size="sm" fw={600}>Smooth Sharing</Text>
              </Group>
              <Badge color="violet" variant="light">Recommended</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              The best way to share! It saves your internet and plays perfectly for your friends.
            </Text>
          </Stack>
        </Card>

        <Card 
          withBorder 
          padding="sm" 
          radius="md" 
          style={{ 
            background: selectedMode === "transcode" ? "rgba(51, 154, 240, 0.1)" : "var(--bg-surface)",
            borderColor: selectedMode === "transcode" ? "var(--mantine-color-blue-filled)" : "var(--mantine-color-default-border)",
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
          onClick={() => setSelectedMode("transcode")}
        >
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconArrowsShuffle size={18} color="var(--mantine-color-blue-filled)" />
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
            color={selectedMode === "relay" ? "violet" : "blue"}
            leftSection={<IconVideo size={16} />}
            onClick={() => {
              if (selectedMode === "relay") {
                props.startFileShare(true);
              } else {
                props.startConvert();
              }
              props.closeModal();
            }}
          >
            {selectedMode === "relay" ? "Share Smoothly" : "Fix Format & Share"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
