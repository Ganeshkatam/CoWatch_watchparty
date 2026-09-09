import React, { useState } from "react";
import { Modal, TextInput, ActionIcon, Button, Text, Group, Tooltip } from "@mantine/core";
import {
  IconCopy,
  IconCheck,
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconMail,
  IconHash,
  IconKey,
  IconQrcode,
  IconShare,
  IconMessageShare,
} from "@tabler/icons-react";

interface InviteModalProps {
  roomId?: string;
  passcode?: string;
  closeInviteModal: () => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  roomId,
  passcode: propPasscode,
  closeInviteModal,
}) => {
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [inviteMsgCopied, setInviteMsgCopied] = useState(false);
  const [passcodeCopied, setPasscodeCopied] = useState(false);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const pathParts = window.location.pathname.split("/");
  const roomIdOrVanity = roomId || pathParts[pathParts.length - 1] || "";
  const cleanId = roomIdOrVanity.replace(/^\//, "");

  const urlPass =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("passcode") ||
        new URLSearchParams(window.location.search).get("pass") ||
        new URLSearchParams(window.location.search).get("password")
      : null;

  const resolvedPasscode = propPasscode || urlPass || "";

  const baseUrl = `${window.location.origin}/watch/${cleanId}`;
  const fullUrl = resolvedPasscode
    ? `${baseUrl}?passcode=${encodeURIComponent(resolvedPasscode)}`
    : baseUrl;

  const inviteMessage = resolvedPasscode
    ? `Hey! Join my watch party on CoWatch:\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
    : `Hey! Join my watch party on CoWatch:\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}`;

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(fullUrl);
    setInviteLinkCopied(true);
    setTimeout(() => setInviteLinkCopied(false), 2000);
  };

  const handleCopyInviteMessage = () => {
    navigator.clipboard.writeText(inviteMessage);
    setInviteMsgCopied(true);
    setTimeout(() => setInviteMsgCopied(false), 2000);
  };

  const handleCopyPasscode = () => {
    if (!resolvedPasscode) return;
    navigator.clipboard.writeText(resolvedPasscode);
    setPasscodeCopied(true);
    setTimeout(() => setPasscodeCopied(false), 2000);
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(cleanId);
    setRoomIdCopied(true);
    setTimeout(() => setRoomIdCopied(false), 2000);
  };

  const whatsappText = resolvedPasscode
    ? `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
    : `Join my watch party on CoWatch!\n\nLink: ${fullUrl}`;

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`;

  const telegramText = resolvedPasscode
    ? `Join my watch party on CoWatch!\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
    : `Join my watch party on CoWatch!`;

  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    fullUrl
  )}&text=${encodeURIComponent(telegramText)}`;

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    "Join my CoWatch Party"
  )}&body=${encodeURIComponent(inviteMessage)}`;

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
        {/* Copy Full Invite Message CTA */}
        <Button
          onClick={handleCopyInviteMessage}
          variant="gradient"
          gradient={{ from: "teal", to: "blue", deg: 135 }}
          fullWidth
          leftSection={inviteMsgCopied ? <IconCheck size={18} /> : <IconMessageShare size={18} />}
          style={{ fontWeight: 600 }}
        >
          {inviteMsgCopied ? "Invite Message Copied!" : "Copy Full Invite Message (with Passcode)"}
        </Button>

        {/* Copy Invite Link */}
        <TextInput
          label="Invite Link (includes passcode)"
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

        {/* Copy Room Passcode */}
        {resolvedPasscode ? (
          <TextInput
            label="Room Passcode"
            readOnly
            leftSection={<IconKey size={16} />}
            rightSection={
              <Tooltip label={passcodeCopied ? "Copied!" : "Copy Passcode"}>
                <ActionIcon onClick={handleCopyPasscode} color={passcodeCopied ? "green" : "violet"} variant="light">
                  {passcodeCopied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            }
            value={resolvedPasscode}
          />
        ) : null}

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
          value={cleanId}
        />

        {/* Share buttons */}
        <div>
          <Text size="sm" fw={500} mb="xs">
            Quick Share (Includes Link & Passcode)
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
                      text: resolvedPasscode
                        ? `Join my watch party on CoWatch!\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
                        : "Join my watch party and let's watch together!",
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
        <div style={{ marginTop: "4px" }}>
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
