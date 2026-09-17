import React from "react";
import { Button } from "@mantine/core";
import {
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconMail,
  IconShare,
} from "@tabler/icons-react";
import { formatInvitationMessage } from "../../utils/notificationAction";
import styles from "./ShareActions.module.css";

export interface ShareActionsProps {
  roomId: string;
  roomTitle?: string;
  passcode?: string;
  invitationUrl: string;
  inviterName?: string;
}

export const ShareActions: React.FC<ShareActionsProps> = ({
  roomId,
  roomTitle,
  passcode,
  invitationUrl,
  inviterName,
}) => {
  const cleanId = roomId.replace(/^\//, "").trim();
  const title = roomTitle?.trim() || cleanId;
  const canonicalMessage = formatInvitationMessage({
    roomId: cleanId,
    roomTitle: title,
    passcode,
    invitationUrl,
    inviterName,
  });

  // WhatsApp accepts the complete text message
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(canonicalMessage)}`;

  // Telegram accepts a dedicated 'url' parameter and clean message 'text'
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    invitationUrl,
  )}&text=${encodeURIComponent(canonicalMessage)}`;

  // Email body formats canonical invitation message
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    `Watch Party Invite: ${title}`,
  )}&body=${encodeURIComponent(canonicalMessage)}`;

  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = () => {
    if (!hasNativeShare) return;
    navigator
      .share({
        title: `Join ${title} on CoWatch`,
        text: canonicalMessage,
        url: invitationUrl,
      })
      .catch(() => {});
  };

  return (
    <div className={styles.container}>
      <span className={styles.title}>Share to Apps</span>

      <div className={styles.grid}>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.button} ${styles.whatsapp}`}
          aria-label="Share on WhatsApp"
        >
          <IconBrandWhatsapp size={16} />
          <span>WhatsApp</span>
        </a>

        <a
          href={telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.button} ${styles.telegram}`}
          aria-label="Share on Telegram"
        >
          <IconBrandTelegram size={16} />
          <span>Telegram</span>
        </a>

        <a
          href={mailtoUrl}
          className={`${styles.button} ${styles.email}`}
          aria-label="Share via Email"
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
          className={styles.nativeShareButton}
          leftSection={<IconShare size={15} />}
        >
          System Share
        </Button>
      )}
    </div>
  );
};
