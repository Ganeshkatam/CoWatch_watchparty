import React from "react";
import { type RoomSummary } from "./MyRooms";
import styles from "./MyRooms.module.css";

interface RoomStatsProps {
  rooms: RoomSummary[];
  loading?: boolean;
  selectedStatus?: string;
  onSelectStatus?: (status: string) => void;
  statsOverride?: {
    total: number;
    active: number;
    expiring: number;
    finished: number;
  };
}

export const RoomStats: React.FC<RoomStatsProps> = ({
  rooms,
  loading = false,
  selectedStatus,
  onSelectStatus,
  statsOverride,
}) => {
  const total = statsOverride ? statsOverride.total : rooms.length;
  const active = statsOverride ? statsOverride.active : rooms.filter((r) => r.status === "active").length;
  const expiring = statsOverride ? statsOverride.expiring : rooms.filter((r) => r.status === "expiring").length;
  const finished = statsOverride
    ? statsOverride.finished
    : rooms.filter((r) => r.status === "expired" || r.status === "ended").length;

  const stats = [
    {
      id: "all",
      label: "TOTAL ROOMS",
      value: total,
      color: "#A78BFA",
    },
    {
      id: "active",
      label: "ACTIVE",
      value: active,
      color: "#4ADE80",
    },
    {
      id: "expiring",
      label: "EXPIRING SOON",
      value: expiring,
      color: "#FBBF24",
    },
    {
      id: "finished",
      label: "FINISHED",
      value: finished,
      color: "rgba(255, 255, 255, 0.75)",
    },
  ];

  return (
    <div className={styles.statsMinimal}>
      {stats.map((stat) => {
        const isSelected = selectedStatus === stat.id;
        const isClickable = Boolean(onSelectStatus);
        const isDimmed = Boolean(selectedStatus && selectedStatus !== "all" && !isSelected);

        return (
          <div
            key={stat.label}
            onClick={() => {
              if (onSelectStatus && !loading) {
                onSelectStatus(isSelected ? "all" : stat.id);
              }
            }}
            className={`${styles.statItemMinimal} ${isSelected ? styles.statItemActive : ""} ${isDimmed ? styles.statItemDimmed : ""} ${loading ? styles.statItemLoading : ""}`}
            title={isClickable && !loading ? `Filter by ${stat.label}` : undefined}
          >
            <div
              className={styles.statLabelMinimal}
              style={{ color: stat.color }}
            >
              {stat.label}
            </div>
            <div className={styles.statValueMinimal}>
              {loading ? (
                <div className={styles.statValueSkeleton} aria-label="Loading statistic..." />
              ) : (
                stat.value.toString().padStart(2, "0")
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
