import React from "react";
import { Skeleton } from "@mantine/core";
import { type RoomSummary } from "./MyRooms";

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
      color: "var(--mantine-color-violet-3)",
    },
    {
      id: "active",
      label: "ACTIVE",
      value: active,
      color: "var(--mantine-color-green-4)",
    },
    {
      id: "expiring",
      label: "EXPIRING SOON",
      value: expiring,
      color: "var(--mantine-color-orange-4)",
    },
    {
      id: "finished",
      label: "FINISHED",
      value: finished,
      color: "rgba(255, 255, 255, 0.7)",
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: "48px",
        flexWrap: "wrap",
        minHeight: "48px",
        alignItems: "center",
      }}
    >
      {stats.map((stat) => {
        const isSelected = selectedStatus === stat.id;
        const isClickable = Boolean(onSelectStatus);

        return (
          <div
            key={stat.label}
            onClick={() => {
              if (onSelectStatus) {
                onSelectStatus(isSelected ? "all" : stat.id);
              }
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              minWidth: "80px",
              cursor: isClickable ? "pointer" : "default",
              padding: "4px 8px",
              borderRadius: "8px",
              transition: "all 0.18s ease",
              backgroundColor: isSelected ? "rgba(255, 255, 255, 0.12)" : "transparent",
              outline: isSelected ? "1px solid rgba(255, 255, 255, 0.25)" : "none",
            }}
            title={isClickable ? `Filter by ${stat.label}` : undefined}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: stat.color,
                opacity: selectedStatus && selectedStatus !== "all" && !isSelected ? 0.6 : 1,
              }}
            >
              {stat.label}
            </div>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 600,
                color: "white",
                lineHeight: 1,
                height: "24px",
                display: "flex",
                alignItems: "center",
                opacity: selectedStatus && selectedStatus !== "all" && !isSelected ? 0.6 : 1,
              }}
            >
              {loading ? (
                <Skeleton
                  height={20}
                  width={36}
                  radius="sm"
                  style={{ opacity: 0.5 }}
                />
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
