import React, { useEffect, useState } from "react";
import { Modal } from "@mantine/core";
import { ComboBox } from "../ComboBox/ComboBox";
import styles from "./QuickAdd.module.css";

interface QuickAddProps {
  roomSetMedia: (value: string) => void;
  playlistAdd: (value: string) => void;
  roomMedia: string;
  getMediaDisplayName: (input: string) => string;
  mediaPath: string | undefined;
  disabled?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const QuickAdd: React.FC<QuickAddProps> = ({
  roomSetMedia,
  playlistAdd,
  roomMedia,
  getMediaDisplayName,
  mediaPath,
  disabled,
  isOpen,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = isOpen !== undefined;
  const isModalOpen = isControlled ? isOpen : internalOpen;

  const setOpen = (open: boolean) => {
    if (isControlled && onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalOpen(open);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!isModalOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  const isMac =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  const handleSetMedia = (val: string) => {
    roomSetMedia(val);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={styles.triggerBtn}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Open Quick Add (Cmd/Ctrl + K)"
      >
        <span className={styles.kbdBadge}>{isMac ? "⌘" : "Ctrl"} K</span>
        <div className={styles.triggerText}>
          <span className={styles.triggerTitle}>Quick add</span>
          <span className={styles.triggerSub}>Paste a link or search</span>
        </div>
      </button>

      <Modal
        opened={isModalOpen}
        onClose={() => setOpen(false)}
        title="Add to Watch Party"
        centered
        radius="lg"
        size="lg"
        overlayProps={{
          backgroundOpacity: 0.65,
          blur: 8,
        }}
      >
        <div style={{ padding: "8px 0 16px 0" }}>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              margin: "0 0 12px 0",
            }}
          >
            Paste a direct video file URL (MP4, WebM, HLS), magnet link, YouTube
            link, or type a search query:
          </p>
          <ComboBox
            roomSetMedia={handleSetMedia}
            playlistAdd={playlistAdd}
            roomMedia={roomMedia}
            getMediaDisplayName={getMediaDisplayName}
            mediaPath={mediaPath}
            disabled={disabled}
          />
        </div>
      </Modal>
    </>
  );
};
