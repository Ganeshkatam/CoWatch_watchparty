import React from "react";
import { Modal, Button, Text } from "@mantine/core";
import styles from "./HostEndedModal.module.css";

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
      className={styles.modalRoot}
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 4,
      }}
    >
      <Text className={styles.description}>
        The host has ended this watch party session. Click OK to return to the room gateway.
      </Text>
      <div className={styles.actionRow}>
        <Button
          color="violet"
          size="sm"
          onClick={onConfirm}
          className={styles.okButton}
        >
          OK
        </Button>
      </div>
    </Modal>
  );
};

