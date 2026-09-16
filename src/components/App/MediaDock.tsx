import React from "react";
import {
  IconBrowser,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconDots,
  IconFile,
  IconLink,
  IconList,
  IconLock,
  IconLockOpen,
  IconMaximize,
  IconMinimize,
  IconPlus,
  IconScreenShare,
  IconX,
  IconMessageDots,
} from "@tabler/icons-react";
import { Menu, Tooltip } from "@mantine/core";
import { MetadataContext } from "../../MetadataContext";
import ChatVideoCard from "../ChatVideoCard/ChatVideoCard";
import styles from "./MediaDock.module.css";

interface MediaDockProps {
  haveLock: boolean;
  onOpenScreenShare: () => void;
  onOpenVBrowser: () => void;
  onOpenFileShare: () => void;
  onOpenQuickAdd: () => void;
  playlist: PlaylistVideo[];
  onPlayPlaylistItem: (index: number) => void;
  onDeletePlaylistItem: (index: number) => void;
  onMovePlaylistItem: (from: number, to: number) => void;
  roomMedia?: string;
  onStopMedia?: () => void;
  isScreenSharing?: boolean;
  onStopScreenShare?: () => void;
  isPlayingVBrowser?: boolean;
  onStopVBrowser?: () => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  onOpenFeedback?: () => void;
}

