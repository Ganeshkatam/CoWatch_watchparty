import React, { useState } from "react";
import {
  TextInput,
  Select,
  SegmentedControl,
  Center,
  Button,
  Popover,
  Group,
  ActionIcon,
} from "@mantine/core";
import {
  IconSearch,
  IconLayoutGrid,
  IconList,
  IconAdjustmentsHorizontal,
  IconCheck,
  IconX,
  IconLock,
} from "@tabler/icons-react";
import styles from "./MyRooms.module.css";

const filterLabelMap: Record<string, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
  expiring: "Expiring",
  permanent: "Permanent",
  finished: "Finished",
  protected: "Protected",
};

const statusOptions = [
  { id: "all", label: "All Rooms" },
  { id: "active", label: "Active", color: "var(--mantine-color-green-5)" },
  { id: "inactive", label: "Inactive", color: "var(--mantine-color-yellow-5)" },
  { id: "expiring", label: "Expiring", color: "var(--mantine-color-orange-5)" },
  { id: "permanent", label: "Permanent", color: "var(--mantine-color-violet-4)" },
  { id: "finished", label: "Finished", color: "var(--mantine-color-gray-5)" },
];

const accessOptions = [
  { id: "protected", label: "Passcode Protected" },
];

export const RoomsToolbar = ({
  searchQuery,
  setSearchQuery,
  sortOption,
  setSortOption,
  filterOption,
  setFilterOption,
  viewMode,
  setViewMode,
}: {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  sortOption: string;
  setSortOption: (val: string) => void;
  filterOption: string;
  setFilterOption: (val: string) => void;
  viewMode: 'grid' | 'stack';
  setViewMode: (val: 'grid' | 'stack') => void;
}) => {
  const [filterOpened, setFilterOpened] = useState(false);

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
        <Popover
          opened={filterOpened}
          onChange={setFilterOpened}
          position="bottom-end"
          shadow="lg"
          radius="md"
          width={290}
          withArrow
        >
          <Popover.Target>
            <Button
              variant={filterOption !== "all" ? "light" : "default"}
              color="violet"
              size="sm"
              radius="md"
              leftSection={<IconAdjustmentsHorizontal size={15} />}
              onClick={() => setFilterOpened((o) => !o)}
              styles={{
                root: {
                  height: '38px',
                  borderColor: filterOption !== "all" ? 'var(--mantine-color-violet-6)' : 'var(--border-subtle)',
                  backgroundColor: filterOption !== "all" ? 'rgba(139, 92, 246, 0.12)' : 'var(--bg-surface)',
                  color: filterOption !== "all" ? 'var(--mantine-color-violet-4)' : 'var(--text-primary)',
                },
              }}
            >
              <Group gap={6} wrap="nowrap">
                <span>{filterOption === "all" ? "Filters" : `Filter: ${filterLabelMap[filterOption] || filterOption}`}</span>
                {filterOption !== "all" && (
                  <ActionIcon
                    size="xs"
                    variant="transparent"
                    color="violet"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterOption("all");
                    }}
                    aria-label="Clear filter"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                )}
              </Group>
            </Button>
          </Popover.Target>
          <Popover.Dropdown className={styles.filterContainer}>
            <div className={styles.filterHeader}>
              <span className={styles.filterHeaderTitle}>Filter Rooms</span>
              {filterOption !== "all" && (
                <Button
                  variant="subtle"
                  color="violet"
                  size="xs"
                  p={0}
                  onClick={() => setFilterOption("all")}
                >
                  Reset
                </Button>
              )}
            </div>

            <div className={styles.filterGroupTitle}>Status</div>
            <div className={styles.filterOptionsGrid}>
              {statusOptions.map((opt) => {
                const isSelected = filterOption === opt.id;
                return (
                  <div
                    key={opt.id}
                    className={`${styles.filterChip} ${isSelected ? styles.filterChipActive : ""}`}
                    onClick={() => setFilterOption(opt.id)}
                  >
                    {opt.color && !isSelected && (
                      <span className={styles.statusDot} style={{ backgroundColor: opt.color }} />
                    )}
                    {isSelected && <IconCheck size={13} />}
                    <span>{opt.label}</span>
                  </div>
                );
              })}
            </div>

            <div className={styles.filterGroupTitle}>Security</div>
            <div className={styles.filterOptionsGrid} style={{ marginBottom: 0 }}>
              {accessOptions.map((opt) => {
                const isSelected = filterOption === opt.id;
                return (
                  <div
                    key={opt.id}
                    className={`${styles.filterChip} ${isSelected ? styles.filterChipActive : ""}`}
                    onClick={() => setFilterOption(isSelected ? "all" : opt.id)}
                  >
                    <IconLock size={12} />
                    {isSelected && <IconCheck size={13} />}
                    <span>{opt.label}</span>
                  </div>
                );
              })}
            </div>
          </Popover.Dropdown>
        </Popover>

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
      </div>
    </div>
  );
};
