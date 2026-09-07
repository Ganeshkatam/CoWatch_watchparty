import React, { useState } from "react";
import { Modal, TextInput, ActionIcon, Button, Text, Group, Tooltip } from "@mantine/core";
import {
  IconCopy,
  IconCheck,
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconMail,
  IconHash,
  IconQrcode,
  IconShare,
} from "@tabler/icons-react";
import { getSavedPasscodes } from "../../utils/utils";

export const InviteModal = ({
  roomId,
  closeInviteModal,
}: {
  roomId?: string;
  closeInviteModal: () => void;
}) => {
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const pathParts = window.location.pathname.split("/");
  const roomIdOrVanity = roomId || pathParts[pathParts.length - 1] || "";
  const passcode =
    (roomId && getSavedPasscodes()[roomId]) ||
    getSavedPasscodes()[roomIdOrVanity];
  const baseUrl = window.location.origin + window.location.pathname;
  const fullUrl = passcode
    ? `${baseUrl}?passcode=${encodeURIComponent(passcode)}`
    : window.location.href;

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(fullUrl);
    setInviteLinkCopied(true);
    setTimeout(() => setInviteLinkCopied(false), 2000);
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomIdOrVanity);
    setRoomIdCopied(true);
    setTimeout(() => setRoomIdCopied(false), 2000);
  };

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
    `Join my watch party: ${fullUrl}`
  )}`;

  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    fullUrl
  )}&text=${encodeURIComponent("Join my watch party!")}`;

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    "Join my CoWatch Party"
  )}&body=${encodeURIComponent(
    `Hey! Join my watch party and let's watch together:\n\n${fullUrl}`
  )}`;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
    fullUrl
  )}`;

  return (
    <Modal
      opened
      centered
      onClose={closeInviteModal}
      title="Invite friends to your Watch Party!"
      radius="md"
      styles={{
        content: {
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        },
        header: {
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          borderBottom: "1px solid var(--border-subtle)",
        },
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Copy Invite Link */}
        <TextInput
          label="Invite Link"
          readOnly
          rightSection={
            <Tooltip label={inviteLinkCopied ? "Copied!" : "Copy Link"}>
              <ActionIcon onClick={handleCopyInviteLink} color={inviteLinkCopied ? "green" : "violet"} variant="light">
                {inviteLinkCopied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          }
          value={fullUrl}
        />

        {/* Copy Room ID / Name */}
        <TextInput
          label="Room ID / Slug"
          readOnly
          rightSection={
            <Tooltip label={roomIdCopied ? "Copied!" : "Copy Room ID"}>
              <ActionIcon onClick={handleCopyRoomId} color={roomIdCopied ? "green" : "violet"} variant="light">
                {roomIdCopied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          }
          leftSection={<IconHash size={16} />}
          value={roomIdOrVanity}
        />

        {/* Share buttons */}
        <div>
          <Text size="sm" fw={500} mb="xs">
            Quick Share
          </Text>
          <Group gap="xs">
            <Button
              component="a"
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              color="green"
              variant="light"
              leftSection={<IconBrandWhatsapp size={16} />}
              style={{ flexGrow: 1 }}
            >
              WhatsApp
            </Button>
            <Button
              component="a"
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              color="blue"
              variant="light"
              leftSection={<IconBrandTelegram size={16} />}
              style={{ flexGrow: 1 }}
            >
              Telegram
            </Button>
            <Button
              component="a"
              href={mailtoUrl}
              color="gray"
              variant="light"
              leftSection={<IconMail size={16} />}
              style={{ flexGrow: 1 }}
            >
              Email
            </Button>
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
              <Button
                onClick={() => {
                  navigator
                    .share({
                      title: "Join my CoWatch Party",
                      text: "Join my watch party and let's watch together!",
                      url: fullUrl,
                    })
                    .catch(() => {});
                }}
                color="violet"
                variant="light"
                leftSection={<IconShare size={16} />}
                style={{ flexGrow: 1 }}
              >
                Share
              </Button>
            )}
          </Group>
        </div>

        {/* QR Code toggler */}
        <div style={{ marginTop: "8px" }}>
          <Button
            onClick={() => setShowQr(!showQr)}
            variant="default"
            fullWidth
            leftSection={<IconQrcode size={16} />}
          >
            {showQr ? "Hide QR Code" : "Show QR Code"}
          </Button>

          {showQr && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                marginTop: "16px",
                padding: "16px",
                background: "var(--bg-elevated)",
                borderRadius: "8px",
              }}
            >
              <img
                src={qrCodeUrl}
                alt="Room QR Code"
                style={{
                  borderRadius: "4px",
                  border: "8px solid white",
                  boxShadow: "var(--shadow-sm)",
                }}
              />
              <Text size="xs" c="dimmed" mt="xs">
                Scan with a mobile camera to join instantly
              </Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
