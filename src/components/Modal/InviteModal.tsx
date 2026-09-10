import React, { useState } from "react";
import { Modal, Button, Tooltip, ActionIcon, PasswordInput } from "@mantine/core";
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
  const [manualPasscode, setManualPasscode] = useState("");
  const [passcodePrompt, setPasscodePrompt] = useState(false);

  const pathParts = window.location.pathname.split("/");
  const roomIdOrVanity = roomId || pathParts[pathParts.length - 1] || "";
  const cleanId = roomIdOrVanity.replace(/^\//, "");

  const resolvedPasscode = (propPasscode || manualPasscode).trim();

  const baseUrl = `${window.location.origin}/join/${cleanId}`;
  const fullUrl = baseUrl;

  // Enforce passcode inclusion in every generated invite message
  const inviteMessage = `Hey! Join my watch party on CoWatch:\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode || "[Passcode Required - Ask Host]"}`;

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(fullUrl);
    setInviteLinkCopied(true);
    setTimeout(() => setInviteLinkCopied(false), 2000);
  };

  const handleCopyInviteMessage = () => {
    if (!resolvedPasscode) {
      setPasscodePrompt(true);
    }
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

  const whatsappText = `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode || "[Passcode Required - Ask Host]"}`;

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`;

  const telegramText = `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode || "[Passcode Required - Ask Host]"}`;

  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    fullUrl
  )}&text=${encodeURIComponent(telegramText)}`;

  const twitterText = `Join my watch party on CoWatch!\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode || "[Passcode Required - Ask Host]"}`;
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
        text: `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\nRoom ID: ${cleanId}\nPasscode: ${resolvedPasscode || "[Passcode Required - Ask Host]"}`,
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
              <strong>Passcode Protected Room.</strong> Guests will join via the link and must enter the room passcode.
            </div>
          </div>
        ) : (
          <div className={`${styles.statusBanner} ${styles.statusBannerProtected}`}>
            <IconLock size={18} className={styles.statusBannerIcon} />
            <div>
              <strong>Passcode Required.</strong> Every room requires a passcode. Enter the room passcode below to include it in all invite messages.
            </div>
          </div>
        )}

        {!propPasscode && (
          <PasswordInput
            size="sm"
            label="Room Passcode (Required for Invite)"
            placeholder="Enter room passcode"
            value={manualPasscode}
            onChange={(e) => {
              setManualPasscode(e.currentTarget.value);
              setPasscodePrompt(false);
            }}
            error={passcodePrompt && !manualPasscode ? "Passcode is required for guests to enter" : undefined}
          />
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
            <div className={styles.credentialCard} style={{ cursor: "default", opacity: 0.9 }}>
              <div className={styles.credentialHeader}>
                <span className={styles.credentialTitle}>
                  <IconKey size={13} />
                  Room Passcode
                </span>
              </div>
              <div className={styles.credentialValue} style={{ color: "#fbbf24", fontSize: "12px" }}>
                Required (Enter above)
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
