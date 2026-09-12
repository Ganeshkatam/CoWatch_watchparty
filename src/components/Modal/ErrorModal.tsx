import React from "react";
import { Modal, Button, Text, Stack } from "@mantine/core";
import { IconHome, IconRefresh } from "@tabler/icons-react";
import { sanitizeServerErrorMessage } from "../../utils/userMessages";
import { MODAL_SIZES } from "../../utils/designSystem";

export const ErrorModal = ({ error }: { error: string }) => {
  const sanitizedMessage = sanitizeServerErrorMessage(error);

  return (
    <Modal
      opened
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title="Connection Problem"
      centered
      radius="md"
      size={MODAL_SIZES.sm}
    >
      <Stack gap="lg" align="center" style={{ textAlign: "center", padding: "8px 0" }}>
        <Text size="sm" c="dimmed">
          {sanitizedMessage}
        </Text>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "12px",
            width: "100%",
          }}
        >
          <Button
            size="md"
            color="violet"
            onClick={() => {
              window.location.reload();
            }}
            leftSection={<IconRefresh size={18} />}
          >
            Try again
          </Button>
          <Button
            size="md"
            variant="default"
            onClick={() => {
              window.location.href = "/";
            }}
            leftSection={<IconHome size={18} />}
          >
            Go to home
          </Button>
        </div>
      </Stack>
    </Modal>
  );
};
