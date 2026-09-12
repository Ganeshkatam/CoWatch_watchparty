import React, { useState } from "react";
import { Modal, Button, Tooltip, ActionIcon, PasswordInput, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { supabase } from "../../utils/supabaseClient";
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
  IconEye,
  IconEyeOff,
  IconLink,
  IconExternalLink,
  IconUserPlus,
} from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";
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
  const [targetUsername, setTargetUsername] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);

  const handleSendDirectInvite = async () => {
    if (!targetUsername.trim()) return;
    setSendingInvite(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        notifications.show({
          title: "Sign In Required",
          message: "Please sign in to send direct invitations.",
          color: "yellow",
        });
        return;
      }
      const res = await fetch("/api/notifications/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roomId: cleanId,
          targetUsername: targetUsername.trim(),
          invitationId: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notifications.show({
          title: "Invite Failed",
          message: data.error || "Failed to send invite",
          color: "red",
        });
      } else {
        setTargetUsername("");
        notifications.show({
          title: "Invite Sent",
          message: data.message || "Invitation sent successfully",
          color: "green",
        });
      }
    } catch {
      notifications.show({
        title: "Invite Error",
        message: "Network error while sending invite",
        color: "red",
      });
    } finally {
      setSendingInvite(false);
    }
  };

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

        {/* Room Credentials Grid */}
        <div className={styles.credentialsGrid}>
          {/* Room ID Card */}
          <div
            className={styles.credentialCard}
            onClick={() => {
              const sel = window.getSelection()?.toString();
              if (sel && sel.length > 0) return;
              handleCopyRoomId();
            }}
            title="Click to copy, or select Room ID"
          >
            <div className={styles.credentialHeader}>
              <span className={styles.credentialTitle}>
                <IconHash size={13} />
                Room Code / Slug
              </span>
              <Tooltip label={roomIdCopied ? "Copied!" : "Copy Room Code"}>
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color={roomIdCopied ? "green" : "gray"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyRoomId();
                  }}
                >
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
              onClick={() => {
                const sel = window.getSelection()?.toString();
                if (sel && sel.length > 0) return;
                handleCopyPasscode();
              }}
              title="Click to copy, or select Passcode"
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
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      color={passcodeCopied ? "green" : "gray"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPasscode();
                      }}
                    >
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

        {/* Direct CoWatch Invite */}
        <div style={{ marginTop: "16px", marginBottom: "16px", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#9ca3af", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <IconUserPlus size={14} /> Send CoWatch Invite
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <TextInput
              placeholder="Username"
              value={targetUsername}
              onChange={(e) => setTargetUsername(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSendDirectInvite();
                }
              }}
              size="xs"
              style={{ flex: 1 }}
              styles={{
                input: {
                  background: "#18181b",
                  borderColor: "rgba(255,255,255,0.12)",
                  color: "#fff",
                },
              }}
            />
            <Button
              size="xs"
              variant="filled"
              color="indigo"
              loading={sendingInvite}
              onClick={handleSendDirectInvite}
              disabled={!targetUsername.trim()}
            >
              Send
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
            <div className={styles.qrFrame}>
              <img
                src={qrCodeUrl}
                alt="Watch party QR Code"
                className={styles.qrImage}
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
