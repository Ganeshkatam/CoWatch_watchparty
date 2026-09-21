import { apiFetch } from "./utils";

export type AnnouncementLevel = "info" | "success" | "warning" | "critical";

export interface AppAnnouncement {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  action_label?: string | null;
  action_url?: string | null;
  published_at: string;
  updated_at: string;
}

const STORAGE_KEY = "cowatch_dismissed_announcements";

interface DismissedEntry {
  dismissed_at: string;
  updated_at: string;
}

type DismissedMap = Record<string, DismissedEntry>;

const getDismissedMap = (): DismissedMap => {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const saveDismissedMap = (map: DismissedMap): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
};

/**
 * Validates action URLs to prevent javascript:, data:, or malformed protocols.
 * Allows safe relative paths (e.g. /myrooms, /create) and valid http/https URLs.
 */
export const isValidActionUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== "string") {
    return false;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Allow relative internal paths
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) {
    return true;
  }

  // Allow absolute https or http URLs
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

export const isAnnouncementDismissed = (announcement: AppAnnouncement): boolean => {
  const map = getDismissedMap();
  const entry = map[announcement.id];
  if (!entry) return false;

  const entryTime = new Date(entry.updated_at).getTime();
  const annTime = new Date(announcement.updated_at).getTime();

  if (isNaN(entryTime) || isNaN(annTime)) {
    return false;
  }

  return annTime <= entryTime;
};

export const dismissAnnouncement = (announcement: AppAnnouncement): void => {
  const map = getDismissedMap();
  map[announcement.id] = {
    dismissed_at: new Date().toISOString(),
    updated_at: announcement.updated_at,
  };
  saveDismissedMap(map);
};

const LEVEL_PRIORITY: Record<AnnouncementLevel, number> = {
  critical: 4,
  warning: 3,
  info: 2,
  success: 1,
};

export const sortAnnouncements = (items: AppAnnouncement[]): AppAnnouncement[] => {
  return [...items].sort((a, b) => {
    const pA = LEVEL_PRIORITY[a.level] || 0;
    const pB = LEVEL_PRIORITY[b.level] || 0;
    if (pB !== pA) {
      return pB - pA;
    }
    const tA = new Date(a.published_at).getTime();
    const tB = new Date(b.published_at).getTime();
    return tB - tA;
  });
};

export interface RawAnnouncementItem {
  id: string | number;
  title?: string;
  body?: string;
  level?: string;
  action_label?: string | null;
  action_url?: string | null;
  published_at?: string;
  updated_at?: string;
}

export interface AnnouncementsApiResponse {
  announcements: RawAnnouncementItem[];
}

export const fetchAnnouncements = async (): Promise<AppAnnouncement[]> => {
  try {
    const data = await apiFetch<AnnouncementsApiResponse>("/announcements", {
      timeoutMs: 3500,
    });
    if (Array.isArray(data?.announcements)) {
      return data.announcements.map((item) => ({
        id: String(item.id),
        title: String(item.title || ""),
        body: String(item.body || ""),
        level: (["info", "success", "warning", "critical"].includes(item.level || "")
          ? item.level
          : "info") as AnnouncementLevel,
        action_label: item.action_label ? String(item.action_label) : null,
        action_url: isValidActionUrl(item.action_url) ? item.action_url : null,
        published_at: String(item.published_at || new Date().toISOString()),
        updated_at: String(item.updated_at || new Date().toISOString()),
      }));
    }
  } catch (e) {
    console.warn("Failed to fetch announcements from server:", e);
  }

  return [];
};
