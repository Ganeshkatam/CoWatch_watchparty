import React from "react";
import { ActionIcon } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import styles from "./MyRooms.module.css";

export const RoomPagination = ({
  currentPage,
  pageSize,
  totalItems,
  onPageChange
}: {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) => {
  if (totalItems <= pageSize) {
    return null;
  }

  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={styles.pagination}>
      <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
        <ActionIcon 
          variant="subtle" 
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <IconChevronLeft size={16} />
        </ActionIcon>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '32px', background: 'var(--color-violet)', color: 'white', borderRadius: '4px', fontSize: '14px', fontWeight: 600 }}>
          {currentPage}
        </div>
        <ActionIcon 
          variant="subtle" 
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <IconChevronRight size={16} />
        </ActionIcon>
      </div>
      <div className={styles.paginationText}>
        Showing {startItem} of {totalItems} rooms
      </div>
    </div>
  );
};
