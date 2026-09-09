import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  debounce,
  decodeEntities,
  formatTimestamp,
  getMediaPathResults,
  getYouTubeResults,
  isHttp,
  isMagnet,
  isYouTube,
} from "../../utils/utils";
import { examples } from "../../utils/examples";
import {
  IconBrandYoutubeFilled,
  IconCheck,
  IconCornerDownLeft,
  IconFile,
  IconLayersIntersect,
  IconLink,
  IconMagnetFilled,
  IconPlayerPlayFilled,
  IconPlaylistAdd,
  IconSearch,
  IconTrash,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { Badge, Loader, TextInput, Tooltip } from "@mantine/core";
import classes from "./ComboBox.module.css";

export type ComboBoxProps = {
  roomSetMedia: (value: string) => void;
  playlistAdd: (value: string) => void;
  roomMedia: string;
  getMediaDisplayName: (input: string) => string;
  mediaPath: string | undefined;
  disabled?: boolean;
  onClose?: () => void;
};

type FilterCategory = "all" | "youtube" | "file" | "magnet";

export const ComboBox: React.FC<ComboBoxProps> = ({
  roomSetMedia,
  playlistAdd,
  roomMedia,
  getMediaDisplayName,
  mediaPath,
  disabled,
  onClose,
}) => {
  const [inputMedia, setInputMedia] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");
  const [items, setItems] = useState<SearchResult[]>(examples);
  const [loading, setLoading] = useState<boolean>(false);
  const [addedUrls, setAddedUrls] = useState<Record<string, boolean>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input automatically on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handlePlayNow = useCallback(
    (url: string) => {
      if (!url.trim()) return;
      roomSetMedia(url.trim());
      if (onClose) {
        onClose();
      }
    },
    [roomSetMedia, onClose],
  );

  const handleAddToPlaylist = useCallback(
    (url: string) => {
      if (!url.trim()) return;
      playlistAdd(url.trim());
      setAddedUrls((prev) => ({ ...prev, [url]: true }));
      setTimeout(() => {
        setAddedUrls((prev) => ({ ...prev, [url]: false }));
      }, 2500);
    },
    [playlistAdd],
  );

  const doSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        if (mediaPath) {
          try {
            setLoading(true);
            const pathItems = await getMediaPathResults(mediaPath, "");
            setItems(pathItems.length > 0 ? pathItems : examples);
          } catch {
            setItems(examples);
          } finally {
            setLoading(false);
          }
        } else {
          setItems(examples);
          setLoading(false);
        }
        return;
      }

      // If it's direct HTTP or Magnet, no need to query YouTube
      if (isHttp(trimmed) || isMagnet(trimmed)) {
        setLoading(false);
        return;
      }

      // Perform YouTube search
      setLoading(true);
      try {
        const youtubeResults = await getYouTubeResults(trimmed);
        setItems(youtubeResults);
      } catch (err) {
        console.error("Failed to fetch search results", err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [mediaPath],
  );

  const debouncedSearch = useMemo(() => debounce(doSearch, 300), [doSearch]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputMedia(value);
    debouncedSearch(value);
  };

  const handleClear = () => {
    setInputMedia("");
    setItems(examples);
    inputRef.current?.focus();
  };

  const trimmedInput = inputMedia.trim();
  const isDirect = Boolean(
    trimmedInput && (isHttp(trimmedInput) || isMagnet(trimmedInput)),
  );

  const directType = useMemo(() => {
    if (!isDirect) return null;
    if (isYouTube(trimmedInput)) {
      return {
        label: "YouTube Video",
        color: "red",
        icon: <IconBrandYoutubeFilled size={14} color="var(--media-youtube)" />,
      };
    }
    if (isMagnet(trimmedInput)) {
      return {
        label: "WebTorrent Magnet",
        color: "violet",
        icon: <IconMagnetFilled size={14} color="var(--media-magnet)" />,
      };
    }
    if (trimmedInput.toLowerCase().includes(".m3u8")) {
      return {
        label: "HLS Live Stream",
        color: "cyan",
        icon: <IconVideo size={14} color="var(--color-cyan)" />,
      };
    }
    return {
      label: "Direct Video Stream",
      color: "blue",
      icon: <IconVideo size={14} color="var(--media-video)" />,
    };
  }, [isDirect, trimmedInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isDirect) {
        handlePlayNow(trimmedInput);
      } else if (filteredItems.length > 0) {
        handlePlayNow(filteredItems[0].url);
      } else if (trimmedInput) {
        handlePlayNow(trimmedInput);
      }
    } else if (e.key === "Escape") {
      if (onClose) {
        onClose();
      }
    }
  };

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;
    return items.filter((item) => item.type === activeFilter);
  }, [items, activeFilter]);

  return (
    <div className={classes.container}>
      {/* Category filter pills */}
      <div className={classes.filterRow}>
        <button
          type="button"
          className={`${classes.filterPill} ${activeFilter === "all" ? classes.filterPillActive : ""}`}
          onClick={() => setActiveFilter("all")}
        >
          <IconLayersIntersect size={14} />
          All Sources
        </button>
        <button
          type="button"
          className={`${classes.filterPill} ${activeFilter === "youtube" ? classes.filterPillActive : ""}`}
          onClick={() => setActiveFilter("youtube")}
        >
          <IconBrandYoutubeFilled size={14} color="var(--media-youtube)" />
          YouTube
        </button>
        <button
          type="button"
          className={`${classes.filterPill} ${activeFilter === "file" ? classes.filterPillActive : ""}`}
          onClick={() => setActiveFilter("file")}
        >
          <IconVideo size={14} color="var(--media-video)" />
          Direct Video (MP4 / HLS)
        </button>
        <button
          type="button"
          className={`${classes.filterPill} ${activeFilter === "magnet" ? classes.filterPillActive : ""}`}
          onClick={() => setActiveFilter("magnet")}
        >
          <IconMagnetFilled size={14} color="var(--media-magnet)" />
          Torrent Magnet
        </button>
      </div>

      {/* If media is currently playing, provide an option to remove the existing play */}
      {Boolean(roomMedia) && (
        <div className={classes.currentlyPlayingCard}>
          <div className={classes.currentlyPlayingMeta}>
            <div className={classes.currentlyPlayingLabel}>Currently Playing</div>
            <div
              className={classes.currentlyPlayingTitle}
              title={getMediaDisplayName(roomMedia)}
            >
              {getMediaDisplayName(roomMedia)}
            </div>
          </div>
          <button
            type="button"
            className={classes.removePlayBtn}
            onClick={() => {
              roomSetMedia("");
              if (onClose) onClose();
            }}
            disabled={disabled}
            title="Stop playback and remove current media"
          >
            <IconTrash size={14} />
            <span>Remove Play</span>
          </button>
        </div>
      )}

      {/* Main search / URL input */}
      <div className={classes.inputWrapper}>
        <TextInput
          ref={inputRef}
          className={classes.searchInput}
          placeholder="Paste video file URL, magnet link, YouTube link, or search..."
          value={inputMedia}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          leftSection={
            loading ? (
              <Loader size={16} color="violet" />
            ) : (
              <IconSearch size={16} color="var(--text-muted)" />
            )
          }
          rightSection={
            inputMedia ? (
              <button
                type="button"
                className={classes.clearBtn}
                onClick={handleClear}
                title="Clear input"
              >
                <IconX size={14} />
              </button>
            ) : (
              <span className={classes.shortcutKbd}>↵</span>
            )
          }
        />
      </div>

      {/* Direct stream detected card */}
      {isDirect && directType && (
        <div className={classes.directActionCard}>
          <div className={classes.directMeta}>
            <div className={classes.directTypeRow}>
              {directType.icon}
              <Badge size="xs" variant="light" color={directType.color}>
                {directType.label}
              </Badge>
              {addedUrls[trimmedInput] && (
                <span className={classes.toastPill}>
                  <IconCheck size={12} /> Added to playlist
                </span>
              )}
            </div>
            <div className={classes.directUrlText} title={trimmedInput}>
              {trimmedInput}
            </div>
          </div>
          <div className={classes.directActions}>
            <button
              type="button"
              className={classes.actionBtnPlay}
              onClick={() => handlePlayNow(trimmedInput)}
            >
              <IconPlayerPlayFilled size={14} />
              Play Now
            </button>
            <button
              type="button"
              className={classes.actionBtnPlaylist}
              onClick={() => handleAddToPlaylist(trimmedInput)}
              title="Add to room playlist"
            >
              <IconPlaylistAdd size={15} />
              + Playlist
            </button>
          </div>
        </div>
      )}

      {/* Section title */}
      <div className={classes.sectionHeader}>
        <span>
          {trimmedInput && !isDirect
            ? `Search Results (${filteredItems.length})`
            : "Featured Streams & Test Files"}
        </span>
        {trimmedInput && !isDirect && loading && (
          <span style={{ fontSize: "11px", color: "var(--color-violet)" }}>
            Searching...
          </span>
        )}
      </div>

      {/* Results / Suggestions List */}
      <div className={classes.resultsList}>
        {filteredItems.length === 0 && !loading && (
          <div className={classes.emptyResults}>
            <IconSearch size={28} opacity={0.4} />
            <span>No streams found for this search.</span>
            <span style={{ fontSize: "11.5px", color: "var(--text-muted)" }}>
              Paste a direct video file link, YouTube link, or WebTorrent magnet
              above.
            </span>
          </div>
        )}

        {filteredItems.map((item, index) => {
          const isAdded = Boolean(addedUrls[item.url]);
          return (
            <div
              key={`${item.url}-${index}`}
              className={classes.resultCard}
              onClick={() => handlePlayNow(item.url)}
              title={`Play ${item.name || item.url}`}
            >
              {/* Thumbnail with duration */}
              <div className={classes.thumbnailWrapper}>
                {Boolean(item.img) && !failedImages[item.url] ? (
                  <img
                    src={item.img}
                    alt={item.name}
                    className={classes.thumbnailImg}
                    loading="lazy"
                    onError={() => {
                      setFailedImages((prev) => ({
                        ...prev,
                        [item.url]: true,
                      }));
                    }}
                  />
                ) : (
                  <div className={classes.thumbnailPlaceholder}>
                    {item.type === "youtube" ? (
                      <IconBrandYoutubeFilled size={22} color="var(--media-youtube)" />
                    ) : item.type === "magnet" ? (
                      <IconMagnetFilled size={22} color="var(--media-magnet)" />
                    ) : (
                      <IconVideo size={22} color="var(--media-video)" />
                    )}
                  </div>
                )}
                {Boolean(item.duration && item.duration > 0) && (
                  <span className={classes.durationBadge}>
                    {formatTimestamp(item.duration)}
                  </span>
                )}
              </div>

              {/* Meta information */}
              <div className={classes.resultMeta}>
                <div className={classes.resultTitle}>
                  {decodeEntities(item.name || item.url)}
                </div>
                <div className={classes.resultChannel}>
                  {item.type === "youtube" ? (
                    <IconBrandYoutubeFilled size={12} color="var(--media-youtube)" />
                  ) : item.type === "magnet" ? (
                    <IconMagnetFilled size={12} color="var(--media-magnet)" />
                  ) : (
                    <IconVideo size={12} color="var(--media-video)" />
                  )}
                  <span>{item.channel || item.type.toUpperCase()}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div
                className={classes.resultControls}
                onClick={(e) => e.stopPropagation()}
              >
                {isAdded ? (
                  <span className={classes.toastPill}>
                    <IconCheck size={12} /> Added
                  </span>
                ) : (
                  <Tooltip label="Add to Playlist" position="top">
                    <button
                      type="button"
                      className={classes.miniActionBtn}
                      onClick={() => handleAddToPlaylist(item.url)}
                    >
                      <IconPlaylistAdd size={15} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip label="Play Now" position="top">
                  <button
                    type="button"
                    className={`${classes.miniActionBtn} ${classes.miniActionBtnPlay}`}
                    onClick={() => handlePlayNow(item.url)}
                  >
                    <IconPlayerPlayFilled size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer bar with keyboard hints */}
      <div className={classes.footerBar}>
        <div className={classes.shortcutItem}>
          <span className={classes.shortcutKbd}>↵ Enter</span>
          <span>Play selected</span>
        </div>
        <div className={classes.shortcutItem}>
          <span className={classes.shortcutKbd}>Esc</span>
          <span>Close</span>
        </div>
      </div>
    </div>
  );
};

