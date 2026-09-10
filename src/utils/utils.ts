//@ts-expect-error
import canAutoplay from "can-autoplay";
import type { User } from "@supabase/supabase-js";
import config from "../config";
import { cyrb53 } from "./hash";

export function formatTimestamp(input: any, zeroTime?: number): string {
  if (
    input === null ||
    input === undefined ||
    input === false ||
    Number.isNaN(input) ||
    input === Infinity
  ) {
    return "";
  }
  if (zeroTime) {
    return new Date((zeroTime + input) * 1000).toLocaleTimeString();
  }
  let hours = Math.abs(Math.trunc(Number(input) / 3600));
  let minutes = Math.abs(Math.trunc(Number(input) / 60) % 60)
    .toString()
    .padStart(2, "0");
  let seconds = Math.abs(Math.trunc(Number(input) % 60))
    .toString()
    .padStart(2, "0");
  return `${Number(input) < 0 ? "-" : ""}${hours ? `${hours}:` : ""}${minutes}:${seconds}`;
}

export function formatSpeed(input: number) {
  if (input >= 1000000) {
    return (input / 1000000).toFixed(2) + " MB/s";
  }
  if (input >= 1000) {
    return (input / 1000).toFixed(0) + " KB/s";
  }
  return input + " B/s";
}

export function formatSize(input: number) {
  if (input >= 1000000000) {
    return (input / 1000000000).toFixed(2) + " GB";
  }
  if (input >= 1000000) {
    return (input / 1000000).toFixed(2) + " MB";
  }
  if (input >= 1000) {
    return (input / 1000).toFixed(0) + " KB";
  }
  return input + " B";
}

export const colorMappings: StringDict = {
  red: "B03060",
  orange: "FE9A76",
  yellow: "FFD700",
  olive: "32CD32",
  green: "016936",
  teal: "008080",
  blue: "0E6EB8",
  violet: "EE82EE",
  purple: "B413EC",
  pink: "FF1493",
  brown: "A52A2A",
  grey: "A0A0A0",
};

export const softWhite = "var(--text-primary)";

let colorCache: NumberDict = {};
export function getColorForString(id: string) {
  let colors = Object.keys(colorMappings);
  if (colorCache[id]) {
    return colors[colorCache[id]];
  }
  colorCache[id] = Math.abs(cyrb53(id)) % colors.length;
  return colors[colorCache[id]];
}

export function getColorForStringHex(id: string) {
  return colorMappings[getColorForString(id)];
}


export const YOUTUBE_VIDEO_ID_REGEX =
  /(?:(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts|live)\/|\S*?[?&]v=)|youtu\.be\/))([a-zA-Z0-9_-]{11})/i;

export const getYoutubeVideoID = (url: string): string | undefined => {
  if (!url || typeof url !== "string") {
    return undefined;
  }
  const trimmed = url.trim();
  const idParts = YOUTUBE_VIDEO_ID_REGEX.exec(trimmed);
  if (idParts && idParts[1]) {
    return idParts[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
};

export const normalizeYouTubeUrl = (url: string): string => {
  const id = getYoutubeVideoID(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
};

export const isYouTube = (input: string): boolean => {
  if (!input || typeof input !== "string") {
    return false;
  }
  return Boolean(getYoutubeVideoID(input));
};

export const isHttp = (input: string) => {
  return input.startsWith("http");
};

export const isMagnet = (input: string) => {
  return input.startsWith("magnet:");
};

export const isHls = (input: string) => {
  return input.includes(".m3u8");
};

export const isDash = (input: string) => {
  return input.includes(".mpd");
};

export const isMpegTs = (input: string) => {
  return input.includes(".mpegts");
};

export const isScreenShare = (input: string) => {
  return input.startsWith("screenshare://");
};

export const isFileShare = (input: string) => {
  return input.startsWith("fileshare://");
};

export const isVBrowser = (input: string) => {
  return input.startsWith("vbrowser://");
};

export async function testAutoplay() {
  const result = await canAutoplay.video();
  return result.result;
}

export function decodeEntities(input: string) {
  const doc = new DOMParser().parseFromString(input, "text/html");
  return doc.documentElement.textContent;
}

export const debounce = (callback: Function, wait = 500) => {
  let timeoutId: any = null;
  return (...args: any[]) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, wait);
  };
};

export const getDefaultPicture = (name: string, background = "a0a0a0") => {
  const safeName = encodeURIComponent((name || "User").trim());
  const cleanBg = (background || "a0a0a0").replace("#", "");
  return `https://ui-avatars.com/api/?name=${safeName}&background=${cleanBg}&size=256&color=ffffff`;
};

export const isMobile = () => {
  if (typeof window === "undefined") return false;
  return (
    window.innerWidth <= 768 ||
    window.screen.width <= 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
  );
};

export function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

export const iceServers = () => [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:5.161.207.54:3478",
    username: "username",
    credential: "password",
  },
  {
    urls: "turn:5.161.49.183:3478",
    username: "username",
    credential: "password",
  },
  {
    urls: "turn:135.181.147.65:3478",
    username: "username",
    credential: "password",
  },
  {
    urls: "turn:5.78.83.26:3478",
    username: "username",
    credential: "password",
  },
  {
    urls: "turn:5.223.48.157:3478",
    username: "username",
    credential: "password",
  },
];

