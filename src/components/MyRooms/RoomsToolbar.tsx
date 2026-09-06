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
          leftSection={<IconSearch size={18} color="var(--text-muted)" />}
          size="md"
          radius="md"
          styles={{
            input: { background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }
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
                  <Center style={{ gap: 10 }}>
                    <IconLayoutGrid size={16} />
                  </Center>
                ),
              },
              {
                value: 'stack',
                label: (
                  <Center style={{ gap: 10 }}>
                    <IconList size={16} />
                  </Center>
                ),
              },
            ]}
            color="violet"
            size="md"
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
            size="md"
            radius="md"
            styles={{
              input: { background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }
            }}
          />
        </div>
      </div>
    </div>
  );
};
