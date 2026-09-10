import React from "react";
import { Modal, Button } from "@mantine/core";

interface HostEndedModalProps {
  opened: boolean;
  onConfirm: () => void;
}

export const HostEndedModal: React.FC<HostEndedModalProps> = ({
  opened,
  onConfirm,
}) => {
  return (
    <Modal
      opened={opened}
      onClose={() => {}}
      centered
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      title="This meeting has been ended by host"
      radius="md"
      size={420}
      styles={{
        content: {
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.3)",
        },
        header: {
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          padding: "20px 24px 8px 24px",
        },
        title: {
          fontWeight: 700,
          fontSize: "17px",
          color: "var(--text-primary)",
          lineHeight: 1.4,
        },
        body: {
          padding: "8px 24px 20px 24px",
        },
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "16px",
        }}
      >
        <Button
          color="violet"
          size="sm"
          onClick={onConfirm}
          style={{ minWidth: "90px", fontWeight: 600 }}
        >
          OK
        </Button>
      </div>
    </Modal>
  );
};
