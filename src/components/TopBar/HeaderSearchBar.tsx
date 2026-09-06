import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
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
  IconLayersIntersect,
  IconMagnetFilled,
  IconPlayerPlayFilled,
  IconPlaylistAdd,
  IconSearch,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { Badge, Loader, Tooltip } from "@mantine/core";
import styles from "./HeaderSearchBar.module.css";

export interface HeaderSearchBarProps {
  roomSetMedia: (value: string) => void;
  playlistAdd: (value: string) => void;
  mediaPath?: string;
  disabled?: boolean;
}

type FilterCategory = "all" | "youtube" | "file" | "magnet";

export const HeaderSearchBar: React.FC<HeaderSearchBarProps> = ({
  roomSetMedia,
  playlistAdd,
  mediaPath,
  disabled,
}) => {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");
  const [items, setItems] = useState<SearchResult[]>(examples);
  const [loading, setLoading] = useState(false);
  const [addedUrls, setAddedUrls] = useState<Record<string, boolean>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // Global Ctrl+K / Cmd+K listener and custom focus listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setIsOpen(true);
      }
    };

    const handleFocusSearch = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("cowatch:focus-search", handleFocusSearch);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("cowatch:focus-search", handleFocusSearch);
    };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePlayNow = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      roomSetMedia(trimmed);
      setIsOpen(false);
      setQuery("");
      inputRef.current?.blur();
    },
    [roomSetMedia],
  );

  const handleAddToPlaylist = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      playlistAdd(trimmed);
      setAddedUrls((prev) => ({ ...prev, [trimmed]: true }));
      setTimeout(() => {
        setAddedUrls((prev) => ({ ...prev, [trimmed]: false }));
      }, 2500);
    },
    [playlistAdd],
  );

  const doSearch = useCallback(
    async (val: string) => {
      const trimmed = val.trim();
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

      if (isHttp(trimmed) || isMagnet(trimmed)) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const results = await getYouTubeResults(trimmed);
        setItems(results);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [mediaPath],
  );

  const debouncedSearch = useMemo(() => debounce(doSearch, 300), [doSearch]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    debouncedSearch(val);
  };

  const handleClear = () => {
    setQuery("");
    setItems(examples);
    inputRef.current?.focus();
  };

  const trimmed = query.trim();
  const isDirect = Boolean(trimmed && (isHttp(trimmed) || isMagnet(trimmed)));

  const directType = useMemo(() => {
    if (!isDirect) return null;
    if (isYouTube(trimmed)) {
      return {
        label: "YouTube Video",
        color: "red",
        icon: <IconBrandYoutubeFilled size={13} color="#EF4444" />,
      };
    }
    if (isMagnet(trimmed)) {
      return {
        label: "WebTorrent Magnet",
        color: "violet",
        icon: <IconMagnetFilled size={13} color="#A78BFA" />,
      };
    }
    if (trimmed.toLowerCase().includes(".m3u8")) {
      return {
        label: "HLS Stream",
        color: "cyan",
        icon: <IconVideo size={13} color="#22D3EE" />,
      };
    }
    return {
      label: "Direct Video Stream",
      color: "blue",
      icon: <IconVideo size={13} color="#60A5FA" />,
    };
  }, [isDirect, trimmed]);

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;
    return items.filter((item) => item.type === activeFilter);
  }, [items, activeFilter]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isDirect) {
        handlePlayNow(trimmed);
      } else if (filteredItems.length > 0) {
        handlePlayNow(filteredItems[0].url);
      } else if (trimmed) {
        handlePlayNow(trimmed);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className={styles.searchContainer} ref={containerRef}>
      {/* Search Input */}
      <div className={styles.inputWrapper}>
        <span className={styles.searchIcon}>
          {loading ? (
            <Loader size={14} color="violet" />
          ) : (
            <IconSearch size={15} />
          )}
        </span>
        <input
          ref={inputRef}
          id="cowatch-header-search"
          type="text"
          className={styles.searchInput}
          placeholder="Paste URL, magnet, or search YouTube..."
          value={query}
          onChange={handleChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <div className={styles.rightIconGroup}>
          {query ? (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={handleClear}
              title="Clear"
            >
              <IconX size={12} />
            </button>
          ) : (
            <span className={styles.kbdHint}>{isMac ? "⌘K" : "Ctrl+K"}</span>
          )}
        </div>
      </div>

      {/* Autocomplete / Results Dropdown */}
      {isOpen && (
        <div className={styles.dropdownMenu}>
          {/* Category Filter Pills */}
          <div className={styles.filterRow}>
            <button
              type="button"
              className={`${styles.filterPill} ${activeFilter === "all" ? styles.filterPillActive : ""}`}
              onClick={() => setActiveFilter("all")}
            >
              <IconLayersIntersect size={12} />
              All
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${activeFilter === "youtube" ? styles.filterPillActive : ""}`}
              onClick={() => setActiveFilter("youtube")}
            >
              <IconBrandYoutubeFilled size={12} color="#EF4444" />
              YouTube
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${activeFilter === "file" ? styles.filterPillActive : ""}`}
              onClick={() => setActiveFilter("file")}
            >
              <IconVideo size={12} color="#60A5FA" />
              Direct Video
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${activeFilter === "magnet" ? styles.filterPillActive : ""}`}
              onClick={() => setActiveFilter("magnet")}
            >
              <IconMagnetFilled size={12} color="#A78BFA" />
              Torrent
            </button>
          </div>

          {/* Direct link card */}
          {isDirect && directType && (
            <div className={styles.directActionCard}>
              <div className={styles.directMeta}>
                <div className={styles.directTypeRow}>
                  {directType.icon}
                  <Badge size="xs" variant="light" color={directType.color}>
                    {directType.label}
                  </Badge>
                  {addedUrls[trimmed] && (
                    <span className={styles.toastPill}>
                      <IconCheck size={11} /> Added
                    </span>
                  )}
                </div>
                <div className={styles.directUrlText} title={trimmed}>
                  {trimmed}
                </div>
              </div>
              <div className={styles.directActions}>
                <button
                  type="button"
                  className={styles.actionBtnPlay}
                  onClick={() => handlePlayNow(trimmed)}
                >
                  <IconPlayerPlayFilled size={12} />
                  Play
                </button>
                <button
                  type="button"
                  className={styles.actionBtnPlaylist}
                  onClick={() => handleAddToPlaylist(trimmed)}
                >
                  <IconPlaylistAdd size={14} />
                  + Playlist
                </button>
              </div>
            </div>
          )}

          {/* Section Header */}
          <div className={styles.sectionHeader}>
            <span>
              {trimmed && !isDirect
                ? `Results (${filteredItems.length})`
                : "Suggested Streams"}
            </span>
            {trimmed && !isDirect && loading && (
              <span style={{ fontSize: "10px", color: "#A78BFA" }}>
                Searching...
              </span>
            )}
          </div>

          {/* Results List */}
          <div className={styles.resultsList}>
            {filteredItems.slice(0, 6).map((item, index) => {
              const isAdded = Boolean(addedUrls[item.url]);
              return (
                <div
                  key={`${item.url}-${index}`}
                  className={styles.resultCard}
                  onClick={() => handlePlayNow(item.url)}
                  title={`Play ${item.name || item.url}`}
                >
                  <div className={styles.thumbnailWrapper}>
                    {Boolean(item.img) && !failedImages[item.url] ? (
                      <img
                        src={item.img}
                        alt={item.name}
                        className={styles.thumbnailImg}
                        loading="lazy"
                        onError={() =>
                          setFailedImages((prev) => ({
                            ...prev,
                            [item.url]: true,
                          }))
                        }
                      />
                    ) : (
                      <div className={styles.thumbnailPlaceholder}>
                        {item.type === "youtube" ? (
                          <IconBrandYoutubeFilled size={18} color="#EF4444" />
                        ) : item.type === "magnet" ? (
                          <IconMagnetFilled size={18} color="#A78BFA" />
                        ) : (
                          <IconVideo size={18} color="#60A5FA" />
                        )}
                      </div>
                    )}
                    {Boolean(item.duration && item.duration > 0) && (
                      <span className={styles.durationBadge}>
                        {formatTimestamp(item.duration)}
                      </span>
                    )}
                  </div>

                  <div className={styles.resultMeta}>
                    <div className={styles.resultTitle}>
                      {decodeEntities(item.name || item.url)}
                    </div>
                    <div className={styles.resultChannel}>
                      <span>{item.channel || item.type.toUpperCase()}</span>
                    </div>
                  </div>

                  <div
                    className={styles.resultControls}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isAdded ? (
                      <span className={styles.toastPill}>
                        <IconCheck size={11} /> Added
                      </span>
                    ) : (
                      <Tooltip label="Add to Playlist" position="top">
                        <button
                          type="button"
                          className={styles.miniActionBtn}
                          onClick={() => handleAddToPlaylist(item.url)}
                        >
                          <IconPlaylistAdd size={14} />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip label="Play Now" position="top">
                      <button
                        type="button"
                        className={`${styles.miniActionBtn} ${styles.miniActionBtnPlay}`}
                        onClick={() => handlePlayNow(item.url)}
                      >
                        <IconPlayerPlayFilled size={13} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Bar */}
          <div className={styles.footerBar}>
            <span>↵ Enter to play</span>
            <span>Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
};
