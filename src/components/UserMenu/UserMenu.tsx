import React, { useContext, useState } from "react";
import { Menu } from "@mantine/core";
import { Socket } from "socket.io-client";
// import styles from './UserMenu.module.css';
import { MetadataContext } from "../../MetadataContext";
import { IconBan, IconCrown, IconTrashFilled, IconX } from "@tabler/icons-react";
import { getOrCreateClientId } from "../../utils/utils";
import { ThemeMenuItems } from "../TopBar/TopBar";

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
            leftSection={<IconCrown size={16} />}
            onClick={() => {
              socket.emit("CMD:assignHost", {
                newHostClientId: userToManage,
              });
            }}
          >
            Make Host
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<IconBan />}
          onClick={async () => {
            socket.emit("CMD:kickUser", {
              userToBeKicked: userToManage,
            });
          }}
        >
          Kick User
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
