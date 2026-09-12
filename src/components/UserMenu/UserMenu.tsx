import React, { useContext, useState } from "react";
import { Menu, Loader, Modal, Button, Group, Text, Stack } from "@mantine/core";
import { Socket } from "socket.io-client";
import { MetadataContext } from "../../MetadataContext";
import { IconBan, IconCrown, IconTrashFilled, IconUserX, IconX, IconAlertTriangle } from "@tabler/icons-react";
import { getOrCreateClientId } from "../../utils/utils";
import { ThemeMenuItems } from "../TopBar/TopBar";
import { useOperationState, useRoomInitStage } from "../../hooks/useOperationState";
import { operationCoordinator } from "../../utils/operationState";
import { ReportModal } from "../Report/ReportModal";

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
  const { isReady } = useRoomInitStage();
  const hostAssignOp = useOperationState("host-authority", "assign", userToManage);
  const kickOp = useOperationState("participant-authority", "kick", userToManage);
  const banOp = useOperationState("participant-authority", "ban", userToManage);

  const [isKickModalOpen, setIsKickModalOpen] = useState(false);
  const [isBanModalOpen, setIsBanModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const handleConfirmKick = () => {
    setIsKickModalOpen(false);
    if (!isReady || kickOp.isPending) return;
    operationCoordinator.startOperation("participant-authority", "kick", userToManage);
    socket.emit("CMD:kickUser", {
      userToBeKicked: userToManage,
    });
  };

  const handleConfirmBan = () => {
    setIsBanModalOpen(false);
    if (!isReady || banOp.isPending) return;
    operationCoordinator.startOperation("participant-authority", "ban", userToManage);
    socket.emit("CMD:banUser", {
      userToBeBanned: userToManage,
    });
  };

  return (
    <>
      <Menu
        closeOnItemClick
        closeOnClickOutside
        disabled={disabled}
        trigger="click"
      >
        <Menu.Target>{trigger}</Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{displayName || userToManage}</Menu.Label>

          {userToManage === clientId && (
            <>
              <Menu.Divider />
              <ThemeMenuItems />
              <Menu.Divider />
            </>
          )}

          {isChatMessage && (
            <Menu.Item
              leftSection={<IconX size={16} />}
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
            leftSection={<IconTrashFilled size={16} />}
            onClick={async () => {
              socket.emit("CMD:deleteChatMessages", {
                author: userToManage,
              });
            }}
          >
            Delete User's Messages
          </Menu.Item>
          {isHost && !isCurrentTargetHost && userToManage !== clientId && !isChatMessage && (
            <>
              <Menu.Item
                disabled={!isReady || hostAssignOp.isPending}
                leftSection={
                  hostAssignOp.showSpinner ? (
                    <Loader size={16} color="violet" />
                  ) : (
                    <IconCrown size={16} />
                  )
                }
                onClick={() => {
                  if (!isReady || hostAssignOp.isPending) return;
                  operationCoordinator.startOperation("host-authority", "assign", userToManage);
                  socket.emit("CMD:assignHost", {
                    newHostClientId: userToManage,
                  });
                }}
              >
                Make Host
              </Menu.Item>
              <Menu.Item
                disabled={!isReady || kickOp.isPending}
                leftSection={
                  kickOp.showSpinner ? (
                    <Loader size={16} color="red" />
                  ) : (
                    <IconUserX size={16} />
                  )
                }
                onClick={() => {
                  if (!isReady || kickOp.isPending) return;
                  setIsKickModalOpen(true);
                }}
              >
                Kick User
              </Menu.Item>
              <Menu.Item
                color="red"
                disabled={!isReady || banOp.isPending}
                leftSection={
                  banOp.showSpinner ? (
                    <Loader size={16} color="red" />
                  ) : (
                    <IconBan size={16} />
                  )
                }
                onClick={() => {
                  if (!isReady || banOp.isPending) return;
                  setIsBanModalOpen(true);
                }}
              >
                Ban User
              </Menu.Item>
            </>
          )}

          {userToManage !== clientId && (
            <>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconAlertTriangle size={16} />}
                onClick={() => setIsReportModalOpen(true)}
              >
                Report User
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

      {/* Mantine Confirmation Modal for Kick */}
      <Modal
        opened={isKickModalOpen}
        onClose={() => setIsKickModalOpen(false)}
        title="Remove Participant"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to remove <b>{displayName || userToManage}</b> from this room? They will be disconnected immediately.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setIsKickModalOpen(false)}>
              Cancel
            </Button>
            <Button color="orange" onClick={handleConfirmKick}>
              Remove Participant
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Mantine Confirmation Modal for Ban */}
      <Modal
        opened={isBanModalOpen}
        onClose={() => setIsBanModalOpen(false)}
        title="Ban Participant"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to permanently ban <b>{displayName || userToManage}</b> from this room? They will be removed and prohibited from rejoining.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setIsBanModalOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmBan}>
              Ban Participant
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ReportModal
        opened={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetUsername={displayName || userToManage}
        context={{
          targetClientId: userToManage,
          timestamp: timestamp,
          isChatMessage: isChatMessage,
        }}
      />
    </>
  );
};
