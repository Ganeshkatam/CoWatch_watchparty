import {
  AppAnnouncement,
  dismissAnnouncement,
  isAnnouncementDismissed,
  isValidActionUrl,
  sortAnnouncements,
} from "./announcements";

// Mock localStorage for node environment
const storage = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storage.get(key) || null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

if (typeof window === "undefined" || !global.localStorage) {
  (global as any).localStorage = mockLocalStorage;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("Running announcements unit tests...");

// Test 1: Action URL validation
console.log("Testing isValidActionUrl...");
assert(isValidActionUrl("/create"), "Should accept relative internal path /create");
assert(isValidActionUrl("/rooms/my-room"), "Should accept nested relative path");
assert(isValidActionUrl("https://example.com"), "Should accept https URL");
assert(isValidActionUrl("http://localhost:3000"), "Should accept http URL");

assert(!isValidActionUrl("javascript:alert(1)"), "Should reject javascript: scheme");
assert(!isValidActionUrl("data:text/html,malicious"), "Should reject data: scheme");
assert(!isValidActionUrl("vbscript:msgbox"), "Should reject vbscript: scheme");
assert(!isValidActionUrl("//protocol-relative.com"), "Should reject protocol-relative // URLs");
assert(!isValidActionUrl("\\path\\traversal"), "Should reject backslash paths");
assert(!isValidActionUrl(""), "Should reject empty string");
assert(!isValidActionUrl(null), "Should reject null");
assert(!isValidActionUrl(undefined), "Should reject undefined");

// Test 2: Versioned dismissal semantics
console.log("Testing versioned dismissal...");
const announcementA: AppAnnouncement = {
  id: "test-announcement-1",
  title: "Feature Update",
  body: "Host delegation is now active.",
  level: "info",
  action_label: "View Rooms",
  action_url: "/myrooms",
  published_at: "2026-09-10T12:00:00.000Z",
  updated_at: "2026-09-10T12:00:00.000Z",
};

assert(!isAnnouncementDismissed(announcementA), "Should initially not be dismissed");

dismissAnnouncement(announcementA);
assert(
  isAnnouncementDismissed(announcementA),
  "Should be dismissed after calling dismissAnnouncement"
);

// Announcement edited: updated_at changed to newer timestamp
const editedAnnouncementA: AppAnnouncement = {
  ...announcementA,
  body: "Host delegation now has automatic owner reclaim.",
  updated_at: "2026-09-10T15:30:00.000Z",
};

assert(
  !isAnnouncementDismissed(editedAnnouncementA),
  "Should re-appear when updated_at is newer than dismissed version"
);

dismissAnnouncement(editedAnnouncementA);
assert(
  isAnnouncementDismissed(editedAnnouncementA),
  "Should be dismissed again with updated version timestamp"
);

// Test 3: Priority and publication sorting
console.log("Testing sortAnnouncements...");
const items: AppAnnouncement[] = [
  {
    id: "1",
    title: "Info announcement",
    body: "Standard info",
    level: "info",
    published_at: "2026-09-10T10:00:00.000Z",
    updated_at: "2026-09-10T10:00:00.000Z",
  },
  {
    id: "2",
    title: "Critical warning",
    body: "Urgent maintenance notice",
    level: "critical",
    published_at: "2026-09-10T09:00:00.000Z",
    updated_at: "2026-09-10T09:00:00.000Z",
  },
  {
    id: "3",
    title: "Update note",
    body: "New features released",
    level: "success",
    published_at: "2026-09-10T11:00:00.000Z",
    updated_at: "2026-09-10T11:00:00.000Z",
  },
  {
    id: "4",
    title: "Notice",
    body: "Scheduled maintenance in 2 hours",
    level: "warning",
    published_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
  },
];

const sorted = sortAnnouncements(items);
assert(sorted[0].id === "2", "Critical item should have highest priority");
assert(sorted[1].id === "4", "Warning item should have second highest priority");
assert(sorted[2].id === "3", "Success item should have third highest priority");
assert(sorted[3].id === "1", "Info item should have fourth highest priority");

console.log("All announcements unit tests passed successfully!");
