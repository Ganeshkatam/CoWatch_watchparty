export type VBrowserReservationStatus =
  | "RESERVED"
  | "ALLOCATED"
  | "RELEASING"
  | "RELEASED"
  | "FAILED"
  | "EXPIRED";

export interface VBrowserReservationRecord {
  id: string;
  provider_id: string;
  pool_id: string;
  room_id: string;
  user_id: string;
  is_large: boolean;
  status: VBrowserReservationStatus;
  operation_id: string;
  vmid?: string | null;
  assigned_at?: Date | string;
  heartbeat_at?: Date | string;
  expires_at: Date | string;
  released_at?: Date | string | null;
  failure_reason?: string | null;
  created_at?: Date | string;
}

export interface VBrowserActor {
  uid?: string;
  clientId?: string;
  isOwner?: boolean;
}

export interface VBrowserReservationOptions {
  poolId?: string;
  providerId?: string;
  isLarge?: boolean;
  timeoutMs?: number;
}

export interface AssignedVMResult {
  id: string;
  url?: string;
  ip?: string;
  port?: number;
}

export interface IVBrowserProviderAdapter {
  assign(options: {
    roomId: string;
    uid?: string;
    isLarge?: boolean;
    reservationId: string;
    poolId?: string;
  }): Promise<AssignedVMResult | null>;

  release(options: {
    id: string;
    roomId?: string;
    provider?: string;
  }): Promise<void>;

  listActiveContainers?(): Promise<Array<{
    id: string;
    roomId?: string;
    reservationId?: string;
    state?: string;
  }>>;
}

export type VBrowserErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_ACTIVE"
  | "ROOM_INACTIVE"
  | "ROOM_ENDED"
  | "ROOM_EXPIRED"
  | "ROOM_BUSY"
  | "PERMISSION_DENIED"
  | "POOL_EXHAUSTED"
  | "PROVIDER_UNAVAILABLE"
  | "ASSIGNMENT_TIMEOUT"
  | "DB_UNAVAILABLE"
  | "CROSS_ROOM_MISMATCH"
  | "INVALID_OPERATION";

export interface VBrowserReservationResult {
  success: boolean;
  reservation?: VBrowserReservationRecord;
  errorCode?: VBrowserErrorCode;
  userMessage?: string;
  error?: string;
}

export const CANONICAL_USER_MESSAGES: Record<VBrowserErrorCode, string> = {
  ROOM_NOT_FOUND: "The requested room does not exist.",
  ROOM_NOT_ACTIVE: "Virtual browser cannot be started because the room is not active.",
  ROOM_INACTIVE: "Virtual browser cannot be started because the room is currently inactive.",
  ROOM_ENDED: "Virtual browser cannot be started because the room has ended.",
  ROOM_EXPIRED: "Virtual browser cannot be started because the room has expired.",
  ROOM_BUSY: "A virtual browser session is already active or being prepared for this room.",
  PERMISSION_DENIED: "You do not have permission to control or launch the virtual browser in this room.",
  POOL_EXHAUSTED: "Virtual browser resources are currently at capacity. Please try again shortly.",
  PROVIDER_UNAVAILABLE: "Virtual browser service is temporarily unavailable. Please try again later.",
  ASSIGNMENT_TIMEOUT: "Virtual browser allocation timed out. Please try again.",
  DB_UNAVAILABLE: "Database service is temporarily unavailable.",
  CROSS_ROOM_MISMATCH: "Reservation does not match the target room.",
  INVALID_OPERATION: "Invalid operation on virtual browser reservation.",
};

export const DEFAULT_VBROWSER_LEASE_SECONDS = 3 * 60 * 60; // 3 hours
export const DEFAULT_RESERVATION_EXPIRY_SECONDS = 60; // 60 seconds for unallocated RESERVED records
