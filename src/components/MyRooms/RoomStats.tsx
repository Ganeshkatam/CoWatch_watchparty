import React from "react";
import { type RoomSummary } from "./MyRooms";

export const RoomStats = ({ rooms }: { rooms: RoomSummary[] }) => {
  const total = rooms.length;
  const active = rooms.filter(r => r.status === "active").length;
  const expiring = rooms.filter(r => r.status === "expiring").length;
  const finished = rooms.filter(r => r.status === "expired" || r.status === "ended").length;

  return (
    <div style={{ display: 'flex', gap: '48px', flexWrap: 'wrap' }}>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--mantine-color-violet-3)' }}>
          TOTAL ROOMS
        </div>
        <div style={{ fontSize: '24px', fontWeight: 600, color: 'white', lineHeight: 1 }}>
          {total.toString().padStart(2, '0')}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--mantine-color-green-4)' }}>
          ACTIVE
        </div>
        <div style={{ fontSize: '24px', fontWeight: 600, color: 'white', lineHeight: 1 }}>
          {active.toString().padStart(2, '0')}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--mantine-color-orange-4)' }}>
          EXPIRING SOON
        </div>
        <div style={{ fontSize: '24px', fontWeight: 600, color: 'white', lineHeight: 1 }}>
          {expiring.toString().padStart(2, '0')}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
          FINISHED
        </div>
        <div style={{ fontSize: '24px', fontWeight: 600, color: 'white', lineHeight: 1 }}>
          {finished.toString().padStart(2, '0')}
        </div>
      </div>

    </div>
  );
};
