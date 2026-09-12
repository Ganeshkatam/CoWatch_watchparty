import React, { useEffect, useState } from "react";
import {
  Paper,
  Text,
  Loader,
  Button,
  Badge,
  Alert,
  Stack,
  Group,
  Center,
  Box,
} from "@mantine/core";
import {
  IconBrowser,
  IconAlertCircle,
  IconPlayerStop,
  IconUserCheck,
} from "@tabler/icons-react";
import {
  clientVBrowserCoordinator,
  type VBrowserClientState,
} from "../../utils/vbrowserCoordinator";

export interface VBrowserDockProps {
  roomId: string;
  isHost: boolean;
  canControl: boolean;
  onRelease?: (reservationId: string) => void;
  onRequestControl?: () => void;
}

export const VBrowserDock: React.FC<VBrowserDockProps> = ({
  roomId,
  isHost,
  canControl,
  onRelease,
  onRequestControl,
}) => {
  const [state, setState] = useState<VBrowserClientState>(
    clientVBrowserCoordinator.getState()
  );

  useEffect(() => {
    const unsubscribe = clientVBrowserCoordinator.subscribe((newState) => {
      setState(newState);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  if (state.status === "DISCONNECTED") {
    return null;
  }

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      bg="dark.8"
      style={{
        width: "100%",
        minHeight: "400px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top Controls & Status Bar */}
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconBrowser size={18} color="#845ef7" />
          <Text fw={600} size="sm" c="white">
            Cloud Virtual Browser
          </Text>
          <Badge
            color={
              state.status === "ASSIGNED"
                ? "green"
                : state.status === "FAILED"
                ? "red"
                : "violet"
            }
            variant="light"
            size="sm"
          >
            {state.status}
          </Badge>
        </Group>

        <Group gap="xs">
          {state.status === "ASSIGNED" && (
            <>
              {state.isController ? (
                <Badge color="blue" variant="filled" leftSection={<IconUserCheck size={12} />}>
                  Controlling
                </Badge>
              ) : (
                canControl &&
                onRequestControl && (
                  <Button size="xs" variant="light" color="violet" onClick={onRequestControl}>
                    Request Control
                  </Button>
                )
              )}

              {(isHost || state.isController) && state.reservationId && onRelease && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={() => onRelease(state.reservationId!)}
                >
                  Stop Browser
                </Button>
              )}
            </>
          )}
        </Group>
      </Group>

      {/* Main Viewport Content */}
      <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {(state.status === "REQUESTING" || state.status === "RESERVED") && (
          <Center p="xl">
            <Stack align="center" gap="md">
              <Loader color="violet" size="md" />
              <Text size="sm" c="dimmed" ta="center">
                {state.status === "REQUESTING"
                  ? "Requesting Virtual Browser allocation..."
                  : "Provisioning isolated cloud browser instance..."}
              </Text>
            </Stack>
          </Center>
        )}

        {state.status === "RELEASING" && (
          <Center p="xl">
            <Stack align="center" gap="md">
              <Loader color="gray" size="sm" />
              <Text size="sm" c="dimmed">
                Releasing Virtual Browser resources...
              </Text>
            </Stack>
          </Center>
        )}

        {state.status === "FAILED" && (
          <Center p="lg">
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="Virtual Browser Notice"
              color="red"
              variant="light"
              style={{ maxWidth: 480 }}
            >
              <Text size="sm">
                {state.failureReason ||
                  "The virtual browser session is currently unavailable. Please try again later."}
              </Text>
            </Alert>
          </Center>
        )}

        {state.status === "ASSIGNED" && state.streamUrl && (
          <Box
            style={{
              width: "100%",
              height: "100%",
              minHeight: 360,
              backgroundColor: "#000",
              borderRadius: 6,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <iframe
              src={state.streamUrl}
              title="Virtual Browser Stream"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                minHeight: 360,
              }}
              allow="camera; microphone; clipboard-read; clipboard-write;"
            />
          </Box>
        )}
      </Box>
    </Paper>
  );
};
