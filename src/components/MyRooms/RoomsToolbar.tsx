import React, { useState } from "react";
import {
  TextInput,
  Menu,
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
  IconArrowsSort,
  IconChevronDown,
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

const sortOptions = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "title-asc", label: "Title A–Z" },
  { value: "title-desc", label: "Title Z–A" },
  { value: "expiring", label: "Expiring Soon" },
];

const sortLabelMap: Record<string, string> = {
  newest: "Newest",
  oldest: "Oldest",
  "title-asc": "Title A–Z",
  "title-desc": "Title Z–A",
  expiring: "Expiring",
};

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
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          leftSection={<IconSearch size={14} color="var(--text-muted)" />}
          leftSectionWidth={28}
          rightSection={
            searchQuery ? (
              <ActionIcon
                size={18}
                variant="transparent"
                c="dimmed"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <IconX size={11} />
              </ActionIcon>
            ) : null
          }
          rightSectionWidth={26}
          size="xs"
          styles={{
            root: {
              width: '100%',
            },
            wrapper: {
              height: '32px',
              minHeight: '32px',
            },
            input: {
              background: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
              height: '32px !important',
              minHeight: '32px !important',
              borderRadius: '8px',
              fontSize: '12px',
              paddingLeft: '28px !important',
              paddingRight: searchQuery ? '26px !important' : '8px !important',
              boxShadow: 'var(--shadow-sm)',
            },
            section: {
              width: '28px',
            },
          }}
        />
      </div>

      <div className={styles.toolbarActions}>
        <Popover
          opened={filterOpened}
          onChange={setFilterOpened}
          position="bottom-start"
          shadow="lg"
          radius="md"
          width={290}
          withArrow
        >
          <Popover.Target>
            <Button
              variant={filterOption !== "all" ? "light" : "default"}
              color="violet"
              size="xs"
              radius="md"
              leftSection={<IconAdjustmentsHorizontal size={14} />}
              onClick={() => setFilterOpened((o) => !o)}
              styles={{
                root: {
                  height: '32px',
                  borderRadius: '8px',
                  borderColor: filterOption !== "all" ? 'var(--color-violet)' : 'var(--border-subtle)',
                  backgroundColor: filterOption !== "all" ? 'var(--accent-primary-soft)' : 'var(--bg-surface)',
                  color: filterOption !== "all" ? 'var(--color-violet)' : 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '12px',
                  padding: '0 8px',
                  boxShadow: 'var(--shadow-sm)',
                },
              }}
            >
              <Group gap={4} wrap="nowrap">
                <span>{filterOption === "all" ? "Filter" : `Filter: ${filterLabelMap[filterOption] || filterOption}`}</span>
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
                    <IconX size={11} />
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
          <Menu shadow="md" radius="md" position="bottom-start" width={180}>
            <Menu.Target>
              <Button
                variant="default"
                size="xs"
                radius="md"
                leftSection={<IconArrowsSort size={14} />}
                rightSection={<IconChevronDown size={12} style={{ opacity: 0.6 }} />}
                styles={{
                  root: {
                    height: '32px',
                    borderRadius: '8px',
                    borderColor: 'var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '12px',
                    padding: '0 8px',
                    boxShadow: 'var(--shadow-sm)',
                  },
                }}
              >
                <span>{sortLabelMap[sortOption] || "Sort"}</span>
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {sortOptions.map((opt) => (
                <Menu.Item
                  key={opt.value}
                  onClick={() => setSortOption(opt.value)}
                  rightSection={sortOption === opt.value ? <IconCheck size={14} color="var(--color-violet)" /> : null}
                  style={{
                    fontWeight: sortOption === opt.value ? 600 : 400,
                    color: sortOption === opt.value ? 'var(--color-violet)' : 'inherit',
                  }}
                >
                  {opt.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </div>

        <div className={styles.viewToggle}>
          <SegmentedControl
            value={viewMode}
            onChange={(val) => setViewMode(val as 'grid' | 'stack')}
            data={[
              {
                value: 'grid',
                label: (
                  <Center style={{ gap: 4 }}>
                    <IconLayoutGrid size={14} />
                  </Center>
                ),
              },
              {
                value: 'stack',
                label: (
                  <Center style={{ gap: 4 }}>
                    <IconList size={14} />
                  </Center>
                ),
              },
            ]}
            color="violet"
            size="xs"
            radius="md"
            styles={{
              root: {
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                padding: '2px',
                boxShadow: 'var(--shadow-sm)',
              },
            }}
          />
        </div>
      </div>
    </div>
  );
};
