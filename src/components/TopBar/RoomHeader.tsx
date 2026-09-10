import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconCrown,
  IconEye,
  IconEyeOff,
  IconHash,
  IconKey,
  IconLink,
  IconLock,
  IconLockOpen,
  IconMessageShare,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { Menu, Tooltip, ActionIcon } from "@mantine/core";
import { HeaderSearchBar } from "./HeaderSearchBar";
import { getRoomUrl, getInviteMessage } from "../../utils/utils";
import styles from "./RoomHeader.module.css";

interface RoomHeaderProps {
  roomTitle: string;
  participantCount?: number;
  currentTab?: string;
  onSelectTab?: (tab: "people" | "chat") => void;
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
  roomId?: string;
  hostName?: string;
  passcode?: string;
  onSelectStream?: (result: SearchResult) => Promise<void> | void;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomTitle,
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
  roomId: propRoomId,
  hostName,
  passcode: propPasscode,
  onSelectStream,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const getCleanRoomId = () => {
    if (propRoomId) return propRoomId.replace(/^\//, "");
    const pathParts = window.location.pathname.split("/");
    return (pathParts[pathParts.length - 1] || "").replace(/^\//, "");
  };

  const cleanRoomId = getCleanRoomId();
  const resolvedPasscode = propPasscode || "";

  const roomUrl = getRoomUrl(cleanRoomId);
  const hostDisplayName = hostName || "Host";

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyInviteMessage = () => {
    const msg = getInviteMessage(cleanRoomId, resolvedPasscode);
    navigator.clipboard.writeText(msg);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(cleanRoomId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyPasscode = () => {
    if (!resolvedPasscode) return;
    navigator.clipboard.writeText(resolvedPasscode);
    setCopiedPass(true);
    setTimeout(() => setCopiedPass(false), 2000);
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

        <Menu shadow="lg" width={300} position="bottom-start" radius="md">
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
            {/* Room Details Card */}
            <div className={styles.roomInfoCard}>
              {/* Host Name Row */}
              <div className={styles.roomInfoRow}>
                <span className={styles.roomInfoLabel}>
                  <IconCrown size={14} color="var(--color-warning)" /> Host
                </span>
                <span className={styles.roomInfoValue} title={hostDisplayName}>
                  {hostDisplayName}
                </span>
              </div>

              {/* Room ID Row */}
              <div className={styles.roomInfoRow}>
                <span className={styles.roomInfoLabel}>
                  <IconHash size={14} /> Room ID
                </span>
                <div className={styles.roomInfoValueWithCopy}>
                  <span className={styles.codeSnippet} title={cleanRoomId}>
                    {cleanRoomId}
                  </span>
                  <Tooltip label={copiedId ? "Copied!" : "Copy ID"} withArrow position="top">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color={copiedId ? "green" : "gray"}
                      onClick={handleCopyRoomId}
                      aria-label="Copy Room ID"
                    >
                      {copiedId ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    </ActionIcon>
                  </Tooltip>
                </div>
              </div>

              {/* Password Row */}
              <div className={styles.roomInfoRow}>
                <span className={styles.roomInfoLabel}>
                  <IconKey size={14} /> Password
                </span>
                <div className={styles.roomInfoValueWithCopy}>
                  {resolvedPasscode ? (
                    <>
                      <span
                        className={styles.codeSnippet}
                        title={showPassword ? resolvedPasscode : "Password hidden"}
                      >
                        {showPassword ? resolvedPasscode : "••••••••"}
                      </span>
                      <Tooltip label={showPassword ? "Hide password" : "Show password"} withArrow position="top">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="gray"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label="Toggle password visibility"
                        >
                          {showPassword ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={copiedPass ? "Copied!" : "Copy password"} withArrow position="top">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color={copiedPass ? "green" : "gray"}
                          onClick={handleCopyPasscode}
                          aria-label="Copy Password"
                        >
                          {copiedPass ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        </ActionIcon>
                      </Tooltip>
                    </>
                  ) : (
                    <span style={{ fontSize: "11.5px", color: "var(--text-muted)" }}>None (Open)</span>
                  )}
                </div>
              </div>

              {/* Room Link Row */}
              <div className={styles.roomInfoRow}>
                <span className={styles.roomInfoLabel}>
                  <IconLink size={14} /> Room Link
                </span>
                <div className={styles.roomInfoValueWithCopy}>
                  <span
                    className={styles.codeSnippet}
                    style={{ maxWidth: "120px" }}
                    title={roomUrl}
                  >
                    {roomUrl}
                  </span>
                  <Tooltip label={copied ? "Copied!" : "Copy Link"} withArrow position="top">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color={copied ? "green" : "violet"}
                      onClick={handleCopyLink}
                      aria-label="Copy Room Link"
                    >
                      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    </ActionIcon>
                  </Tooltip>
                </div>
              </div>
            </div>

            <Menu.Divider />

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
            <Menu.Item
              leftSection={
                copiedMsg ? (
                  <IconCheck size={16} color="var(--color-live)" />
                ) : (
                  <IconMessageShare size={16} />
                )
              }
              onClick={handleCopyInviteMessage}
            >
              {copiedMsg ? "Invite Copied!" : "Copy invite message"}
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
            className={`${styles.nowPlayingBadge} ${currentMedia ? styles.nowPlayingActive : styles.nowPlayingIdle
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
            onSelectStream={onSelectStream}
          />
        </div>
      )}

      <div className={styles.rightSection}>
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
      </div>
    </header>
  );
};
