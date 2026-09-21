import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { Title, Text, Button, Loader, Center } from "@mantine/core";
import { apiFetch } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import styles from "./MyRooms.module.css";
import { Hero } from "./Hero";
import { RoomStats } from "./RoomStats";
import { RoomsToolbar } from "./RoomsToolbar";
import { RoomCard } from "./RoomCard";
import { RoomPagination } from "./RoomPagination";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { sanitizeServerErrorMessage } from "../../utils/userMessages";
import { parseMyRoomsParams, getMyRoomsUrl, MyRoomsStatusFilter, MyRoomsViewMode } from "../../utils/routeParams";

export interface RoomSummary {
  roomId: string;
  isPasscodeProtected: boolean;
  currentPasscode?: string | null;
  creationTime: string;
  roomTitle: string | null;
  roomDescription: string | null;
  coverPhoto: string | null;
  isChatDisabled: boolean;
  isSubRoom: boolean;
  status: "scheduled" | "active" | "inactive" | "expiring" | "expired" | "ended";
  startedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  isPermanent?: boolean;
}

interface RoomStatsData {
  total: number;
  active: number;
  expiring: number;
  finished: number;
}

export interface ListRoomsResponse {
  rooms: RoomSummary[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  stats?: RoomStatsData;
}

export type ListRoomsResult = RoomSummary[] | ListRoomsResponse;

const useRooms = (
  user: any,
  page: number,
  pageSize: number,
  searchQuery: string,
  sortOption: string,
  filterOption: string
) => {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [stats, setStats] = useState<RoomStatsData>({ total: 0, active: 0, expiring: 0, finished: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);

  const fetchRooms = useCallback(async (silent = false) => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        sort: sortOption,
      });
      if (searchQuery.trim()) params.append("search", searchQuery.trim());
      if (filterOption === "protected") {
        params.append("access", "protected");
      } else if (filterOption !== "all") {
        params.append("status", filterOption);
      }

      const data = await apiFetch<ListRoomsResult>(`/listRooms?${params.toString()}`, {
        requireAuth: true,
      });

      let roomsList: RoomSummary[] = [];
      let total = 0;
      let parsedStats: RoomStatsData = { total: 0, active: 0, expiring: 0, finished: 0 };

      if (Array.isArray(data)) {
        roomsList = data;
        total = data.length;
      } else if (data && typeof data === "object") {
        roomsList = Array.isArray(data.rooms) ? data.rooms : [];
        total = data.total !== undefined ? Number(data.total) || 0 : roomsList.length;
        if (data.stats) {
          parsedStats = data.stats;
        }
      }

      setRooms(roomsList);
      setTotalCount(total);
      setStats(parsedStats);
      setError(null);
    } catch (err: any) {
      if (!silent) {
        setError(sanitizeServerErrorMessage(err));
      }
    } finally {
      isFetchingRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, [user, page, pageSize, sortOption, filterOption, searchQuery]);