export const serverCandidates: string[] = (() => {
  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (isLocalhost) {
      return [`${window.location.protocol}//${window.location.hostname}:8080`];
    }
  }
  if (config.VITE_SERVER_HOST) {
    return String(config.VITE_SERVER_HOST)
      .split(",")
      .map((s: string) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return [window.location.origin];
  }
  return [];
})();

const getInitialServerPath = (): string => {
  if (typeof window !== "undefined") {
    try {
      const cached = sessionStorage.getItem("cowatch_active_backend");
      if (cached && serverCandidates.includes(cached)) {
        return cached;
      }
    } catch (_) {}
  }
  return (
    serverCandidates[0] ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:8080")
  );
};

export let serverPath: string = getInitialServerPath();

export function setServerPath(newPath: string): void {
  serverPath = newPath.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem("cowatch_active_backend", serverPath);
    } catch (_) {}
  }
}

export async function resolveFastestServer(): Promise<string> {
  if (serverCandidates.length <= 1) {
    return serverPath;
  }
  try {
    const fastest = await Promise.any(
      serverCandidates.map(async (candidate) => {
        const res = await fetch(`${candidate}/ping`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`Ping failed for ${candidate}`);
        return candidate;
      })
    );
    if (fastest && fastest !== serverPath) {
      setServerPath(fastest);
      console.log(`Active backend switched to fastest server: ${fastest}`);
    }
    return fastest;
  } catch (e) {
    return serverPath;
  }
}

// Automatically race and connect to the fastest available backend
if (typeof window !== "undefined" && serverCandidates.length > 1) {
  resolveFastestServer().catch(() => {});
}

export function getRoomUrl(roomId: string): string {
  const cleanId = roomId.replace(/^\//, '');
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return origin ? `${origin}/join/${cleanId}` : `/join/${cleanId}`;
}

export function getInviteMessage(roomId: string, passcode?: string): string {
  const cleanId = roomId.replace(/^\//, '');
  const url = getRoomUrl(roomId);
  if (passcode) {
    return `Hey! Join my watch party on CoWatch:\n\nLink: ${url}\nRoom ID: ${cleanId}\nPasscode: ${passcode}`;
  }
  return `Hey! Join my watch party on CoWatch:\n\nLink: ${url}\nRoom ID: ${cleanId}\nPasscode: [Passcode Required - Ask Host]`;
}

/**
 * Parses user input into a canonical room ID / slug.
 * Supports:
 * - abc123
 * - /abc123
 * - https://<host>/join/abc123
 * - https://<host>/join/abc123/...
 * - https://<host>/watch/abc123
 * - /join/abc123
 * - /watch/abc123
 * Rejects unrelated URLs and malformed inputs.
 */
export function parseRoomInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Handle absolute URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      const pathname = parsed.pathname;

      if (pathname.includes("/join/")) {
        const afterJoin = pathname.split("/join/")[1] || "";
        const segment = afterJoin.split("/")[0]?.split("?")[0];
        return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
      }

      if (pathname.includes("/watch/")) {
        const afterWatch = pathname.split("/watch/")[1] || "";
        const segment = afterWatch.split("/")[0]?.split("?")[0];
        return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  // Handle path-based inputs
  if (trimmed.startsWith("/join/")) {
    const segment = trimmed.slice(6).split("/")[0]?.split("?")[0];
    return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
  }

  if (trimmed.startsWith("/watch/")) {
    const segment = trimmed.slice(7).split("/")[0]?.split("?")[0];
    return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
  }

  if (trimmed.startsWith("/")) {
    const segment = trimmed.slice(1).split("/")[0]?.split("?")[0];
    return segment && /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : null;
  }

  // Handle plain room code or slug
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function getMediaPathResults(
  mediaPath: string,
  query: string,
): Promise<SearchResult[]> {
  let results: SearchResult[] = [];
  // if (mediaPath.includes('s3.')) {
  //   const response = await fetch(mediaPath);
  //   // S3-style buckets return data in XML
  //   const xml = await response.text();
  //   const parser = new XMLParser();
  //   const data = parser.parse(xml);
  //   let filtered = data.ListBucketResult.Contents.filter(
  //     // Exclude subdirectories
  //     (file: any) => !file.Key.includes('/'),
  //   );
  //   results = filtered.map((file: any) => ({
  //     url: mediaPath + '/' + file.Key,
  //     name: mediaPath + '/' + file.Key,
  //   }));
  // } else
  const playlistMatch = /(?:youtube\.com\/playlist\?list=)([a-zA-Z0-9_-]+)/i.exec(mediaPath);
  if (playlistMatch) {
    // https://www.youtube.com/playlist?list=<playlist ID>
    const playlistID = playlistMatch[1];
    try {
      const response = await fetch(serverPath + "/youtubePlaylist/" + playlistID);
      if (response.ok) {
        const json = await response.json();
        if (Array.isArray(json)) {
          results = json;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch YouTube playlist:", e);
    }
  } else {
    // Assume it's a text list of URLs
    const response = await fetch(mediaPath);
    const text = await response.text();
    results = text
      .split("\n")
      .map((line) => ({ url: line, name: line, duration: 0, type: "file" }));
  }
  return results.filter((res) => res.url);
}

export async function getStreamPathResults(
  streamPath: string,
  query: string,
): Promise<SearchResult[]> {
  const response = await fetch(
    streamPath + `/${query ? "search" : "top"}?q=` + encodeURIComponent(query),
  );
  const data = await response.json();
  return data.map((d: any, i: number) => ({
    ...d,
    url: d.magnet ?? String(i),
  }));
}

export async function getYouTubeResults(
  query: string,
): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      serverPath + "/youtube?q=" + encodeURIComponent(query),
    );
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map((d: any) => ({ ...d, type: "youtube" }));
  } catch (err) {
    console.warn("Failed to fetch YouTube results:", err);
    return [];
  }
}

export async function openFileSelector(accept?: string) {
  return new Promise<FileList | null>((resolve) => {
    // Create an input element
    const inputElement = document.createElement("input");

    // Set its type to file
    inputElement.type = "file";

    // Set accept to the file types you want the user to select.
    // Include both the file extension and the mime type
    if (accept) {
      inputElement.accept = accept;
    }

    // set onchange event to call callback when user has selected file
    inputElement.addEventListener("change", () => {
      resolve(inputElement.files);
    });

    // dispatch a click event to open the file dialog
    inputElement.dispatchEvent(new MouseEvent("click"));
  });
}

export function getOrCreateClientId() {
  let clientId = window.localStorage.getItem("cowatch-clientid");
  if (!clientId) {
    // Generate a new clientID and save it
    // This requires https, so fallback to JS implementation if needed
    clientId = createUuid();
    window.localStorage.setItem("cowatch-clientid", clientId);
  }
  return clientId;
}

export function getOrCreateSessionId() {
  let sessionId = window.localStorage.getItem("cowatch-sessionid");
  if (!sessionId) {
    // Generate a new sessionID and save it
    // This requires https, so fallback to JS implementation if needed
    sessionId = createUuid();
    window.localStorage.setItem("cowatch-sessionid", sessionId);
  }
  return sessionId;
}

// Passcodes must NEVER be stored locally. Purge any legacy stored passcodes on module load.
if (typeof window !== "undefined" && window.localStorage) {
  try {
    window.localStorage.removeItem("cowatch-passcodes");
  } catch (e) {}
}

export function addAndSavePasscode(_roomId: string, _passcode: string) {
  // Passcodes must NEVER be stored locally in localStorage or IndexedDB
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem("cowatch-passcodes");
    } catch (e) {}
  }
}

