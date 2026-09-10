import React, { useState } from "react";
import { Modal, Button, Text, Tooltip, ActionIcon } from "@mantine/core";
import {
  IconCopy,
  IconCheck,
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconBrandX,
  IconMail,
  IconHash,
  IconKey,
  IconQrcode,
  IconShare,
  IconMessageShare,
  IconUsers,
  IconLock,
  IconShieldCheck,
  IconEye,
  IconEyeOff,
  IconLink,
} from "@tabler/icons-react";
import styles from "./InviteModal.module.css";

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
  const [showPasscode, setShowPasscode] = useState(true);
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

  const twitterText = "Join my watch party on CoWatch and let's stream together!";
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    twitterText
  )}&url=${encodeURIComponent(fullUrl)}`;

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    "Join my CoWatch Party"
  )}&body=${encodeURIComponent(inviteMessage)}`;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    fullUrl
  )}`;

  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = () => {
    if (!hasNativeShare) return;
    navigator
      .share({
        title: "Join my CoWatch Party",
        text: resolvedPasscode
          ? `Join my watch party on CoWatch!\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
          : "Join my watch party and let's stream together!",
        url: fullUrl,
      })
      .catch(() => {});
  };

  return (
    <Modal
      opened
      centered
      onClose={closeInviteModal}
      className={styles.modalRoot}
      size="lg"
      title={
        <div className={styles.modalHeader}>
          <div className={styles.headerIconBadge}>
            <IconUsers size={22} />
          </div>
          <div className={styles.headerMeta}>
            <span className={styles.headerTitle}>Invite Friends</span>
            <span className={styles.headerSubtitle}>
              Share your watch party link to stream together in real-time
            </span>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        {/* Room Status Banner */}
        {resolvedPasscode ? (
          <div className={`${styles.statusBanner} ${styles.statusBannerProtected}`}>
            <IconLock size={18} className={styles.statusBannerIcon} />
            <div>
              <strong>Passcode Protected Room.</strong> The invite link below automatically includes the access token for seamless one-click joining.
            </div>
          </div>
        ) : (
          <div className={`${styles.statusBanner} ${styles.statusBannerOpen}`}>
            <IconShieldCheck size={18} className={styles.statusBannerIcon} />
            <div>
              <strong>Public Room.</strong> Anyone with the link can join the watch party directly.
            </div>
          </div>
        )}

        {/* Primary Link Card */}
        <div className={styles.linkCard}>
          <div className={styles.linkCardHeader}>
            <span className={styles.linkCardLabel}>
              <IconLink size={14} />
              Party Link
            </span>
            <Button
              onClick={handleCopyInviteMessage}
              variant="subtle"
              color="violet"
              size="compact-xs"
              leftSection={inviteMsgCopied ? <IconCheck size={13} /> : <IconMessageShare size={13} />}
            >
              {inviteMsgCopied ? "Message Copied" : "Copy Formatted Message"}
            </Button>
          </div>

          <div className={styles.linkInputRow}>
            <div className={styles.urlDisplay} title={fullUrl}>
              {fullUrl}
            </div>
            <Button
              onClick={handleCopyInviteLink}
              variant="gradient"
              gradient={{ from: "violet", to: "indigo", deg: 135 }}
              className={styles.copyButton}
              leftSection={inviteLinkCopied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            >
              {inviteLinkCopied ? "Copied!" : "Copy Link"}
            </Button>
          </div>
        </div>

        {/* Room Credentials Grid */}
        <div className={styles.credentialsGrid}>
          {/* Room ID Card */}
          <div
            className={styles.credentialCard}
            onClick={handleCopyRoomId}
            title="Click to copy room slug"
          >
            <div className={styles.credentialHeader}>
              <span className={styles.credentialTitle}>
                <IconHash size={13} />
                Room Code / Slug
              </span>
              <Tooltip label={roomIdCopied ? "Copied!" : "Copy Room Code"}>
                <ActionIcon size="xs" variant="transparent" color={roomIdCopied ? "green" : "gray"}>
                  {roomIdCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </ActionIcon>
              </Tooltip>
            </div>
            <div className={styles.credentialValue}>{cleanId}</div>
          </div>

          {/* Passcode Card */}
          {resolvedPasscode ? (
            <div
              className={styles.credentialCard}
              onClick={handleCopyPasscode}
              title="Click to copy passcode"
            >
              <div className={styles.credentialHeader}>
                <span className={styles.credentialTitle}>
                  <IconKey size={13} />
                  Room Passcode
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <ActionIcon
                    size="xs"
                    variant="transparent"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPasscode(!showPasscode);
                    }}
                    title={showPasscode ? "Hide Passcode" : "Show Passcode"}
                  >
                    {showPasscode ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </ActionIcon>
                  <Tooltip label={passcodeCopied ? "Copied!" : "Copy Passcode"}>
                    <ActionIcon size="xs" variant="transparent" color={passcodeCopied ? "green" : "gray"}>
                      {passcodeCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                </div>
              </div>
              <div className={styles.credentialValue}>
                {showPasscode ? resolvedPasscode : "••••••••"}
              </div>
            </div>
          ) : (
            <div className={styles.credentialCard} style={{ cursor: "default", opacity: 0.8 }}>
              <div className={styles.credentialHeader}>
                <span className={styles.credentialTitle}>
                  <IconKey size={13} />
                  Room Passcode
                </span>
              </div>
              <div className={styles.credentialValue} style={{ color: "var(--text-secondary)" }}>
                None (Open)
              </div>
            </div>
          )}
        </div>

        {/* Quick Share Section */}
        <div className={styles.shareSection}>
          <span className={styles.shareTitle}>Quick Share</span>
          <div className={styles.shareGrid}>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.shareButton} ${styles.shareWhatsapp}`}
            >
              <IconBrandWhatsapp size={16} />
              <span>WhatsApp</span>
            </a>
            <a
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.shareButton} ${styles.shareTelegram}`}
            >
              <IconBrandTelegram size={16} />
              <span>Telegram</span>
            </a>
            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.shareButton} ${styles.shareTwitter}`}
            >
              <IconBrandX size={16} />
              <span>X (Twitter)</span>
            </a>
            <a
              href={mailtoUrl}
              className={`${styles.shareButton} ${styles.shareEmail}`}
            >
              <IconMail size={16} />
              <span>Email</span>
            </a>
          </div>
          {hasNativeShare && (
            <Button
              onClick={handleNativeShare}
              variant="light"
              color="violet"
              fullWidth
              leftSection={<IconShare size={16} />}
              style={{ marginTop: "4px" }}
            >
              Share via System / More Apps
            </Button>
          )}
        </div>

        {/* QR Code Section */}
        <div>
          <Button
            onClick={() => setShowQr(!showQr)}
            variant="default"
            fullWidth
            leftSection={<IconQrcode size={16} />}
          >
            {showQr ? "Hide QR Code" : "Show QR Code for Mobile Scanning"}
          </Button>

          {showQr && (
            <div className={styles.qrContainer}>
              <div className={styles.qrFrame}>
                <img
                  src={qrCodeUrl}
                  alt="Watch party QR Code"
                  className={styles.qrImage}
                />
              </div>
              <span className={styles.qrCaption}>
                Scan with your phone camera to join the room instantly
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
