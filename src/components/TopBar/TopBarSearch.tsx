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
import { useAppearance } from "../../theme/ThemeProvider";
import {
  IconSearch,
  IconX,
  IconDeviceTv,
  IconPlayerPlay,
  IconHome,
  IconUsers,
  IconCirclePlusFilled,
  IconUser,
  IconSettings,
  IconLock,
  IconHelpCircle,
  IconSun,
  IconMoon,
  IconLogin,
  IconUserPlus,
} from "@tabler/icons-react";
import styles from "./TopBarSearch.module.css";

interface SearchItem {
  id: string;
  type: "jump" | "room" | "page" | "action";
  category?: string;
  title: string;
  subtitle?: string;
  path?: string;
  action?: () => void;
  icon: React.ReactNode;
}

export const TopBarSearch: React.FC = () => {
  const history = useHistory();
  const context = useContext(MetadataContext);
  const { appearance, setAppearance } = useAppearance();

  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rooms, setRooms] = useState<any[]>([]);
  const [publicRooms, setPublicRooms] = useState<any[]>([]);
  const [fetchedRooms, setFetchedRooms] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcutLabel = isMac ? "⌘K" : "Ctrl+K";

  const isDark =
    appearance === "mantine" ||
    (appearance === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

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
      // Backend unreachable (e.g. static preview); fallback to direct Supabase query
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

  // Query public rooms matching search term when query is non-empty
  useEffect(() => {
    const clean = query.trim().toLowerCase();
    if (clean.length < 2) {
      setPublicRooms([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("rooms")
          .select("roomId, roomTitle, roomDescription, status")
          .or(`roomTitle.ilike.%${clean}%,roomId.ilike.%${clean}%`)
          .limit(5);

        if (!error && data) {
          setPublicRooms(data);
        }
      } catch {
        // Silent fallback for room lookup
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

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

  // Navigation pages catalogue
  const allPages: SearchItem[] = useMemo(
    () => [
      {
        id: "page-home",
        type: "page",
        category: "Navigation",
        title: "Home",
        subtitle: "Go to homepage",
        path: "/",
        icon: <IconHome size={16} stroke={1.5} />,
      },
      {
        id: "page-create",
        type: "page",
        category: "Navigation",
        title: "Create Room",
        subtitle: "Start a new watch party",
        path: "/create",
        icon: <IconCirclePlusFilled size={16} stroke={1.5} />,
      },
      {
        id: "page-join",
        type: "page",
        category: "Navigation",
        title: "Join a Room",
        subtitle: "Enter a room code or invite URL",
        path: "/join",
        icon: <IconUsers size={16} stroke={1.5} />,
      },
      {
        id: "page-myrooms",
        type: "page",
        category: "Navigation",
        title: "My Rooms",
        subtitle: "View your saved and scheduled rooms",
        path: "/myrooms",
        icon: <IconDeviceTv size={16} stroke={1.5} />,
      },
      {
        id: "page-profile",
        type: "page",
        category: "Settings",
        title: "Profile",
        subtitle: "Manage your display name and avatar",
        path: "/account/profile",
        icon: <IconUser size={16} stroke={1.5} />,
      },
      {
        id: "page-preferences",
        type: "page",
        category: "Settings",
        title: "Preferences",
        subtitle: "Manage media, appearance, and room options",
        path: "/account/preferences",
        icon: <IconSettings size={16} stroke={1.5} />,
      },
      {
        id: "page-security",
        type: "page",
        category: "Settings",
        title: "Security",
        subtitle: "Password reset and active session management",
        path: "/account/security",
        icon: <IconLock size={16} stroke={1.5} />,
      },
      {
        id: "page-faq",
        type: "page",
        category: "Help",
        title: "Help & FAQ",
        subtitle: "Frequently asked questions and guides",
        path: "/faq",
        icon: <IconHelpCircle size={16} stroke={1.5} />,
      },
    ],
    []
  );

  // Quick actions catalogue
  const allActions: SearchItem[] = useMemo(() => {
    const list: SearchItem[] = [
      {
        id: "action-theme",
        type: "action",
        category: "Actions",
        title: isDark ? "Switch to Light Mode" : "Switch to Dark Mode",
        subtitle: `Change theme appearance to ${isDark ? "light" : "dark"}`,
        action: () => setAppearance(isDark ? "light" : "mantine"),
        icon: isDark ? (
          <IconSun size={16} stroke={1.5} />
        ) : (
          <IconMoon size={16} stroke={1.5} />
        ),
      },
    ];

    if (!context.user) {
      list.push(
        {
          id: "action-login",
          type: "action",
          category: "Account",
          title: "Sign In",
          subtitle: "Log in to your CoWatch account",
          path: "/login",
          icon: <IconLogin size={16} stroke={1.5} />,
        },
        {
          id: "action-signup",
          type: "action",
          category: "Account",
          title: "Get Started",
          subtitle: "Create a free CoWatch account",
          path: "/signup",
          icon: <IconUserPlus size={16} stroke={1.5} />,
        }
      );
    }

    return list;
  }, [isDark, setAppearance, context.user]);

  // Compute search items - unified search across jump, rooms, pages, and actions (only when query is present)
  const items = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) {
      return [];
    }

    const resultList: SearchItem[] = [];

    // 1. Direct Room code or URL detection
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
        category: "Quick Jump",
        title: `Jump to room: ${extractedId}`,
        subtitle: "Press Enter to join this room directly",
        path: `/join/${extractedId}`,
        icon: <IconPlayerPlay size={16} stroke={2} />,
      });
    }

    // 2. Rooms (User rooms + Public rooms)
    const combinedRoomsMap = new Map<string, any>();
    rooms.forEach((r) => combinedRoomsMap.set(r.roomId, r));
    publicRooms.forEach((r) => {
      if (!combinedRoomsMap.has(r.roomId)) {
        combinedRoomsMap.set(r.roomId, r);
      }
    });

    const allCombinedRooms = Array.from(combinedRoomsMap.values());
    if (allCombinedRooms.length > 0) {
      const matchedRooms = allCombinedRooms.filter((r) => {
        const title = (r.roomTitle || "").toLowerCase();
        const id = (r.roomId || "").toLowerCase();
        const desc = (r.roomDescription || "").toLowerCase();
        return (
          title.includes(cleanQuery) ||
          id.includes(cleanQuery) ||
          desc.includes(cleanQuery)
        );
      });

      matchedRooms.slice(0, 5).forEach((r) => {
        resultList.push({
          id: `room-${r.roomId}`,
          type: "room",
          category: "Rooms",
          title: r.roomTitle || `Room ${r.roomId}`,
          subtitle: r.roomDescription
            ? `${r.roomDescription} • ${r.status || "active"}`
            : `ID: ${r.roomId} • Status: ${r.status || "active"}`,
          path: `/watch/${r.roomId}`,
          icon: <IconDeviceTv size={16} stroke={1.5} />,
        });
      });
    }

    // 3. Navigation Pages
    const matchedPages = allPages.filter((p) => {
      return (
        p.title.toLowerCase().includes(cleanQuery) ||
        p.subtitle?.toLowerCase().includes(cleanQuery)
      );
    });

    resultList.push(...matchedPages);

    // 4. Actions
    const matchedActions = allActions.filter((a) => {
      return (
        a.title.toLowerCase().includes(cleanQuery) ||
        a.subtitle?.toLowerCase().includes(cleanQuery) ||
        (cleanQuery === "theme" && a.id === "action-theme")
      );
    });

    resultList.push(...matchedActions);

    return resultList;
  }, [query, rooms, publicRooms, allPages, allActions]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = (item: SearchItem) => {
    setIsFocused(false);
    setMobileOpen(false);
    setQuery("");
    if (item.action) {
      item.action();
    } else if (item.path) {
      history.push(item.path);
    }
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
  const isDropdownVisible = (isFocused || mobileOpen) && query.trim().length > 0;

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
        aria-label="Search rooms, pages, and actions"
      >
        <IconSearch size={18} stroke={1.5} />
      </button>

      {/* Expandable Input Bar */}
      <div
        className={`${styles.searchWrapper} ${
          isExpanded ? styles.searchWrapperExpanded : ""
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
            placeholder={
              mobileOpen
                ? "Search rooms, pages, code..."
                : "Search rooms, pages, or enter code..."
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              fetchUserRooms();
            }}
            onKeyDown={handleKeyDown}
            aria-label="Global search for rooms, pages, and actions"
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
              const prevCategory = index > 0 ? items[index - 1].category : null;
              const showCategoryHeader =
                item.category && item.category !== prevCategory;

              return (
                <React.Fragment key={item.id}>
                  {showCategoryHeader && (
                    <div className={styles.sectionHeader}>{item.category}</div>
                  )}
                  <button
                    type="button"
                    className={`${styles.resultItem} ${
                      isSelected ? styles.resultItemActive : ""
                    }`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className={styles.itemIcon}>{item.icon}</span>
                    <div className={styles.itemContent}>
                      <div className={styles.itemTitle}>{item.title}</div>
                      {item.subtitle && (
                        <div className={styles.itemSubtitle}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span className={styles.itemEnterHint}>↵</span>
                    )}
                  </button>
                </React.Fragment>
              );
            })
          ) : (
            <div className={styles.emptyState}>
              {query
                ? `No results matching "${query}"`
                : "Search rooms, pages, actions, or enter a room code."}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