export const MediaDock: React.FC<MediaDockProps> = ({
  haveLock,
  onOpenScreenShare,
  onOpenVBrowser,
  onOpenFileShare,
  onOpenQuickAdd,
  playlist,
  onPlayPlaylistItem,
  onDeletePlaylistItem,
  onMovePlaylistItem,
  roomMedia,
  onStopMedia,
  isScreenSharing,
  onStopScreenShare,
  isPlayingVBrowser,
  onStopVBrowser,
  isLocked,
  onToggleLock,
  isFullScreen,
  onToggleFullScreen,
  onOpenFeedback,
}) => {
  const metadata = React.useContext(MetadataContext);
  const [copied, setCopied] = React.useState(false);
  const [viewport, setViewport] = React.useState<{ width: number; height: number }>({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
  });

  React.useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isCompact = viewport.width < 520;
  const isMedium = viewport.width >= 520 && viewport.width < 768;
  const isLaptop = viewport.width > 1200;
  const isShortHeight = viewport.height < 600;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addMediaMenuWidth = isCompact ? Math.min(viewport.width - 24, 260) : 260;
  const playlistMenuWidth = isCompact
    ? Math.min(viewport.width - 24, 300)
    : isMedium
      ? 290
      : 340;
  const moreMenuWidth = isCompact ? Math.min(viewport.width - 24, 200) : 200;
  const playlistMaxHeight = isShortHeight
    ? Math.min(viewport.height * 0.5, 260)
    : 380;

  return (
    <div className={styles.dockContainer}>
      {/* Prioritized single stop button (VBrowser > ScreenShare > Standard Media) */}
      {isPlayingVBrowser && onStopVBrowser ? (
        <button
          type="button"
          className={styles.stopBtn}
          onClick={onStopVBrowser}
          disabled={!haveLock}
        >
          <IconX size={15} />
          <span>{isCompact ? "Stop" : "Stop VBrowser"}</span>
        </button>
      ) : isScreenSharing && onStopScreenShare ? (
        <button
          type="button"
          className={styles.stopBtn}
          onClick={onStopScreenShare}
        >
          <IconX size={15} />
          <span>{isCompact ? "Stop" : "Stop Share"}</span>
        </button>
      ) : Boolean(roomMedia) && onStopMedia ? (
        <button
          type="button"
          className={styles.stopBtn}
          onClick={onStopMedia}
          disabled={!haveLock}
        >
          <IconX size={15} />
          <span>{isCompact ? "Stop" : "Stop playback"}</span>
        </button>
      ) : null}

      {/* Add Media Dropdown Menu or Expanded Buttons */}
      {isCompact ? (
        <Menu
          shadow="xl"
          width={addMediaMenuWidth}
          position="top-start"
          offset={8}
          withinPortal
        >
          <Menu.Target>
            <button
              type="button"
              className={styles.addMediaBtn}
              disabled={!haveLock}
            >
              <IconPlus size={16} stroke={2.5} />
              <span>Add</span>
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Add to watch party</Menu.Label>

            <Menu.Item
              leftSection={<IconScreenShare size={18} color="var(--media-video)" />}
              onClick={onOpenScreenShare}
            >
              <div className={styles.menuItemWithDesc}>
                <span className={styles.menuItemTitle}>Share screen</span>
              </div>
            </Menu.Item>

            {metadata.capabilities?.virtualBrowser && (
              <Menu.Item
                leftSection={<IconBrowser size={18} color="var(--color-success)" />}
                onClick={onOpenVBrowser}
              >
                <div className={styles.menuItemWithDesc}>
                  <span className={styles.menuItemTitle}>Browser</span>
                </div>
              </Menu.Item>
            )}

            <Menu.Item
              leftSection={<IconFile size={18} color="var(--media-magnet)" />}
              onClick={onOpenFileShare}
            >
              <div className={styles.menuItemWithDesc}>
                <span className={styles.menuItemTitle}>Upload file</span>
              </div>
            </Menu.Item>

            <Menu.Item
              leftSection={<IconLink size={18} color="var(--color-pink)" />}
              onClick={onOpenQuickAdd}
            >
              <div className={styles.menuItemWithDesc}>
                <span className={styles.menuItemTitle}>Video URL / Search</span>
              </div>
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ) : (
        <>
          <button
            type="button"
            className={styles.addMediaIconBtn}
            onClick={onOpenScreenShare}
            disabled={!haveLock}
          >
            <IconScreenShare size={18} />
          </button>

          {metadata.capabilities?.virtualBrowser && (
            <button
              type="button"
              className={styles.addMediaIconBtn}
              onClick={onOpenVBrowser}
              disabled={!haveLock}
            >
              <IconBrowser size={18} />
            </button>
          )}

          <button
            type="button"
            className={styles.addMediaIconBtn}
            onClick={onOpenFileShare}
            disabled={!haveLock}
          >
            <IconFile size={18} />
          </button>

          <button
            type="button"
            className={styles.addMediaIconBtn}
            onClick={onOpenQuickAdd}
            disabled={!haveLock}
          >
            <IconLink size={18} />
          </button>
        </>
      )}

      {/* Playlist Button & Dropdown */}
      <Menu
        shadow="xl"
        width={playlistMenuWidth}
        position="top"
        offset={8}
        withinPortal
      >
        <Menu.Target>
          <Tooltip label="View playlist" withArrow>
            <button type="button" className={styles.dockBtn}>
              <IconList size={18} />
              {!isCompact && !isLaptop && <span>Playlist</span>}
              <span className={styles.badge}>{playlist.length}</span>
            </button>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown
          style={{
            maxHeight: playlistMaxHeight,
            overflowY: playlist.length > 0 ? "auto" : "visible",
          }}
        >
          <Menu.Label>Room Playlist ({playlist.length})</Menu.Label>
          {playlist.length === 0 && (
            <Menu.Item disabled>There are no items in the playlist.</Menu.Item>
          )}
          {playlist.map((item: PlaylistVideo, index: number) => {
            const videoItem = { ...item };
            if (Boolean(videoItem.img)) {
              videoItem.type = "youtube";
            }
            return (
              <Menu.Item key={index} closeMenuOnClick={false}>
                <ChatVideoCard
                  video={videoItem}
                  index={index}
                  controls
                  onPlay={onPlayPlaylistItem}
                  onPlayNext={(idx) => onMovePlaylistItem(idx, 0)}
                  onRemove={onDeletePlaylistItem}
                  disabled={!haveLock}
                />
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>

      {/* More Options Menu / Buttons */}
      {isLaptop ? (
        <>
          {onToggleFullScreen && (
            <Tooltip label={isFullScreen ? "Exit Fullscreen" : "Fullscreen"} withArrow>
              <button type="button" className={styles.iconBtn} onClick={onToggleFullScreen}>
                {isFullScreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
              </button>
            </Tooltip>
          )}
          {onToggleLock && (
            <Tooltip label={isLocked ? "Unlock controls" : "Lock controls"} withArrow>
              <button type="button" className={styles.iconBtn} disabled={!haveLock} onClick={onToggleLock}>
                {isLocked ? <IconLock size={18} color="var(--color-warning)" /> : <IconLockOpen size={18} />}
              </button>
            </Tooltip>
          )}
          <Tooltip label={copied ? "Link Copied!" : "Copy room link"} withArrow>
            <button type="button" className={styles.iconBtn} onClick={handleCopyLink}>
              {copied ? <IconCheck size={18} color="var(--color-live)" /> : <IconCopy size={18} />}
            </button>
          </Tooltip>
          {onOpenFeedback && (
            <Tooltip label="Send feedback" withArrow>
              <button type="button" className={styles.iconBtn} onClick={onOpenFeedback}>
                <IconMessageDots size={18} color="var(--color-violet)" />
              </button>
            </Tooltip>
          )}
        </>
      ) : (
        <Menu
          shadow="xl"
          width={moreMenuWidth}
          position="top-end"
          offset={8}
          withinPortal
        >
          <Menu.Target>
            <button type="button" className={styles.iconBtn} title="More actions">
              <IconDots size={16} />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            {onToggleFullScreen && (
              <Menu.Item
                leftSection={
                  isFullScreen ? (
                    <IconMinimize size={16} />
                  ) : (
                    <IconMaximize size={16} />
                  )
                }
                onClick={onToggleFullScreen}
              >
                {isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
              </Menu.Item>
            )}
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
                {isLocked ? "Unlock controls" : "Lock controls"}
              </Menu.Item>
            )}
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
            {onOpenFeedback && (
              <Menu.Item
                leftSection={<IconMessageDots size={16} color="var(--color-violet)" />}
                onClick={onOpenFeedback}
              >
                Send feedback
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </div>
  );
};

