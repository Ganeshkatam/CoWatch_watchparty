import React, { useState } from "react";
import QRCode from "react-qr-code";
import { Modal, Button, Tooltip, ActionIcon } from "@mantine/core";
import {
  IconCopy,
  IconCheck,
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconBrandX,
  IconMail,
  IconQrcode,
  IconShare,
  IconMessageShare,
  IconUsers,
  IconLink,
  IconExternalLink,
} from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";
import styles from "./InviteModal.module.css";

interface InviteModalProps {
  roomId?: string;
  passcode?: string;
  closeInviteModal: () => void;
  isHost?: boolean;
  isOwner?: boolean;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  roomId,
  passcode: propPasscode,
  closeInviteModal,
  isHost,
  isOwner,
}) => {
  const canManageCredentials = Boolean(isHost || isOwner);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [inviteMsgCopied, setInviteMsgCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  // Non-hosts are strictly forbidden from inviting users
  if (!canManageCredentials) {
    return null;
  }

  const pathParts = window.location.pathname.split("/");
  const roomIdOrVanity = roomId || pathParts[pathParts.length - 1] || "";
  const cleanId = roomIdOrVanity.replace(/^\//, "");

  // Passcode is strictly visible/manageable by host or room owner
  const resolvedPasscode = canManageCredentials && propPasscode ? propPasscode.trim() : "";

  const baseUrl = `${window.location.origin}/join/${cleanId}`;
  const fullUrl = baseUrl;

  // Non-hosts must never leak passcode in invite messages
  const inviteMessage = canManageCredentials && resolvedPasscode
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

  const whatsappText = canManageCredentials && resolvedPasscode
    ? `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
    : `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}`;

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`;

  const telegramText = canManageCredentials && resolvedPasscode
    ? `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
    : `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}`;

  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    fullUrl
  )}&text=${encodeURIComponent(telegramText)}`;

  const twitterText = `Join my watch party on CoWatch!\nRoom ID: ${cleanId}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    twitterText
  )}&url=${encodeURIComponent(fullUrl)}`;

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    "Join my CoWatch Party"
  )}&body=${encodeURIComponent(inviteMessage)}`;

  const qrUrlWithPasscode = canManageCredentials && resolvedPasscode
    ? `${fullUrl}#passcode=${encodeURIComponent(resolvedPasscode)}`
    : fullUrl;

  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = () => {
    if (!hasNativeShare) return;
    navigator
      .share({
        title: "Join my CoWatch Party",
        text: canManageCredentials && resolvedPasscode
          ? `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode}`
          : `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}`,
        url: fullUrl,
      })
      .catch(() => { });
  };

  return (
    <Modal
      opened
      centered
      onClose={closeInviteModal}
      className={styles.modalRoot}
      size={MODAL_SIZES.md}
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

        {/* Primary Link Card */}
        <div className={styles.linkCard}>
          <div className={styles.linkCardHeader}>
            <span className={styles.linkCardLabel}>
              <IconLink size={14} />
              Party Link
            </span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <Tooltip label="Open party link in new tab">
                <ActionIcon
                  component="a"
                  href={fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  variant="subtle"
                  color="gray"
                  title="Open party link in new tab"
                >
                  <IconExternalLink size={14} />
                </ActionIcon>
              </Tooltip>
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
          </div>

          <div className={styles.linkInputRow}>
            <div
              className={styles.urlDisplay}
              title="Click to copy or select party link"
              onClick={() => {
                const sel = window.getSelection()?.toString();
                if (sel && sel.length > 0) return;
                handleCopyInviteLink();
              }}
            >
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
        </div>

        {/* Quick Action Buttons: Native Share & QR Code */}
        <div style={{ display: "grid", gridTemplateColumns: hasNativeShare ? "1fr 1fr" : "1fr", gap: "8px" }}>
          {hasNativeShare && (
            <Button
              onClick={handleNativeShare}
              variant="light"
              color="violet"
              leftSection={<IconShare size={15} />}
            >
              System Share
            </Button>
          )}
          <Button
            onClick={() => setShowQr(!showQr)}
            variant={showQr ? "filled" : "default"}
            color={showQr ? "violet" : undefined}
            leftSection={<IconQrcode size={15} />}
          >
            {showQr ? "Hide QR Code" : "Show QR Code"}
          </Button>
        </div>

        {showQr && (
          <div className={styles.qrContainer}>
            <div className={styles.qrFrame} style={{ padding: "16px", background: "white", borderRadius: "12px", display: "inline-block" }}>
              <QRCode
                value={qrUrlWithPasscode}
                size={200}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
            <span className={styles.qrCaption}>
              Scan with phone camera to join instantly
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
};
