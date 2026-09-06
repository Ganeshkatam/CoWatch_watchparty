import React, { useCallback, useContext, useEffect } from "react";
import { Modal, PasswordInput, ActionIcon } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";
import { addAndSavePasscode, serverPath } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import { getAccessToken } from "../../utils/supabaseClient";

export const PasscodeModal = ({ roomId }: { roomId: string }) => {
  const setPasscode = useCallback(() => {
    const passcode = (
      document.getElementById("roomPasscode") as HTMLInputElement
    )?.value;
    addAndSavePasscode(roomId, passcode);
    window.location.reload();
  }, [roomId]);
  const { user } = useContext(MetadataContext);

  return (
    <Modal
      onClose={() => {}}
      withCloseButton={false}
      opened
      centered
      size="md"
      title="This room requires a passcode"
    >
      <PasswordInput
        id="roomPasscode"
        onKeyDown={(e: any) => e.key === "Enter" && setPasscode()}
        rightSection={
          <ActionIcon onClick={setPasscode}>
            <IconKey size={16} />
          </ActionIcon>
        }
      />
    </Modal>
  );
};
