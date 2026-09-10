import { serverPath } from "./utils";
import { supabase } from "./supabaseClient";

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

const DISMISS_PREFIX = "announcement-dismiss:";

/**
 * Validates action URLs to prevent javascript:, data:, or malformed protocols.
 * Allows safe relative paths (e.g. /rooms, /create) and valid http/https URLs.
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

/**
 * Checks whether an announcement has been dismissed for its current version.
 * If the announcement is edited (newer updated_at), it automatically re-appears.
 */
export const isAnnouncementDismissed = (announcement: AppAnnouncement): boolean => {
  try {
    const dismissedVersion = localStorage.getItem(`${DISMISS_PREFIX}${announcement.id}`);
    if (!dismissedVersion) {
      return false;
    }
    // Dismissed if the stored version matches the announcement's updated_at timestamp
    return dismissedVersion === announcement.updated_at;
  } catch {
    return false;
  }
};

/**
 * Persists versioned dismissal to localStorage.
 */
export const dismissAnnouncement = (announcement: AppAnnouncement): void => {
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${announcement.id}`, announcement.updated_at);
  } catch (err) {
    console.warn("Could not persist announcement dismissal:", err);
  }
};

const LEVEL_PRIORITY: Record<AnnouncementLevel, number> = {
  critical: 4,
  warning: 3,
  success: 2,
  info: 1,
};

/**
 * Sorts announcements by priority level first, then by published_at descending.
 */
export const sortAnnouncements = (items: AppAnnouncement[]): AppAnnouncement[] => {
  return [...items].sort((a, b) => {
    const prioA = LEVEL_PRIORITY[a.level] || 1;
    const prioB = LEVEL_PRIORITY[b.level] || 1;
    if (prioB !== prioA) {
      return prioB - prioA;
    }
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
  });
};

/**
 * Asynchronously fetches active announcements.
 * First tries the CoWatch server API (/announcements), with a fallback to direct Supabase query.
 * If both are unavailable or empty, returns an empty array.
 */
export const fetchAnnouncements = async (): Promise<AppAnnouncement[]> => {
  // 1. Try server API
  try {
    const response = await fetch(`${serverPath}/announcements`, {
      signal: AbortSignal.timeout(3500),
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.announcements)) {
        return data.announcements.map((item: any) => ({
          id: String(item.id),
          title: String(item.title || ""),
          body: String(item.body || ""),
          level: (["info", "success", "warning", "critical"].includes(item.level)
            ? item.level
            : "info") as AnnouncementLevel,
          action_label: item.action_label ? String(item.action_label) : null,
          action_url: isValidActionUrl(item.action_url) ? item.action_url : null,
          published_at: String(item.published_at || new Date().toISOString()),
          updated_at: String(item.updated_at || new Date().toISOString()),
        }));
      }
    }
  } catch {
    // Server API failed or timed out, attempt Supabase fallback
  }

  // 2. Direct Supabase query fallback
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, level, action_label, action_url, published_at, updated_at")
      .eq("is_active", true)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(10);

    if (!error && Array.isArray(data)) {
      return data.map((item: any) => ({
        id: String(item.id),
        title: String(item.title || ""),
        body: String(item.body || ""),
        level: (["info", "success", "warning", "critical"].includes(item.level)
          ? item.level
          : "info") as AnnouncementLevel,
        action_label: item.action_label ? String(item.action_label) : null,
        action_url: isValidActionUrl(item.action_url) ? item.action_url : null,
        published_at: String(item.published_at || new Date().toISOString()),
        updated_at: String(item.updated_at || new Date().toISOString()),
      }));
    }
  } catch {
    // Both failed
  }

  return [];
};