  useEffect(() => {
    fetchRooms(false);

    let intervalId: any = null;

    const startPolling = () => {
      if (!intervalId) {
        intervalId = setInterval(() => {
          if (document.visibilityState === "visible") {
            fetchRooms(true);
          }
        }, 10000);
      }
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        fetchRooms(true);
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === "visible") {
      startPolling();
    }

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      stopPolling();
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [fetchRooms]);

  const deleteRoom = async (roomId: string) => {
    try {
      await apiFetch(`/deleteRoom?roomId=${encodeURIComponent(roomId)}`, {
        method: "DELETE",
        requireAuth: true,
      });
      setRooms(prev => prev.filter(r => r.roomId !== roomId));
      setTotalCount(prev => Math.max(0, prev - 1));
      fetchRooms(true);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const updateRoomCover = async (roomId: string, coverPhoto: string) => {
    try {
      await apiFetch(`/updateRoomCover`, {
        method: "POST",
        requireAuth: true,
        body: { uid: user?.id, roomId, coverPhoto },
      });
      setRooms(prev => prev.map(r => r.roomId === roomId ? { ...r, coverPhoto } : r));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  return { rooms, totalCount, stats, loading, error, deleteRoom, updateRoomCover, refresh: () => fetchRooms(true) };
};

export const MyRooms = () => {
  const { user } = useContext(MetadataContext);
  const history = useHistory();
  const location = useLocation();

  useDocumentMetadata({
    title: "My Rooms",
    description: "Manage your active and permanent CoWatch watch party rooms.",
  });

  const parsedParams = useMemo(() => parseMyRoomsParams(location.search), [location.search]);
  const filterOption = parsedParams.status;
  const viewMode = parsedParams.view;
  const currentPage = parsedParams.page;

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortOption, setSortOption] = useState("newest");
  const PAGE_SIZE = 12;

  // Debounce search typing
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const {
    rooms,
    totalCount,
    stats,
    loading,
    error,
    deleteRoom,
    updateRoomCover,
    refresh,
  } = useRooms(
    user,
    currentPage,
    PAGE_SIZE,
    debouncedSearch,
    sortOption,
    filterOption
  );

  const setViewMode = useCallback((mode: MyRoomsViewMode) => {
    history.replace(getMyRoomsUrl({ status: filterOption, view: mode, page: currentPage }));
    try {
      localStorage.setItem('cowatch-room-view-mode', mode);
    } catch (e) { }
  }, [history, filterOption, currentPage]);

  const setFilterOption = useCallback((status: string) => {
    const validStatus = (status as MyRoomsStatusFilter) || "all";
    history.replace(getMyRoomsUrl({ status: validStatus, view: viewMode, page: 1 }));
  }, [history, viewMode]);

  const setCurrentPage = useCallback((page: number) => {
    history.replace(getMyRoomsUrl({ status: filterOption, view: viewMode, page }));
  }, [history, filterOption, viewMode]);

  const handleClearAllFilters = useCallback(() => {
    setSearchQuery("");
    history.replace(getMyRoomsUrl({ status: "all", view: viewMode, page: 1 }));
  }, [history, viewMode]);

  const hasActiveFilters =
    filterOption !== "all" ||
    searchQuery.trim().length > 0;

  if (!user && !loading) {
    return (
      <div className={styles.page}>
        <Center style={{ height: '50vh' }}>
          <Text>Please sign in to view your rooms.</Text>
        </Center>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <Hero>
          {!error && (
            <RoomStats
              rooms={rooms}
              loading={loading && totalCount === 0}
              selectedStatus={filterOption}
              onSelectStatus={setFilterOption}
              statsOverride={stats}
            />
          )}
        </Hero>

        {loading && totalCount === 0 ? (
          <Center style={{ minHeight: "200px" }}><Loader size="lg" color="violet" /></Center>
        ) : error ? (
          <Center style={{ minHeight: "200px" }}><Text c="red">{error}</Text></Center>
        ) : totalCount === 0 && !hasActiveFilters ? (
          <div style={{ textAlign: "center", padding: "64px 0", background: "var(--bg-surface)", borderRadius: "16px", border: "1px solid var(--border-subtle)", marginTop: "32px" }}>
            <Title order={3} mb="sm" style={{ color: "var(--text-primary)" }}>No rooms yet</Title>
            <Text c="dimmed" mb="lg">Create a room to start watching together.</Text>
            <Button size="md" variant="gradient" onClick={() => history.push("/create")}>
              Create your first room
            </Button>
          </div>
        ) : (
          <>
            <RoomsToolbar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              sortOption={sortOption}
              setSortOption={setSortOption}
              viewMode={viewMode}
              setViewMode={setViewMode}
              filterOption={filterOption}
              setFilterOption={setFilterOption}
              onRefresh={refresh}
            />

            <div className={styles.roomSection} style={{ position: "relative", opacity: loading ? 0.65 : 1, transition: "opacity 0.2s ease" }}>
              {loading && (
                <div
                  style={{
                    position: "absolute",
                    top: "16px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 10,
                    background: "var(--bg-surface)",
                    padding: "6px 16px",
                    borderRadius: "20px",
                    border: "1px solid var(--border-subtle)",
                    boxShadow: "var(--shadow-md)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Loader size="xs" color="violet" />
                  <Text size="xs" fw={500} c="dimmed">Loading rooms...</Text>
                </div>
              )}
              <div className={viewMode === 'grid' ? styles.roomGrid : styles.roomList}>
                {rooms.map(room => (
                  <RoomCard
                    key={room.roomId}
                    room={room}
                    onDelete={deleteRoom}
                    onUpdateCover={updateRoomCover}
                    viewMode={viewMode}
                    onRefresh={refresh}
                  />
                ))}
              </div>

              {rooms.length === 0 && (
                <Center style={{ minHeight: "200px", flexDirection: "column", gap: 12 }}>
                  <Text c="dimmed">
                    {hasActiveFilters
                      ? "No rooms match your filter or search criteria."
                      : "No rooms found."}
                  </Text>
                  {hasActiveFilters && (
                    <Button
                      variant="subtle"
                      color="violet"
                      size="xs"
                      onClick={handleClearAllFilters}
                    >
                      Clear all filters
                    </Button>
                  )}
                </Center>
              )}

              <RoomPagination
                currentPage={currentPage}
                pageSize={PAGE_SIZE}
                totalItems={totalCount}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
function setIsRefreshing(arg0: boolean) {
  throw new Error("Function not implemented.");
}

