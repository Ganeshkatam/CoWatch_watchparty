import React from "react";
import { TextInput, Select, SegmentedControl, Center } from "@mantine/core";
import { IconSearch, IconLayoutGrid, IconList } from "@tabler/icons-react";
import styles from "./MyRooms.module.css";

export const RoomsToolbar = ({
  searchQuery,
  setSearchQuery,
  sortOption,
  setSortOption,
  viewMode,
  setViewMode
}: {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  sortOption: string;
  setSortOption: (val: string) => void;
  viewMode: 'grid' | 'stack';
  setViewMode: (val: 'grid' | 'stack') => void;
}) => {
  return (
    <div className={styles.toolbar}>
      <div className={styles.search}>
        <TextInput
          placeholder="Search rooms by title or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          leftSection={<IconSearch size={16} color="var(--text-muted)" />}
          size="sm"
          radius="md"
          styles={{
            input: {
              background: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
              height: '38px',
            },
          }}
        />
      </div>
      
      <div className={styles.toolbarActions}>
        <div className={styles.viewToggle}>
          <SegmentedControl
            value={viewMode}
            onChange={(val) => setViewMode(val as 'grid' | 'stack')}
            data={[
              {
                value: 'grid',
                label: (
                  <Center style={{ gap: 6 }}>
                    <IconLayoutGrid size={15} />
                  </Center>
                ),
              },
              {
                value: 'stack',
                label: (
                  <Center style={{ gap: 6 }}>
                    <IconList size={15} />
                  </Center>
                ),
              },
            ]}
            color="violet"
            size="sm"
            radius="md"
          />
        </div>

        <div className={styles.sort}>
          <Select
            value={sortOption}
            onChange={(val) => setSortOption(val || "newest")}
            data={[
              { value: "newest", label: "Newest First" },
              { value: "oldest", label: "Oldest First" },
              { value: "title-asc", label: "Title A–Z" },
              { value: "title-desc", label: "Title Z–A" },
              { value: "expiring", label: "Expiring Soon" },
            ]}
            size="sm"
            radius="md"
            styles={{
              input: {
                background: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)',
                height: '38px',
              },
            }}
          />
        </div>
      </div>
    </div>
  );
};
