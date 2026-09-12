import React, { useCallback, useState } from "react";
import { Modal, PasswordInput, ActionIcon, Button, Group } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";

interface PasscodeModalProps {
  roomId: string;
  onSubmit?: (passcode: string) => void;
  onCancel?: () => void;
}

export const PasscodeModal: React.FC<PasscodeModalProps> = ({
  roomId,
  onSubmit,
  onCancel,
}) => {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = passcode.trim();
    if (!trimmed) {
      setError("Please enter a passcode");
      return;
    }
    if (onSubmit) {
      onSubmit(trimmed);
    } else {
      const cleanId = roomId.replace(/^\//, "");
      window.location.assign(`/join/${encodeURIComponent(cleanId)}`);
    }
  }, [passcode, onSubmit, roomId]);

  return (
    <Modal
      onClose={() => {
        if (onCancel) onCancel();
      }}
      withCloseButton={Boolean(onCancel)}
      opened
      centered
      size={MODAL_SIZES.sm}
      title="This room requires a passcode"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <PasswordInput
          id="roomPasscode"
          autoFocus
          value={passcode}
          onChange={(e) => {
            setPasscode(e.currentTarget.value);
            if (error) setError("");
          }}
          error={error}
          placeholder="Enter room passcode"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          rightSection={
            <ActionIcon
              onClick={handleSubmit}
              variant="subtle"
              color="violet"
              title="Submit passcode"
            >
              <IconKey size={16} />
            </ActionIcon>
          }
        />
        <Group justify="flex-end" gap="xs">
          {onCancel && (
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={handleSubmit} color="violet">
            Join Room
          </Button>
        </Group>
      </div>
    </Modal>
  );
};

