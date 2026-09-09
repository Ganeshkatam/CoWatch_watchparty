import React from "react";
import { Skeleton } from "@mantine/core";
import { type RoomSummary } from "./MyRooms";

interface RoomStatsProps {
  rooms: RoomSummary[];
  loading?: boolean;
}

export const RoomStats: React.FC<RoomStatsProps> = ({ rooms, loading = false }) => {
  const total = rooms.length;
  const active = rooms.filter((r) => r.status === "active").length;
  const expiring = rooms.filter((r) => r.status === "expiring").length;
  const finished = rooms.filter(
    (r) => r.status === "expired" || r.status === "ended"
  ).length;

  const stats = [
    {
      label: "TOTAL ROOMS",
      value: total,
      color: "var(--mantine-color-violet-3)",
    },
    {
      label: "ACTIVE",
      value: active,
      color: "var(--mantine-color-green-4)",
    },
    {
      label: "EXPIRING SOON",
      value: expiring,
      color: "var(--mantine-color-orange-4)",
    },
    {
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
      {stats.map((stat) => (
        <div
          key={stat.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            minWidth: "80px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: stat.color,
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
      ))}
    </div>
  );
};
