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
  IconAlertTriangle,
  IconX,
  IconPower,
} from "@tabler/icons-react";
import { Menu, Tooltip, ActionIcon, Loader } from "@mantine/core";
import { HeaderSearchBar } from "./HeaderSearchBar";
import { getRoomUrl, getInviteMessage } from "../../utils/utils";
import { useOperationState, useRoomInitStage } from "../../hooks/useOperationState";
import { ReportModal } from "../Report/ReportModal";
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
  participantsLocked?: boolean;
  onToggleParticipantsLock?: () => void;
  canManageParticipantsLock?: boolean;
  isHost?: boolean;
  isOwner?: boolean;
  onEndSession?: () => void;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomTitle,
  onOpenSettings,
  onExit,
  onEndSession,
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
  participantsLocked,
  onToggleParticipantsLock,
  canManageParticipantsLock,
  isHost,
  isOwner,
}) => {
  const canManageRoom = Boolean(isHost || isOwner);
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const getCleanRoomId = () => {
    if (propRoomId) return propRoomId.replace(/^\//, "");
    const pathParts = window.location.pathname.split("/");
    return (pathParts[pathParts.length - 1] || "").replace(/^\//, "");
  };

  const cleanRoomId = getCleanRoomId();
  // Passcode is strictly available to host or room owner
  const resolvedPasscode = canManageRoom ? (propPasscode || "") : "";

  const roomUrl = getRoomUrl(cleanRoomId);
  const hostDisplayName = hostName || "Host";

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyInviteMessage = () => {
    // Non-hosts must NEVER leak the passcode in invite messages
    const msg = canManageRoom && resolvedPasscode
      ? getInviteMessage(cleanRoomId, resolvedPasscode)
      : `Hey! Join my watch party on CoWatch:\n\nLink: ${roomUrl}\n\nRoom ID:\n\`${cleanRoomId}\``;
    navigator.clipboard.writeText(msg);
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };


  const { isReady } = useRoomInitStage();
  const lockOp = useOperationState("participant-authority", "lock");
  const participantsLockOp = useOperationState("participant-authority", "participants-lock");

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

              {/* Password Row - Strictly Host/Owner Only */}
              {canManageRoom && (
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
              )}

              {/* Room Link & Invite Rows - Strictly Host/Owner Only */}
              {canManageRoom && (
                <>
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
                      <Tooltip label={copied ? "Copied!" : "Copy room link"} withArrow position="top">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color={copied ? "green" : "violet"}
                          onClick={handleCopyLink}
                          aria-label="Copy room link"
                        >
                          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        </ActionIcon>
                      </Tooltip>
                    </div>
                  </div>
                  <div className={styles.roomInfoRow}>
                    <span className={styles.roomInfoLabel}>
                      <IconMessageShare size={14} /> Invite Msg
                    </span>
                    <div className={styles.roomInfoValueWithCopy}>
                      <Tooltip label={copiedMsg ? "Copied!" : "Copy invite message"} withArrow position="top">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color={copiedMsg ? "green" : "violet"}
                          onClick={handleCopyInviteMessage}
                          aria-label="Copy invite message"
                        >
                          {copiedMsg ? <IconCheck size={12} /> : <IconCopy size={12} />}
                        </ActionIcon>
                      </Tooltip>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Menu.Divider />
            <Menu.Item
              leftSection={<IconSettings size={16} />}
              onClick={onOpenSettings}
            >
              {canManageRoom ? "Room settings" : "Preferences"}
            </Menu.Item>
            {canManageRoom && onEndSession && (
              <>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconPower size={16} />}
                  onClick={onEndSession}
                >
                  End Session
                </Menu.Item>
              </>
            )}
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
        {canManageParticipantsLock && onToggleParticipantsLock && (
          <Tooltip
            label={
              participantsLocked
                ? "Participants Locked (Click to unlock)"
                : "Lock Participants (Click to lock)"
            }
            position="bottom"
            withArrow
          >
            <button
              type="button"
              className={`${styles.lockBtn} ${participantsLocked ? styles.lockBtnLocked : ""}`}
              onClick={onToggleParticipantsLock}
              disabled={participantsLockOp.isPending}
              title={participantsLocked ? "Participants Locked" : "Lock Participants"}
              aria-label={participantsLocked ? "Participants Locked" : "Lock Participants"}
            >
              {participantsLockOp.showSpinner ? (
                <Loader size={14} color="violet" />
              ) : participantsLocked ? (
                <IconLock size={15} color="var(--color-warning)" />
              ) : (
                <IconLockOpen size={15} />
              )}
              <span>{participantsLocked ? "Participants Locked" : "Lock Participants"}</span>
            </button>
          </Tooltip>
        )}

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

      <ReportModal
        opened={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        targetRoomId={cleanRoomId}
      />
    </header>
  );
};
