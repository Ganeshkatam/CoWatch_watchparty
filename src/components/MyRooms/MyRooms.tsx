import React, { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { useHistory } from "react-router-dom";
import { Title, Text, Button, Loader, Center } from "@mantine/core";
import { serverPath, addAndSavePasscode } from "../../utils/utils";
import { getAccessToken } from "../../utils/supabaseClient";
import { MetadataContext } from "../../MetadataContext";
import styles from "./MyRooms.module.css";
import { Hero } from "./Hero";
import { RoomStats } from "./RoomStats";
import { RoomsToolbar } from "./RoomsToolbar";
import { RoomCard } from "./RoomCard";
import { RoomPagination } from "./RoomPagination";

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

const useRooms = (user: any) => {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`${serverPath}/listRooms?uid=${user.id}&token=${token}`);
      if (!response.ok) throw new Error("Failed to fetch rooms");
      const data = await response.json();
      if (Array.isArray(data)) {
        data.forEach((r: RoomSummary) => {
          if (r.currentPasscode) {
            addAndSavePasscode(r.roomId, r.currentPasscode);
          }
        });
      }
      setRooms(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 30000);
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

  return { rooms, loading, error, deleteRoom, updateRoomCover, refresh: fetchRooms };
};

export const MyRooms = () => {
  const { user } = useContext(MetadataContext);
  const { rooms, loading, error, deleteRoom, updateRoomCover } = useRooms(user);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState("newest");
  
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

  const [currentPage, setCurrentPage] = useState(1);
  
  const history = useHistory();
  const PAGE_SIZE = 12;

  // Reset to page 1 when search or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortOption]);

  const filteredAndSortedRooms = useMemo(() => {
    let result = rooms;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        r.roomTitle?.toLowerCase().includes(q) ||
        r.roomDescription?.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      if (sortOption === "newest") {
        return new Date(b.creationTime).getTime() - new Date(a.creationTime).getTime();
      } else if (sortOption === "oldest") {
        return new Date(a.creationTime).getTime() - new Date(b.creationTime).getTime();
      } else if (sortOption === "title-asc") {
        return (a.roomTitle || "").localeCompare(b.roomTitle || "");
      } else if (sortOption === "title-desc") {
        return (b.roomTitle || "").localeCompare(a.roomTitle || "");
      } else if (sortOption === "expiring") {
        const aIsActive = a.status === "active" || a.status === "expiring";
        const bIsActive = b.status === "active" || b.status === "expiring";
        if (aIsActive && !bIsActive) return -1;
        if (!aIsActive && bIsActive) return 1;
        if (aIsActive && bIsActive && a.expiresAt && b.expiresAt) {
          return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
        }
        return 0;
      }
      return 0;
    });

    return result;
  }, [rooms, searchQuery, sortOption]);

  const paginatedRooms = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredAndSortedRooms.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredAndSortedRooms, currentPage]);

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
          {(!loading && !error && rooms.length > 0) && <RoomStats rooms={rooms} />}
        </Hero>

        {loading && rooms.length === 0 ? (
          <Center style={{ minHeight: "200px" }}><Loader size="lg" color="violet" /></Center>
        ) : error ? (
          <Center style={{ minHeight: "200px" }}><Text c="red">{error}</Text></Center>
        ) : rooms.length === 0 ? (
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
            />

            <div className={styles.roomSection}>
              <div className={viewMode === 'grid' ? styles.roomGrid : styles.roomList}>
                {paginatedRooms.map(room => (
                  <RoomCard
                    key={room.roomId}
                    room={room}
                    onDelete={deleteRoom}
                    onUpdateCover={updateRoomCover}
                    viewMode={viewMode}
                  />
                ))}
              </div>

              {filteredAndSortedRooms.length === 0 && (
                <Center style={{ minHeight: "200px" }}>
                  <Text c="dimmed">No rooms match your search.</Text>
                </Center>
              )}

              <RoomPagination 
                currentPage={currentPage}
                pageSize={PAGE_SIZE}
                totalItems={filteredAndSortedRooms.length}
                onPageChange={setCurrentPage}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
