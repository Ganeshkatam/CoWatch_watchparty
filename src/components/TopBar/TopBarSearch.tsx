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
import { getAccessToken } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
import {
  IconSearch,
  IconX,
  IconHome,
  IconUsers,
  IconCirclePlusFilled,
  IconDatabase,
  IconSettings,
  IconHelpCircle,
  IconPlayerPlay,
  IconUser,
  IconLock,
} from "@tabler/icons-react";
import styles from "./TopBarSearch.module.css";

interface SearchItem {
  id: string;
  type: "jump" | "room" | "page";
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

  // Fetch user rooms once user focuses or opens search
  const fetchUserRooms = useCallback(async () => {
    if (!context.user || fetchedRooms) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `${serverPath}/listRooms?uid=${context.user.id}&token=${token}&limit=5`
      );
      if (res.ok) {
        const data = await res.json();
        const roomsList = Array.isArray(data) ? data : (Array.isArray(data?.rooms) ? data.rooms : []);
        setRooms(roomsList);
        setFetchedRooms(true);
      }
    } catch {
      // Ignore network errors in quick search
    }
  }, [context.user, fetchedRooms]);

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

  // Compute search items
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
          path: `/watch/${extractedId}`,
          icon: <IconPlayerPlay size={16} stroke={2} />,
        });
      }
    }

    // 2. User Rooms
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
        : rooms.slice(0, 4);

      matchedRooms.forEach((r) => {
        resultList.push({
          id: `room-${r.roomId}`,
          type: "room",
          title: r.roomTitle || `Room ${r.roomId}`,
          subtitle: r.roomDescription || `ID: ${r.roomId} (${r.status || "active"})`,
          path: `/watch/${r.roomId}`,
          icon: <IconDatabase size={16} stroke={1.5} />,
        });
      });
    }

    // 3. Navigation Pages
    const pages: SearchItem[] = [
      {
        id: "page-home",
        type: "page",
        title: "Home",
        subtitle: "Go to homepage",
        path: "/",
        icon: <IconHome size={16} stroke={1.5} />,
      },
      {
        id: "page-join",
        type: "page",
        title: "Join a room",
        subtitle: "Enter a room code or invite URL",
        path: "/join",
        icon: <IconUsers size={16} stroke={1.5} />,
      },
      {
        id: "page-create",
        type: "page",
        title: "Create room",
        subtitle: "Start a new watch party",
        path: "/create",
        icon: <IconCirclePlusFilled size={16} stroke={1.5} />,
      },
      {
        id: "page-rooms",
        type: "page",
        title: "My rooms",
        subtitle: "View your saved and scheduled rooms",
        path: "/rooms",
        icon: <IconDatabase size={16} stroke={1.5} />,
      },
      {
        id: "page-profile",
        type: "page",
        title: "Profile",
        subtitle: "Manage your display name and avatar",
        path: "/account/profile",
        icon: <IconUser size={16} stroke={1.5} />,
      },
      {
        id: "page-preferences",
        type: "page",
        title: "Preferences",
        subtitle: "Manage media, appearance, and room options",
        path: "/account/preferences",
        icon: <IconSettings size={16} stroke={1.5} />,
      },
      {
        id: "page-security",
        type: "page",
        title: "Security",
        subtitle: "Password reset and active session management",
        path: "/account/security",
        icon: <IconLock size={16} stroke={1.5} />,
      },
      {
        id: "page-faq",
        type: "page",
        title: "Help & FAQ",
        subtitle: "Frequently asked questions and guides",
        path: "/faq",
        icon: <IconHelpCircle size={16} stroke={1.5} />,
      },
    ];

    const matchedPages = cleanQuery
      ? pages.filter((p) => {
        return (
          p.title.toLowerCase().includes(cleanQuery) ||
          p.subtitle?.toLowerCase().includes(cleanQuery)
        );
      })
      : pages.slice(0, 4);

    resultList.push(...matchedPages);

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
        history.push(`/watch/${clean}`);
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
  const isDropdownVisible = (isFocused || mobileOpen) && items.length > 0;

  return (
    <div className={styles.searchContainer} ref={containerRef}>
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
        aria-label="Search rooms and pages"
      >
        <IconSearch size={18} stroke={1.5} />
      </button>

      {/* Expandable Input Bar */}
      <div
        className={`${styles.searchWrapper} ${isExpanded ? styles.searchWrapperExpanded : ""
          } ${mobileOpen ? styles.searchWrapperMobileOpen : ""}`}
      >
        <span className={styles.searchIcon}>
          <IconSearch size={16} stroke={1.8} />
        </span>

        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            fetchUserRooms();
          }}
          onKeyDown={handleKeyDown}
          aria-label="Search rooms, invite links, and navigation"
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

      {/* Floating Results Dropdown */}
      {isDropdownVisible && (
        <div className={styles.dropdown} role="listbox">
          {items.map((item, index) => {
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
          })}
        </div>
      )}
    </div>
  );
};