export function removeSavedPasscode(_roomId: string) {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem("cowatch-passcodes");
    } catch (e) {}
  }
}

export function getSavedPasscodes(): Record<string, string> {
  // Always return empty and ensure local storage is clean
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem("cowatch-passcodes");
    } catch (e) {}
  }
  return {};
}

export function createUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : uuidv4();
}

export function calculateMedian(array: number[]): number {
  // Check If Data Exists
  if (array.length >= 1) {
    // Sort Array
    array = array.sort((a: number, b: number) => {
      return a - b;
    });

    // Array Length: Even
    if (array.length % 2 === 0) {
      // Average Of Two Middle Numbers
      return (array[array.length / 2 - 1] + array[array.length / 2]) / 2;
    }
    // Array Length: Odd
    else {
      // Middle Number
      return array[(array.length - 1) / 2];
    }
  }
  return 0;
}

type ResolvedProfile = {
  displayName: string;
  avatarUrl: string | null;
};

export const resolveProfile = (
  profile: any | null,
  user: User
): ResolvedProfile => ({
  displayName:
    profile?.display_name?.trim() ||
    user.user_metadata?.display_name?.trim() ||
    user.user_metadata?.full_name?.trim() ||
    user.user_metadata?.name?.trim() ||
    profile?.username?.trim() ||
    user.user_metadata?.username?.trim() ||
    user.email?.split("@")[0] ||
    "Guest",

  avatarUrl:
    profile?.avatar_url ||
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null,
});
export const autoCreateUsername = (
  name?: string | null,
  email?: string | null,
  suffix?: number
): string => {
  const normalized = (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const emailPrefix = email
    ? email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    : "";

  const base = normalized || emailPrefix || "user";
  const num = suffix ?? Math.floor(1000 + Math.random() * 9000);
  return `${base.slice(0, 18)}_${num}`;
};

export const getFileName = (input: string) => {
  return input.split("/").slice(-1)[0];
};

export const isEmojiString = (input?: string): boolean => {
  return /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])+$/g.test(
    input ?? "",
  );
};

function uuidv4() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16),
  );
}

// Subtract header, URL row, button row, 3 gaps, controls
export const VIDEO_MAX_HEIGHT_CSS =
  "calc(100vh - 64px - 36px - 36px - 4px - 4px - 4px - 32px)";
