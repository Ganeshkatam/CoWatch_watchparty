import React, { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { useHistory } from "react-router-dom";
import { Title, Text, Button, Loader, Center } from "@mantine/core";
import { serverPath, serverCandidates, setServerPath } from "../../utils/utils";
import { getAccessToken } from "../../utils/supabaseClient";
import { MetadataContext } from "../../MetadataContext";
import styles from "./MyRooms.module.css";
import { Hero } from "./Hero";
import { RoomStats } from "./RoomStats";
import { RoomsToolbar } from "./RoomsToolbar";
import { RoomCard } from "./RoomCard";
import { RoomPagination } from "./RoomPagination";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

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

  const fetchRooms = useCallback(async (silent = false) => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        uid: user.id,
        token: token || "",
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

      let response: Response | undefined;
      const candidatesToTry = [serverPath, ...serverCandidates.filter((c: string) => c !== serverPath)];

      for (let i = 0; i < candidatesToTry.length; i++) {
        const candidate = candidatesToTry[i];
        try {
          const res = await fetch(`${candidate}/listRooms?${params.toString()}`);
          if (res.ok) {
            response = res;
            if (candidate !== serverPath) {
              setServerPath(candidate);
            }
            break;
          } else {
            response = res;
          }
        } catch (fetchErr) {
          if (i === candidatesToTry.length - 1 && !response) {
            throw fetchErr;
          }
        }
      }

      if (!response || !response.ok) {
        const errData = await response?.json().catch(() => null);
        const errMsg =
          errData?.error?.message ||
          errData?.error ||
          (response ? `Failed to fetch rooms (${response.status})` : "Failed to fetch rooms");
        throw new Error(errMsg);
      }
      const data = await response.json();
      if (data && Array.isArray(data.rooms)) {
        setRooms(data.rooms);
        setTotalCount(data.total ?? data.rooms.length);
        if (data.stats) setStats(data.stats);
      } else if (Array.isArray(data)) {
        setRooms(data);
        setTotalCount(data.length);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, page, pageSize, searchQuery, sortOption, filterOption]);

  useEffect(() => {
    fetchRooms(false);
    const interval = setInterval(() => fetchRooms(true), 30000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const deleteRoom = async (roomId: string) => {
    try {
      const token = await getAccessToken();
      const response = await fetch(`${serverPath}/deleteRoom?uid=${user.id}&token=${token}&roomId=${roomId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setRooms(prev => prev.filter(r => r.roomId !== roomId));
        setTotalCount(prev => Math.max(0, prev - 1));
        fetchRooms(true);
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const updateRoomCover = async (roomId: string, coverPhoto: string) => {
    try {
      const token = await getAccessToken();
      const response = await fetch(`${serverPath}/updateRoomCover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user?.id, token, roomId, coverPhoto })
      });
      if (response.ok) {
        setRooms(prev => prev.map(r => r.roomId === roomId ? { ...r, coverPhoto } : r));
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  return { rooms, totalCount, stats, loading, error, deleteRoom, updateRoomCover, refresh: fetchRooms };
};

export const MyRooms = () => {
  const { user } = useContext(MetadataContext);
  
  useDocumentMetadata({
    title: "My Rooms",
    description: "Manage your active and permanent CoWatch watch party rooms.",
  });
  
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortOption, setSortOption] = useState("newest");
  const [filterOption, setFilterOption] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
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
  } = useRooms(
    user,
    currentPage,
    PAGE_SIZE,
    debouncedSearch,
    sortOption,
    filterOption
  );

  const [viewMode, setViewModeState] = useState<'grid' | 'stack'>(() => {
    try {
      const stored = localStorage.getItem('cowatch-room-view-mode');
      if (stored === 'grid' || stored === 'stack') return stored;
    } catch (e) {}
    return 'grid';
  });

  const setViewMode = useCallback((mode: 'grid' | 'stack') => {
    setViewModeState(mode);
    try {
      localStorage.setItem('cowatch-room-view-mode', mode);
    } catch (e) {}
  }, []);

  const history = useHistory();

  const handleClearAllFilters = useCallback(() => {
    setFilterOption("all");
    setSearchQuery("");
  }, []);

  const hasActiveFilters =
    filterOption !== "all" ||
    searchQuery.trim().length > 0;

  // Reset to page 1 when search, sort, or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, sortOption, filterOption]);

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
            />

            <div className={styles.roomSection}>
              <div className={viewMode === 'grid' ? styles.roomGrid : styles.roomList}>
                {rooms.map(room => (
                  <RoomCard
                    key={room.roomId}
                    room={room}
                    onDelete={deleteRoom}
                    onUpdateCover={updateRoomCover}
                    viewMode={viewMode}
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
