import React, { useState } from "react";
import { ActionIcon } from "@mantine/core";
import { InviteModal } from "../Modal/InviteModal";
import { IconUserPlus } from "@tabler/icons-react";

export const InviteButton = ({ roomId }: { roomId: string }) => {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  return (
    <>
      {inviteModalOpen && (
        <InviteModal
          roomId={roomId}
          closeInviteModal={() => setInviteModalOpen(false)}
        />
      )}
      <ActionIcon
        size="36px"
        color="green"
        variant="light"
        title="Invite friends"
        onClick={() => setInviteModalOpen(true)}
        style={{ flexShrink: 0 }}
      >
        <IconUserPlus size={18} />
      </ActionIcon>
    </>
  );
};
