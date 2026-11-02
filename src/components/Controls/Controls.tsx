import React, { useMemo, useState } from "react";
import { Badge, Button, Menu, Progress, Slider, Tooltip } from "@mantine/core";
import { formatTimestamp, softWhite } from "../../utils/utils";
import styles from "./Controls.module.css";
import { MetadataContext } from "../../MetadataContext";
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconRefresh,
  IconCheck,
  IconRepeat,
  IconBadgeCc,
  IconVolumeOff,
  IconVolume,
  IconTheater,
  IconMaximize,
  IconPictureInPicture,
  IconPlayerSkipForwardFilled,
  IconPlayerTrackPrevFilled,
  IconPlayerTrackNextFilled,
} from "@tabler/icons-react";

interface ControlsProps {
  duration: number;
  video: string;
  paused: boolean;
  muted: boolean;
  volume: number;
  subtitled: boolean;
  currentTime: number;
  disabled?: boolean;
  leaderTime?: number;
  isPauseDisabled?: boolean;
  playbackRate: number;
  roomPlaybackRate: number;
  isYouTube: boolean;
  isLiveStream: boolean;
  timeRanges: { start: number; end: number }[];
  loop: boolean;
  roomTogglePlay: () => void;
  roomSeek: (time: number) => void;
  roomSetPlaybackRate: (rate: number) => void;
  roomSetLoop: (loop: boolean) => void;
  localFullScreen: (fs: boolean) => void;
  localToggleMute: () => void;
  localSubtitleModal: () => void;
  localSeek: () => void;
  localSetVolume: (volume: number) => void;
  localSetSubtitleMode: (mode: TextTrackMode, lang?: string) => void;
  roomPlaylistPlay: (index: number) => void;
  playlist: PlaylistVideo[];
  isPiPSupported?: boolean;
  isPiPActive?: boolean;
  togglePiP?: () => void;
  isReconnecting?: boolean;
  isCatchingUp?: boolean;
}

