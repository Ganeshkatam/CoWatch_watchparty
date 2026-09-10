import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useContext,
} from "react";
import { useHistory } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { getAccessToken, supabase } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
import {
  IconSearch,
  IconX,
  IconDeviceTv,
  IconPlayerPlay,
} from "@tabler/icons-react";
import styles from "./TopBarSearch.module.css";

interface SearchItem {
  id: string;
  type: "jump" | "room";
  title: string;
  subtitle?: string;
  path: string;
  icon: React.ReactNode;
}

export const TopBarSearch: React.FC = () => {
  const history = useHistory();
  const context = useContext(MetadataContext);

  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rooms, setRooms] = useState<any[]>([]);
  const [fetchedRooms, setFetchedRooms] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcutLabel = isMac ? "⌘K" : "Ctrl+K";

  // Fetch user rooms with Supabase direct fallback
  const fetchUserRooms = useCallback(async () => {
    if (!context.user) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `${serverPath}/listRooms?uid=${context.user.id}&token=${token}&limit=20`
      );
      if (res.ok) {
        const data = await res.json();
        const roomsList = Array.isArray(data)
          ? data
          : Array.isArray(data?.rooms)
          ? data.rooms
          : [];
        if (roomsList.length > 0) {
          setRooms(roomsList);
          setFetchedRooms(true);
          return;
        }
      }
    } catch {
      // Backend unreachable (e.g. static Vercel preview); fallback to direct Supabase query
    }

    try {
      const { data, error } = await supabase
        .from("rooms")
        .select("roomId, roomTitle, roomDescription, status, coverPhoto")
        .eq("owner_id", context.user.id)
        .order("creationTime", { ascending: false })
        .limit(20);
      if (!error && data) {
        setRooms(data);
        setFetchedRooms(true);
      }
    } catch (e) {
      console.warn("Supabase fetchUserRooms error:", e);
    }
  }, [context.user]);

  // Pre-fetch user rooms as soon as user identity is established
  useEffect(() => {
    if (context.user && !fetchedRooms) {
      fetchUserRooms();
    }
  }, [context.user, fetchedRooms, fetchUserRooms]);

  // Global shortcut listener (⌘K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMobileOpen(true);
        setIsFocused(true);
        fetchUserRooms();
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 50);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fetchUserRooms]);

  // Click outside to close
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Close search dropdown on page scroll to prevent visual clutter
  useEffect(() => {
    if (!isFocused && !mobileOpen) return;

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest(`.${styles.dropdown}`)
      ) {
        return;
      }
      setIsFocused(false);
      setMobileOpen(false);
      inputRef.current?.blur();
    };

    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [isFocused, mobileOpen]);

  // Compute search items - strictly show only room results and room jump
  const items = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    const resultList: SearchItem[] = [];

    // 1. Direct Room code or URL detection
    if (cleanQuery.length > 0) {
      let extractedId = cleanQuery;
      if (extractedId.includes("/watch/")) {
        extractedId = extractedId.split("/watch/")[1]?.split("?")[0] || extractedId;
      } else if (extractedId.includes("/join/")) {
        extractedId = extractedId.split("/join/")[1]?.split("?")[0] || extractedId;
      }
      extractedId = extractedId.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\//, "");

      if (extractedId.length >= 2 && !extractedId.includes(" ")) {
        resultList.push({
          id: `jump-${extractedId}`,
          type: "jump",
          title: `Jump to room: ${extractedId}`,
          subtitle: "Press Enter to join this room directly",
          path: `/join/${extractedId}`,
          icon: <IconPlayerPlay size={16} stroke={2} />,
        });
      }
    }

    // 2. User Rooms (Show only room results)
    if (rooms.length > 0) {
      const matchedRooms = cleanQuery
        ? rooms.filter((r) => {
            const title = (r.roomTitle || "").toLowerCase();
            const id = (r.roomId || "").toLowerCase();
            const desc = (r.roomDescription || "").toLowerCase();
            return (
              title.includes(cleanQuery) ||
              id.includes(cleanQuery) ||
              desc.includes(cleanQuery)
            );
          })
        : rooms;

      matchedRooms.forEach((r) => {
        resultList.push({
          id: `room-${r.roomId}`,
          type: "room",
          title: r.roomTitle || `Room ${r.roomId}`,
          subtitle: r.roomDescription
            ? `${r.roomDescription} • ${r.status || "active"}`
            : `ID: ${r.roomId} • Status: ${r.status || "active"}`,
          path: `/watch/${r.roomId}`,
          icon: <IconDeviceTv size={16} stroke={1.5} />,
        });
      });
    }

    return resultList;
  }, [query, rooms]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = (item: SearchItem) => {
    setIsFocused(false);
    setMobileOpen(false);
    setQuery("");
    history.push(item.path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? items.length - 1 : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIndex]) {
        handleSelect(items[selectedIndex]);
      } else if (query.trim().length > 0) {
        // Direct jump fallback
        const clean = query.trim().replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\//, "");
        history.push(`/join/${clean}`);
        setIsFocused(false);
        setMobileOpen(false);
        setQuery("");
      }
    } else if (e.key === "Escape") {
      setIsFocused(false);
      setMobileOpen(false);
      inputRef.current?.blur();
    }
  };

  const isExpanded = isFocused || query.length > 0;
  const isDropdownVisible = isFocused || mobileOpen;

  return (
    <div className={styles.searchContainer} ref={containerRef}>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className={styles.mobileBackdrop}
          onClick={() => {
            setMobileOpen(false);
            setIsFocused(false);
            setQuery("");
          }}
          aria-hidden="true"
        />
      )}

      {/* Mobile Icon Button */}
      <button
        type="button"
        className={styles.mobileSearchButton}
        onClick={() => {
          setMobileOpen(true);
          setIsFocused(true);
          fetchUserRooms();
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        aria-label="Search rooms"
      >
        <IconSearch size={18} stroke={1.5} />
      </button>

      {/* Expandable Input Bar */}
      <div
        className={`${styles.searchWrapper} ${isExpanded ? styles.searchWrapperExpanded : ""
          } ${mobileOpen ? styles.searchWrapperMobileOpen : ""}`}
      >
        <div className={styles.inputInner}>
          <span className={styles.searchIcon}>
            <IconSearch size={16} stroke={1.8} />
          </span>

          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder={mobileOpen ? "Search rooms or code..." : "Search rooms or enter code..."}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              fetchUserRooms();
            }}
            onKeyDown={handleKeyDown}
            aria-label="Search rooms or enter code"
          />

          <div className={styles.rightAdornment}>
            {query ? (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <IconX size={13} />
              </button>
            ) : (
              <kbd className={styles.kbdBadge}>{shortcutLabel}</kbd>
            )}
          </div>
        </div>

        {mobileOpen && (
          <button
            type="button"
            className={styles.mobileCloseButton}
            onClick={() => {
              setMobileOpen(false);
              setIsFocused(false);
              setQuery("");
            }}
            aria-label="Close search"
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      {/* Floating Results Dropdown */}
      {isDropdownVisible && (
        <div className={styles.dropdown} role="listbox">
          {items.length > 0 ? (
            items.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ""
                    }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className={styles.itemIcon}>{item.icon}</span>
                  <div className={styles.itemContent}>
                    <div className={styles.itemTitle}>{item.title}</div>
                    {item.subtitle && (
                      <div className={styles.itemSubtitle}>{item.subtitle}</div>
                    )}
                  </div>
                  {isSelected && (
                    <span className={styles.itemEnterHint}>↵</span>
                  )}
                </button>
              );
            })
          ) : (
            <div className={styles.emptyState}>
              {query ? `No rooms matching "${query}"` : "No rooms found. Enter a room code to join."}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
