import React from "react";
import { Button } from "@mantine/core";
import {
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconMail,
  IconShare,
} from "@tabler/icons-react";
import styles from "./ShareActions.module.css";

interface ShareActionsProps {
  roomId: string;
  canonicalJoinUrl: string;
}

export const ShareActions: React.FC<ShareActionsProps> = ({
  roomId,
  canonicalJoinUrl,
}) => {
  const cleanId = roomId.replace(/^\//, "").trim();

  const shareText = `Join my watch party on CoWatch!\n\nLink: ${canonicalJoinUrl}\n\nRoom ID: ${cleanId}`;

  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    canonicalJoinUrl,
  )}&text=${encodeURIComponent(shareText)}`;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    "Join my CoWatch Party",
  )}&body=${encodeURIComponent(shareText)}`;

  const hasNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleNativeShare = () => {
    if (!hasNativeShare) return;
    navigator
      .share({
        title: "Join my CoWatch Party",
        text: shareText,
        url: canonicalJoinUrl,
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