export const Controls = (props: ControlsProps) => {
  const [hoverState, setHoverState] = useState({
    hoverTimestamp: 0,
    hoverPos: 0,
  });
  const [showTimestamp, setShowTimestamp] = useState(false);
  const getEnd = () => props.duration;
  const getStart = () => 0;
  const getLength = () => getEnd() - getStart();
  const getCurrent = () => props.currentTime;
  const getPercent = () => (getCurrent() - getStart()) / getLength();
  const zeroTime = useMemo(
    () => Math.floor(Date.now() / 1000) - props.duration,
    [props.video, Boolean(props.duration)],
  );
  const onMouseOver = () => {
    setShowTimestamp(true);
  };
  const onMouseOut = () => {
    setShowTimestamp(false);
  };
  const onMouseMove = (e: any) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const max = rect.width;
    const pct = x / max;
    // console.log(x, max);
    const target = getStart() + pct * getLength();
    // console.log(pct);
    if (pct >= 0) {
      setHoverState({ hoverTimestamp: target, hoverPos: pct });
    }
  };
  const {
    roomTogglePlay,
    roomSeek,
    localFullScreen,
    localToggleMute,
    localSubtitleModal,
    localSeek,
    currentTime,
    leaderTime,
    isPauseDisabled,
    disabled,
    isReconnecting,
    isCatchingUp,
    subtitled,
    paused,
    muted,
    volume,
    isLiveStream,
    playlist,
    roomPlaylistPlay,
    timeRanges,
    roomSetPlaybackRate,
    roomPlaybackRate,
  } = props;
  // console.log(leaderTime, currentTime);
  const behindThreshold = 10;
  const behindTime =
    !isLiveStream && leaderTime && leaderTime < Infinity
      ? leaderTime - currentTime
      : getEnd() - getCurrent();
  const isBehind = behindTime > behindThreshold;
  const isServerControlDisabled = Boolean(disabled || isReconnecting);
  const buffers = timeRanges.map(({ start, end }) => {
    const buffStartPct = (start / getLength()) * 100;
    const buffLengthPct = ((end - start) / getLength()) * 100;
    return (
      <div
        key={start}
        style={{
          position: "absolute",
          height: "8px",
          backgroundColor: "var(--border-subtle)",
          left: buffStartPct + "%",
          width: buffLengthPct + "%",
          bottom: "0em",
          zIndex: 0,
          pointerEvents: "none",
        }}
      ></div>
    );
  });
  const playPauseProps = {
    onClick: () => {
      if (!isServerControlDisabled && !isPauseDisabled) {
        roomTogglePlay();
      }
    },
    className: ` ${styles.action}`,
    disabled: isServerControlDisabled || isPauseDisabled,
  };
  return (
    <div className={styles.controls}>
      {paused ? (
        <Tooltip
          label={
            isReconnecting
              ? "Reconnecting to room..."
              : isServerControlDisabled
              ? "Playback locked by host"
              : "Play (Space)"
          }
          withArrow
          position="top"
        >
          <IconPlayerPlayFilled {...playPauseProps} />
        </Tooltip>
      ) : (
        <Tooltip
          label={
            isReconnecting
              ? "Reconnecting to room..."
              : isServerControlDisabled
              ? "Playback locked by host"
              : "Pause (Space)"
          }
          withArrow
          position="top"
        >
          <IconPlayerPauseFilled {...playPauseProps} />
        </Tooltip>
      )}
      {!isLiveStream && (
        <>
          <Tooltip
            label={
              isReconnecting
                ? "Reconnecting to room..."
                : isServerControlDisabled
                ? "Playback locked by host"
                : "Rewind 10s (←)"
            }
            withArrow
            position="top"
          >
            <IconPlayerTrackPrevFilled
              className={styles.action}
              onClick={() => !isServerControlDisabled && roomSeek(Math.max(0, currentTime - 10))}
              style={{ opacity: isServerControlDisabled ? 0.5 : 1, cursor: isServerControlDisabled ? "not-allowed" : "pointer" }}
            />
          </Tooltip>
          <Tooltip
            label={
              isReconnecting
                ? "Reconnecting to room..."
                : isServerControlDisabled
                ? "Playback locked by host"
                : "Forward 10s (→)"
            }
            withArrow
            position="top"
          >
            <IconPlayerTrackNextFilled
              className={styles.action}
              onClick={() => !isServerControlDisabled && roomSeek(Math.min(props.duration || Infinity, currentTime + 10))}
              style={{ opacity: isServerControlDisabled ? 0.5 : 1, cursor: isServerControlDisabled ? "not-allowed" : "pointer" }}
            />
          </Tooltip>
        </>
      )}
      {playlist.length > 0 && (
        <Tooltip
          label={
            isReconnecting
              ? "Reconnecting to room..."
              : isServerControlDisabled
              ? "Playback locked by host"
              : "Skip to next video in playlist"
          }
          withArrow
          position="top"
        >
          <IconPlayerSkipForwardFilled
            className={styles.action}
            onClick={() => !isServerControlDisabled && roomPlaylistPlay(0)}
            style={{ opacity: isServerControlDisabled ? 0.5 : 1, cursor: isServerControlDisabled ? "not-allowed" : "pointer" }}
          />
        </Tooltip>
      )}
      {isBehind && (
        <Tooltip
          label={
            isReconnecting
              ? "Reconnecting to room..."
              : isServerControlDisabled
              ? "Playback locked by host"
              : `Behind by ~${Math.round(behindTime)}s — Click to catch up`
          }
          withArrow
          position="top"
        >
          <Button
            size="compact-xs"
            variant="light"
            color="blue"
            leftSection={<IconRefresh size={12} />}
            disabled={isServerControlDisabled}
            onClick={() => {
              if (isServerControlDisabled) return;
              if (isLiveStream) {
                // in live case we want to seek the entire room to edge
                roomSeek(props.duration);
              } else {
                localSeek();
              }
            }}
          >
            Catch Up
          </Button>
        </Tooltip>
      )}
      <div className={` ${styles.text}`}>
        {formatTimestamp(getCurrent(), isLiveStream ? zeroTime : undefined)}
      </div>
      {isCatchingUp && !isLiveStream && (
        <Badge
          size="xs"
          variant="light"
          color="violet"
          style={{ textTransform: "none", fontWeight: 500 }}
        >
          Catching up...
        </Badge>
      )}
      <Progress.Root
        radius="0px"
        onClick={(e: any) => {
          if (!isServerControlDisabled) {
            // Read the time from the click event
            if (e) {
              const rect = e.target.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const max = rect.width;
              const pct = x / max;
              // roomseek operates on actual media element times, not timestamps
              // for DASH we set getStart() value to when stream started, so left side is 0 video time
              // even though it's not all seekable this makes the click to seek simple
              let target = getLength() * pct;
              roomSeek(target);
            }
          }
        }}
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onMouseMove={onMouseMove}
        style={{
          flexGrow: 1,
          marginTop: 0,
          marginBottom: 0,
          position: "relative",
          minWidth: "50px",
          overflow: "visible",
          cursor: isServerControlDisabled ? "not-allowed" : "pointer",
        }}
      >
        <Progress.Section
          style={{ pointerEvents: "none", zIndex: 1 }}
          value={getPercent() * 100}
        ></Progress.Section>
        {buffers}
        {getLength() < Infinity && showTimestamp && (
          <Badge
            style={{
              position: "absolute",
              bottom: "10px",
              left: `calc(${hoverState.hoverPos * 100 + "%"})`,
              transform: "translate(-50%)",
              display: "inline-block",
            }}
          >
            {formatTimestamp(
              hoverState.hoverTimestamp,
              isLiveStream ? zeroTime : undefined,
            )}
          </Badge>
        )}
      </Progress.Root>
      <div className={` ${styles.text}`}>{formatTimestamp(getEnd())}</div>
      {isLiveStream && (
        <Badge size="xs" color="red">
          LIVE
        </Badge>
      )}
      {
        <Menu disabled={isServerControlDisabled}>
          <Menu.Target>
            <div
              className={`${styles.text} ${styles.action}`}
              style={{
                backgroundColor: "var(--surface-hover)",
                fontSize: 10,
                borderRadius: "4px",
                padding: "2px",
                opacity: isServerControlDisabled ? 0.6 : 1,
                cursor: isServerControlDisabled ? "not-allowed" : "pointer",
              }}
            >
              {props.playbackRate?.toFixed(2)}x
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            {[
              { key: "Auto", text: "Auto", value: 0 },
              { key: "0.25", text: "0.25x", value: 0.25 },
              { key: "0.5", text: "0.5x", value: 0.5 },
              { key: "1", text: "1x", value: 1 },
              { key: "1.5", text: "1.5x", value: 1.5 },
              { key: "2", text: "2x", value: 2 },
              { key: "3", text: "3x", value: 3 },
            ].map((item) => (
              <Menu.Item
                key={item.key}
                onClick={() => roomSetPlaybackRate(item.value)}
                rightSection={
                  roomPlaybackRate === item.value ? <IconCheck /> : null
                }
              >
                {item.text}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      }
      <IconRepeat
        onClick={() => {
          if (!isServerControlDisabled) {
            props.roomSetLoop(Boolean(!props.loop));
          }
        }}
        className={` ${styles.action}`}
        style={{ opacity: isServerControlDisabled ? 0.5 : 1, cursor: isServerControlDisabled ? "not-allowed" : "pointer" }}
        title="Loop"
        color={props.loop ? "var(--color-success)" : undefined}
      />
      {props.isYouTube ? (
        <Menu>
          <Menu.Target>
            <IconBadgeCc className={styles.action} />
          </Menu.Target>
          <Menu.Dropdown>
            {[
              { key: "hidden", text: "Off", value: "hidden" },
              { key: "en", text: "English", value: "showing" },
              { key: "es", text: "Spanish", value: "showing" },
            ].map((item) => (
              <Menu.Item
                key={item.key}
                onClick={() =>
                  props.localSetSubtitleMode(
                    item.value as TextTrackMode,
                    item.key,
                  )
                }
              >
                {item.text}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : (
        <IconBadgeCc
          onClick={() => {
            localSubtitleModal();
          }}
          className={` ${styles.action}`}
          title="Captions"
          color={subtitled ? "var(--color-success)" : undefined}
        />
      )}
      <IconTheater
        onClick={() => localFullScreen(false)}
        className={`${styles.action} ${styles.desktopOnly}`}
        title="Theater Mode"
      />
      <IconMaximize
        onClick={() => localFullScreen(true)}
        className={` ${styles.action}`}
        title="Fullscreen"
      />
      {props.isPiPSupported && props.togglePiP && (
        <Tooltip
          label={
            props.isYouTube
              ? "YouTube: Right-click video twice for Picture-in-Picture"
              : props.isPiPActive
              ? "Exit Picture-in-Picture"
              : "Picture in Picture"
          }
          withArrow
          withinPortal
        >
          <IconPictureInPicture
            onClick={props.togglePiP}
            className={styles.action}
            style={props.isPiPActive ? { color: "var(--color-violet, #8B5CF6)" } : undefined}
            title={
              props.isYouTube
                ? "YouTube: Right-click video twice for Picture-in-Picture"
                : props.isPiPActive
                ? "Exit Picture-in-Picture"
                : "Picture in Picture"
            }
          />
        </Tooltip>
      )}
      {muted ? (
        <IconVolumeOff
          onClick={() => {
            localToggleMute();
          }}
          className={` ${styles.action}`}
        />
      ) : (
        <IconVolume
          onClick={() => {
            localToggleMute();
          }}
          className={` ${styles.action}`}
        />
      )}
      <div className={styles.volumeSlider}>
        <Slider
          defaultValue={volume}
          disabled={muted}
          min={0}
          max={1}
          step={0.01}
          onChangeEnd={(value: number) => {
            props.localSetVolume(value);
          }}
        />
      </div>
    </div>
  );
};
