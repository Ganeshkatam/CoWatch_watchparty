import React from "react";
import { Modal, Button, Text } from "@mantine/core";
import { MODAL_SIZES } from "../../utils/designSystem";
import styles from "./HostEndedModal.module.css";

interface HostEndedModalProps {
  opened: boolean;
  onConfirm: () => void;
  isPermanent?: boolean;
}

export const HostEndedModal: React.FC<HostEndedModalProps> = ({
  opened,
  onConfirm,
  isPermanent = false,
}) => {
  return (
    <Modal
      opened={opened}
      onClose={() => {}}
      centered
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      title={isPermanent ? "This session has been stopped by host" : "This meeting has been ended by host"}
      radius="md"
      size={MODAL_SIZES.sm}
      className={styles.modalRoot}
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 4,
      }}
    >
      <Text className={styles.description}>
        {isPermanent
          ? "The host has stopped this watch party session. Click OK to return to the home page."
          : "The host has ended this watch party session. Click OK to return to the home page."}
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

