import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLock,
  IconLockOpen,
  IconMessage,
  IconSettings,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { Menu, Tooltip } from "@mantine/core";
import { SignInButton } from "./TopBar";
import { HeaderSearchBar } from "./HeaderSearchBar";
import styles from "./RoomHeader.module.css";

interface RoomHeaderProps {
  roomTitle: string;
  participantCount: number;
  currentTab: string;
  onSelectTab: (tab: "people" | "chat") => void;
  onOpenSettings: () => void;
  onExit: () => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  haveLock?: boolean;
  currentMedia?: string;
  mediaDisplayName?: string;
  onOpenQuickAdd?: () => void;
  roomSetMedia?: (value: string) => void;
  playlistAdd?: (value: string) => void;
  mediaPath?: string;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomTitle,
  participantCount,
  currentTab,
  onSelectTab,
  onOpenSettings,
  onExit,
  isLocked,
  onToggleLock,
  haveLock,
  currentMedia,
  mediaDisplayName,
  onOpenQuickAdd,
  roomSetMedia,
  playlistAdd,
  mediaPath,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <Link to="/" className={styles.logoLink} title="Go to home">
          <img
            src="/logo192.png"
            alt="CoWatch"
            className={styles.logoImg}
          />
          <span className={styles.logoText}>CoWatch</span>
        </Link>

        <div className={styles.divider} />

        <Menu shadow="md" width={220} position="bottom-start">
          <Menu.Target>
            <button
              className={styles.roomDropdownBtn}
              type="button"
              title="Room details and options"
            >
              <span>{roomTitle || "Watch Party Room"}</span>
              <IconChevronDown size={14} stroke={1.5} />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Room Options</Menu.Label>
            <Menu.Item
              leftSection={
                copied ? (
                  <IconCheck size={16} color="var(--color-live)" />
                ) : (
                  <IconCopy size={16} />
                )
              }
              onClick={handleCopyLink}
            >
              {copied ? "Link Copied!" : "Copy room link"}
            </Menu.Item>
            {onToggleLock && (
              <Menu.Item
                disabled={!haveLock}
                leftSection={
                  isLocked ? (
                    <IconLock size={16} color="var(--color-warning)" />
                  ) : (
                    <IconLockOpen size={16} />
                  )
                }
                onClick={onToggleLock}
              >
                {isLocked ? "Unlock room controls" : "Lock room controls"}
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={<IconSettings size={16} />}
              onClick={onOpenSettings}
            >
              Room settings
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <div className={styles.divider} />

        <Tooltip
          label={
            currentMedia
              ? `Now Playing: ${mediaDisplayName || currentMedia} (Click to change)`
              : "Nothing playing (Click to add media)"
          }
          position="bottom"
          openDelay={300}
        >
          <button
            type="button"
            className={`${styles.nowPlayingBadge} ${
              currentMedia ? styles.nowPlayingActive : styles.nowPlayingIdle
            }`}
            onClick={onOpenQuickAdd}
            title={
              currentMedia
                ? `Playing: ${mediaDisplayName || currentMedia}`
                : "Add something to play"
            }
          >
            {currentMedia ? (
              <>
                <div className={styles.playingDot} />
                <span className={styles.nowPlayingLabel}>Playing:</span>
                <span className={styles.nowPlayingTitle}>
                  {mediaDisplayName || currentMedia}
                </span>
              </>
            ) : (
              <>
                <div className={styles.idleDot} />
                <span className={styles.idleText}>Nothing playing</span>
              </>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Center Inline Search Bar (Option 2) */}
      {roomSetMedia && playlistAdd && (
        <div className={styles.centerSection}>
          <HeaderSearchBar
            roomSetMedia={roomSetMedia}
            playlistAdd={playlistAdd}
            mediaPath={mediaPath}
            disabled={!haveLock}
          />
        </div>
      )}

      <div className={styles.rightSection}>
        <button
          type="button"
          className={`${styles.actionBtn} ${
            currentTab === "people" ? styles.actionBtnActive : ""
          }`}
          onClick={() => onSelectTab("people")}
          title="Toggle People panel"
        >
          <IconUsersGroup size={16} stroke={1.5} />
          <span>{participantCount}</span>
        </button>

        <button
          type="button"
          className={`${styles.iconOnlyBtn} ${
            currentTab === "chat" ? styles.actionBtnActive : ""
          }`}
          onClick={() => onSelectTab("chat")}
          title="Toggle Messages panel"
        >
          <IconMessage size={16} stroke={1.5} />
        </button>

        <button
          type="button"
          className={styles.iconOnlyBtn}
          onClick={onOpenSettings}
          title="Open Settings"
        >
          <IconSettings size={16} stroke={1.5} />
        </button>

        <button
          type="button"
          className={styles.exitBtn}
          onClick={onExit}
          title="Leave room"
        >
          <IconX size={15} stroke={2} />
          <span className={styles.exitText}>Exit</span>
        </button>

        <SignInButton />
      </div>
    </header>
  );
};
