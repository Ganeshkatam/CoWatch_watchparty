import React, { useState, useEffect } from "react";
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
  IconHash,
  IconLock,
} from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";
import { serverPath } from "../../utils/utils";
import { getAccessToken, supabase } from "../../utils/supabaseClient";
import { DirectInviteForm } from "./DirectInviteForm";
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
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const [passcodeCopied, setPasscodeCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [fetchedPasscode, setFetchedPasscode] = useState<string>("");

  const pathParts = window.location.pathname.split("/");
  const roomIdOrVanity = roomId || pathParts[pathParts.length - 1] || "";
  const cleanId = roomIdOrVanity.replace(/^\//, "");

  // Non-hosts are strictly forbidden from inviting users
  if (!canManageCredentials) {
    return null;
  }

  // Passcode is strictly visible/manageable by host or room owner
  useEffect(() => {
    let isCancelled = false;
    if (canManageCredentials && !propPasscode && cleanId) {
      (async () => {
        try {
          const token = await getAccessToken();
          const { data } = await supabase.auth.getUser();
          const user = data.user;
          if (user && token && serverPath) {
            const res = await fetch(
              `${serverPath}/roomDetails?uid=${encodeURIComponent(user.id)}&token=${encodeURIComponent(token)}&roomId=${encodeURIComponent(cleanId)}`
            );
            if (res.ok) {
              const freshData = await res.json();
              if (!isCancelled && freshData?.currentPasscode) {
                setFetchedPasscode(freshData.currentPasscode.trim());
              }
            }
          }
        } catch {
          // Silent fallback
        }
      })();
    }
    return () => {
      isCancelled = true;
    };
  }, [canManageCredentials, propPasscode, cleanId]);

  const resolvedPasscode = canManageCredentials
    ? (propPasscode ? propPasscode.trim() : fetchedPasscode.trim())
    : "";

  const baseUrl = `${window.location.origin}/join/${cleanId}`;
  const fullUrl = baseUrl;

  // Non-hosts must never leak passcode in invite messages
  const inviteMessage = canManageCredentials && resolvedPasscode
    ? `Hey! Join my watch party on CoWatch:\n\nLink: ${fullUrl}\n\nRoom ID:\n\`${cleanId}\`\n\nPasscode:\n\`${resolvedPasscode}\``
    : `Hey! Join my watch party on CoWatch:\n\nLink: ${fullUrl}\n\nRoom ID:\n\`${cleanId}\``;

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

  const handleCopyRoomId = () => {
    if (!cleanId) return;
    navigator.clipboard.writeText(cleanId);
    setRoomIdCopied(true);
    setTimeout(() => setRoomIdCopied(false), 2000);
  };

  const handleCopyPasscode = () => {
    if (!resolvedPasscode) return;
    navigator.clipboard.writeText(resolvedPasscode);
    setPasscodeCopied(true);
    setTimeout(() => setPasscodeCopied(false), 2000);
  };

  const whatsappText = canManageCredentials && resolvedPasscode
    ? `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\n\nRoom ID:\n\`${cleanId}\`\n\nPasscode:\n\`${resolvedPasscode}\``
    : `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\n\nRoom ID:\n\`${cleanId}\``;

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`;

  const telegramText = canManageCredentials && resolvedPasscode
    ? `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\n\nRoom ID:\n\`${cleanId}\`\n\nPasscode:\n\`${resolvedPasscode}\``
    : `Join my watch party on CoWatch!\n\nLink: ${fullUrl}\n\nRoom ID:\n\`${cleanId}\``;

  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    fullUrl
  )}&text=${encodeURIComponent(telegramText)}`;

  const twitterText = `Join my watch party on CoWatch!\nRoom ID: \`${cleanId}\``;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    twitterText
  )}&url=${encodeURIComponent(fullUrl)}`;

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    "Join my CoWatch Party"
  )}&body=${encodeURIComponent(inviteMessage)}`;

  // Canonical QR URL: strictly join entrypoint without embedded credentials
  const qrCanonicalUrl = fullUrl;

  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = () => {
    if (!hasNativeShare) return;
    navigator
      .share({
        title: "Join my CoWatch Party",
        text: inviteMessage,
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
        {canManageCredentials && !propPasscode && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Room Passcode (Optional for open rooms)
            </span>
          </div>
        )}

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

        {/* Direct Username Invitation */}
        <DirectInviteForm roomId={cleanId} />

        {/* Room ID & Passcode Cards - Individually Copyable */}
        <div className={styles.credentialsGrid}>
          {/* Room ID Card */}
          <div
            className={styles.credentialCard}
            onClick={handleCopyRoomId}
            title="Click to copy Room ID"
          >
            <div className={styles.credentialHeader}>
              <span className={styles.credentialTitle}>
                <IconHash size={13} />
                Room ID
              </span>
              <Tooltip label={roomIdCopied ? "Copied!" : "Copy Room ID"} withArrow position="top">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color={roomIdCopied ? "teal" : "gray"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyRoomId();
                  }}
                  title="Copy Room ID"
                >
                  {roomIdCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </ActionIcon>
              </Tooltip>
            </div>
            <div className={styles.credentialValue}>
              <span>{cleanId}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: roomIdCopied ? "#10b981" : "var(--text-muted)", transition: "color 0.2s" }}>
                {roomIdCopied ? "Copied!" : "Copy"}
              </span>
            </div>
          </div>

          {/* Passcode Card - Strictly restricted to host or room owner */}
          {canManageCredentials && (
            <div
              className={styles.credentialCard}
              onClick={resolvedPasscode ? handleCopyPasscode : undefined}
              title={resolvedPasscode ? "Click to copy Passcode" : "No passcode required"}
              style={{ cursor: resolvedPasscode ? "pointer" : "default" }}
            >
              <div className={styles.credentialHeader}>
                <span className={styles.credentialTitle}>
                  <IconLock size={13} />
                  Room Passcode
                </span>
                {resolvedPasscode ? (
                  <Tooltip label={passcodeCopied ? "Copied!" : "Copy Passcode"} withArrow position="top">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color={passcodeCopied ? "teal" : "gray"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPasscode();
                      }}
                      title="Copy Passcode"
                    >
                      {passcodeCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Open</span>
                )}
              </div>
              <div className={styles.credentialValue}>
                <span>{resolvedPasscode || "None (Open)"}</span>
                {resolvedPasscode && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: passcodeCopied ? "#10b981" : "var(--text-muted)", transition: "color 0.2s" }}>
                    {passcodeCopied ? "Copied!" : "Copy"}
                  </span>
                )}
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
                value={qrCanonicalUrl}
                size={200}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
            <span className={styles.qrCaption} style={{ marginTop: "4px" }}>
              Scan with phone camera to join via admission gateway
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
};
