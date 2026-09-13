import React, { useState } from "react";
import { ActionIcon } from "@mantine/core";
import { InviteModal } from "../Modal/InviteModal";
import { IconUserPlus } from "@tabler/icons-react";

export const InviteButton = ({
  roomId,
  isHost,
  isOwner,
}: {
  roomId: string;
  isHost?: boolean;
  isOwner?: boolean;
}) => {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const canInvite = Boolean(isHost || isOwner);

  if (!canInvite) {
    return null;
  }

  return (
    <>
      {inviteModalOpen && (
        <InviteModal
          roomId={roomId}
          isHost={isHost}
          isOwner={isOwner}
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
