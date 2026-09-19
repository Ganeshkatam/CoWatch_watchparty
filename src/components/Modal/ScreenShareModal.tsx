import React, { useState } from "react";
import { Modal, Button, Text, Stack, Card, Group, Badge } from "@mantine/core";
import { IconScreenShare, IconServer } from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";

export const ScreenShareModal = ({
  closeModal,
  startScreenShare,
}: {
  closeModal: () => void;
  startScreenShare: (useMediaSoup: boolean) => void;
}) => {
  const [selectedMode, setSelectedMode] = useState<"relay" | "p2p">("p2p");

  return (
    <Modal
      opened={true}
      onClose={closeModal}
      title="Share Your Screen"
      centered
      size={MODAL_SIZES.md}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Share your screen or a browser tab with everyone in the room. Audio sharing is supported when sharing a browser tab or entire screen.
        </Text>

        {/* Server-based relay (Smooth Sharing) is disabled as server-based media routing is not configured
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
              The best way to share your screen! It's smooth and saves your internet.
            </Text>
          </Stack>
        </Card>
        */}

        <Card 
          withBorder 
          padding="sm" 
          radius="md" 
          style={{ 
            background: "rgba(51, 154, 240, 0.1)",
            borderColor: "var(--mantine-color-blue-filled)",
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
          onClick={() => setSelectedMode("p2p")}
        >
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <IconScreenShare size={18} color="var(--mantine-color-blue-filled)" />
                <Text size="sm" fw={600}>Direct Share</Text>
              </Group>
              <Badge color="blue" variant="light">Direct P2P</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Shares directly with friends in the room via peer-to-peer WebRTC connection.
            </Text>
          </Stack>
        </Card>

        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            color="blue"
            leftSection={<IconScreenShare size={16} />}
            onClick={() => {
              startScreenShare(false);
              closeModal();
            }}
          >
            Share Screen
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
