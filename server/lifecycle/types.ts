import type { TimelineSnapshot } from "../timelineAuthority.ts";

export type RoomLifecycleStatus = "scheduled" | "active" | "inactive" | "ended" | "expired";

export const CURRENT_SCHEMA_VERSION = 1;
export const DEFAULT_LEASE_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours
export const MAX_LIFECYCLE_CEILING_MS = 7 * 24 * 60 * 60 * 1000; // 7 days hard maximum for ephemeral rooms
export const IDLE_EVACUATION_EPHEMERAL_MS = 15 * 60 * 1000; // 15 mins
export const IDLE_EVACUATION_PERMANENT_MS = 5 * 60 * 1000; // 5 mins

export interface RoomSettingsSnapshot {
  isChatDisabled?: boolean;
  participantsLocked?: boolean;
  maxParticipants?: number;
  roomTitle?: string;
  roomDescription?: string;
  mediaPath?: string;
  coverPhoto?: string;
}

export interface RoomLocksSnapshot {
  lock?: string;
  participantsLocked?: boolean;
}

export interface RoomSnapshot {
  schemaVersion: number;
  lifecycleRevision: number;
  timeline: TimelineSnapshot;
  settings: RoomSettingsSnapshot;
  locks: RoomLocksSnapshot;
  playlist?: any[];
  nameMap?: Record<string, string>;
  pictureMap?: Record<string, string>;
  subtitle?: string;
  loop?: boolean;
  video?: string;
  videoTS?: number;
  paused?: boolean;
  playbackRate?: number;
}

export interface AdmissionActor {
  clientId: string;
  uid?: string;
  sessionId?: string;
  isOwner?: boolean;
  isReconnecting?: boolean;
  passcode?: string;
}

export interface AdmissionResult {
  allowed: boolean;
  status: RoomLifecycleStatus;
  reason?: "ROOM_NOT_FOUND" | "ROOM_EXPIRED" | "ROOM_ENDED" | "ROOM_SCHEDULED_NOT_STARTED" | "ROOM_INACTIVE" | "INVALID_PASSCODE" | "BANNED" | "ROOM_FULL" | "DB_UNAVAILABLE";
  isColdStart?: boolean;
  roomRow?: any;
  error?: string;
}
