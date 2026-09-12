import React, { useContext, useState } from "react";
import { Menu, Loader } from "@mantine/core";
import { Socket } from "socket.io-client";
import { MetadataContext } from "../../MetadataContext";
import { IconBan, IconCrown, IconTrashFilled, IconX } from "@tabler/icons-react";
import { getOrCreateClientId } from "../../utils/utils";
import { ThemeMenuItems } from "../TopBar/TopBar";
import { useOperationState } from "../../hooks/useOperationState";
import { operationCoordinator } from "../../utils/operationState";

const clientId = getOrCreateClientId();

export const UserMenu = ({
  socket,
  userToManage,
  trigger,
  displayName,
  disabled,
  timestamp,
  isChatMessage,
  isHost,
  isCurrentTargetHost,
}: {
  socket: Socket;
  userToManage: string;
  trigger: React.ReactNode;
  icon?: string;
  displayName?: string;
  disabled: boolean;
  timestamp?: string;
  isChatMessage?: boolean;
  isHost?: boolean;
  isCurrentTargetHost?: boolean;
}) => {
  const { user } = useContext(MetadataContext);
  const hostAssignOp = useOperationState("host-authority", "assign", userToManage);
  const kickOp = useOperationState("participant-authority", "kick", userToManage);

  return (
    <Menu
      closeOnItemClick
      closeOnClickOutside
      disabled={disabled}
      trigger="click"
    >
      <Menu.Target>{trigger}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{displayName}</Menu.Label>
        
        {userToManage === clientId && (
          <>
            <Menu.Divider />
            <ThemeMenuItems />
            <Menu.Divider />
          </>
        )}

        {isChatMessage && (
          <Menu.Item
            leftSection={<IconX />}
            onClick={async () => {
              socket.emit("CMD:deleteChatMessages", {
                author: userToManage,
                timestamp: timestamp,
              });
            }}
          >
            Delete Message
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<IconTrashFilled />}
          onClick={async () => {
            socket.emit("CMD:deleteChatMessages", {
              author: userToManage,
            });
          }}
        >
          Delete User's Messages
        </Menu.Item>
        {isHost && !isCurrentTargetHost && userToManage !== clientId && !isChatMessage && (
          <Menu.Item
            disabled={hostAssignOp.isPending}
            leftSection={
              hostAssignOp.showSpinner ? (
                <Loader size={16} color="violet" />
              ) : (
                <IconCrown size={16} />
              )
            }
            onClick={() => {
              if (hostAssignOp.isPending) return;
              operationCoordinator.startOperation("host-authority", "assign", userToManage);
              socket.emit("CMD:assignHost", {
                newHostClientId: userToManage,
              });
            }}
          >
            {hostAssignOp.isPending ? "Assigning host..." : "Make Host"}
          </Menu.Item>
        )}
        <Menu.Item
          disabled={kickOp.isPending}
          leftSection={
            kickOp.showSpinner ? (
              <Loader size={16} color="red" />
            ) : (
              <IconBan />
            )
          }
          onClick={async () => {
            if (kickOp.isPending) return;
            operationCoordinator.startOperation("participant-authority", "kick", userToManage);
            socket.emit("CMD:kickUser", {
              userToBeKicked: userToManage,
            });
          }}
        >
          {kickOp.isPending ? "Kicking user..." : "Kick User"}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
