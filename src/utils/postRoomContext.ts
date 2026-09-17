/**
 * Post-Room User Experience Subsystem - Context & Presentation State.
 *
 * CRITICAL ARCHITECTURAL BOUNDARY:
 * Post-room context is PRESENTATION STATE, NOT AUTHORIZATION STATE.
 * isHost, isPermanent, roomTitle, participantCount, etc. determine what the
 * completion screen displays, but NEVER grant access or bypass authorization.
 * Any re-entry attempts go strictly back through the authoritative admission gateway.
 *
 * Session telemetry (durationSeconds, participantCount, mediaTitle) is client-observed
 * snapshot data for the completion screen, NOT authoritative server state.
 */

export type PostRoomExitReason =
  | "voluntary_leave"
  | "host_ended_temporary"
  | "host_stopped_permanent"
  | "kicked"
  | "unavailable"
  | "connection_lost";

export interface PostRoomContext {
  reason: PostRoomExitReason;
  roomId?: string;
  roomTitle?: string;
  isPermanent?: boolean;
  isHost?: boolean;
  /** Client-observed session telemetry (snapshot for presentation) */
  durationSeconds?: number;
  participantCount?: number;
  mediaTitle?: string;
}

export interface PostRoomAction {
  label: string;
  to: string;
  variant: "filled" | "default" | "subtle";
  color?: string;
}

export interface PostRoomPresentation {
  badge: string;
  badgeColor: string;
  heading: string;
  roomTitle: string;
  message: string;
  subMessage?: string;
  footnote?: string;
  primaryAction: PostRoomAction;
  secondaryAction?: PostRoomAction;
  hasSummary: boolean;
  formattedDuration: string;
  participantCountDisplay: string;
  mediaTitleDisplay: string;
  isReusable: boolean;
}

const STORAGE_KEY = "cowatch:post_room_context";

/**
 * Format duration in seconds into clean, human-readable text.
 * e.g., "< 1m", "25m", "1h 42m".
 */
export function formatDuration(seconds?: number): string {
  if (typeof seconds !== "number" || isNaN(seconds) || seconds <= 0) {
    return "< 1m";
  }
  const cleanSeconds = Math.floor(seconds);
  if (cleanSeconds < 60) {
    return "< 1m";
  }
  const minutes = Math.floor(cleanSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Persist post-room context to sessionStorage so it survives reloads on /room-ended.
 */
export function savePostRoomContext(context: PostRoomContext): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    }
  } catch (err) {
    console.warn("Unable to persist post-room context to sessionStorage:", err);
  }
}

/**
 * Retrieve post-room context, preferring React Router location state,
 * then sessionStorage fallback, or defaulting to a neutral voluntary leave state.
 */
export function getPostRoomContext(locationState?: any): PostRoomContext {
  // 1. Direct router state (cleanest same-navigation path)
  if (locationState && typeof locationState === "object" && typeof locationState.reason === "string") {
    return sanitizeContext(locationState);
  }

  // 2. Fallback to sessionStorage (protects against page refresh or redirect navigation)
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed.reason === "string") {
          return sanitizeContext(parsed);
        }
      }
    }
  } catch (err) {
    console.warn("Unable to read post-room context from sessionStorage:", err);
  }

  // 3. Graceful fallback
  return {
    reason: "voluntary_leave",
    isPermanent: false,
    isHost: false,
  };
}

/**
 * Clear stored post-room context.
 */
export function clearPostRoomContext(): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.warn("Unable to clear post-room context from sessionStorage:", err);
  }
}

/**
 * Sanitize untrusted context objects to ensure strictly known properties.
 */
function sanitizeContext(input: any): PostRoomContext {
  const validReasons: PostRoomExitReason[] = [
    "voluntary_leave",
    "host_ended_temporary",
    "host_stopped_permanent",
    "kicked",
    "unavailable",
    "connection_lost",
  ];

  const reason: PostRoomExitReason = validReasons.includes(input.reason)
    ? input.reason
    : "voluntary_leave";

  return {
    reason,
    roomId: typeof input.roomId === "string" ? input.roomId.trim() : undefined,
    roomTitle: typeof input.roomTitle === "string" ? input.roomTitle.trim() : undefined,
    isPermanent: Boolean(input.isPermanent),
    isHost: Boolean(input.isHost),
    durationSeconds: typeof input.durationSeconds === "number" && !isNaN(input.durationSeconds) ? input.durationSeconds : undefined,
    participantCount: typeof input.participantCount === "number" && !isNaN(input.participantCount) ? input.participantCount : undefined,
    mediaTitle: typeof input.mediaTitle === "string" ? input.mediaTitle.trim() : undefined,
  };
}

/**
 * Pure presentation matrix builder.
 * Maps the 6 exit reasons and room lifecycle states to clean, contextual UI copy and actions.
 */
export function getPostRoomPresentation(context: PostRoomContext): PostRoomPresentation {
  const {
    reason,
    roomId,
    roomTitle = "Watch Party",
    isPermanent = false,
    isHost = false,
    durationSeconds,
    participantCount,
    mediaTitle,
  } = context;

  const returnUrl = roomId ? `/watch/${encodeURIComponent(roomId)}` : "/";
  const hasSummary = Boolean(durationSeconds !== undefined || participantCount !== undefined || mediaTitle);
  const formattedDuration = formatDuration(durationSeconds);
  const participantCountDisplay = participantCount !== undefined && participantCount > 0 ? String(participantCount) : "1";
  const mediaTitleDisplay = mediaTitle && mediaTitle.trim() ? mediaTitle.trim() : "None";

  // Scenario 1: Participant or Host Voluntarily Leaves
  if (reason === "voluntary_leave") {
    if (isPermanent) {
      return {
        badge: "Saved Room",
        badgeColor: "teal",
        heading: "You left the room",
        roomTitle,
        message: "This room is still available.",
        footnote: "Room saved. You can rejoin or start another session whenever you are ready.",
        primaryAction: {
          label: "Return to Room",
          to: returnUrl,
          variant: "filled",
          color: "violet",
        },
        secondaryAction: {
          label: "Back to Home",
          to: "/",
          variant: "default",
        },
        hasSummary,
        formattedDuration,
        participantCountDisplay,
        mediaTitleDisplay,
        isReusable: true,
      };
    }

    // Temporary room voluntary leave
    const countNote = participantCount && participantCount > 1
      ? `You watched with ${participantCount} people.`
      : "You left this watch party session.";

    return {
      badge: "Watch Party",
      badgeColor: "violet",
      heading: "You left the watch party",
      roomTitle,
      message: countNote,
      primaryAction: {
        label: "Back to Home",
        to: "/",
        variant: "filled",
        color: "violet",
      },
      secondaryAction: {
        label: "Join Another Room",
        to: "/join",
        variant: "default",
      },
      hasSummary,
      formattedDuration,
      participantCountDisplay,
      mediaTitleDisplay,
      isReusable: false,
    };
  }

  // Scenario 2: Host Stops Permanent Room
  if (reason === "host_stopped_permanent") {
    if (isHost) {
      return {
        badge: "Saved Room • Inactive",
        badgeColor: "blue",
        heading: "Session ended",
        roomTitle,
        message: `${roomTitle} is now inactive.`,
        subMessage: "Your room, settings and invitation remain available.",
        footnote: "Room saved. You can start another session whenever you are ready.",
        primaryAction: {
          label: "Open Room",
          to: returnUrl,
          variant: "filled",
          color: "violet",
        },
        secondaryAction: {
          label: "Back to Home",
          to: "/",
          variant: "default",
        },
        hasSummary,
        formattedDuration,
        participantCountDisplay,
        mediaTitleDisplay,
        isReusable: true,
      };
    }

    // Participant view of stopped permanent room
    return {
      badge: "Saved Room • Inactive",
      badgeColor: "blue",
      heading: "Session ended",
      roomTitle,
      message: "This watch session has ended.",
      subMessage: "The room is still saved and can be used again later.",
      footnote: "Room saved. You can return to the room lobby whenever you are ready.",
      primaryAction: {
        label: "Return to Room",
        to: returnUrl,
        variant: "filled",
        color: "violet",
      },
      secondaryAction: {
        label: "Back to Home",
        to: "/",
        variant: "default",
      },
      hasSummary,
      formattedDuration,
      participantCountDisplay,
      mediaTitleDisplay,
      isReusable: true,
    };
  }

  // Scenario 3: Host Ends Temporary Room (Terminal)
  if (reason === "host_ended_temporary") {
    if (isHost) {
      return {
        badge: "Session Ended",
        badgeColor: "orange",
        heading: "Session ended",
        roomTitle,
        message: `${roomTitle} has ended and can no longer be joined.`,
        primaryAction: {
          label: "Back to Home",
          to: "/",
          variant: "filled",
          color: "violet",
        },
        secondaryAction: {
          label: "Create Room",
          to: "/create",
          variant: "default",
        },
        hasSummary,
        formattedDuration,
        participantCountDisplay,
        mediaTitleDisplay,
        isReusable: false,
      };
    }

    // Participant view of ended temporary room
    return {
      badge: "Session Ended",
      badgeColor: "orange",
      heading: "Session ended",
      roomTitle,
      message: "The host has ended this watch party.",
      subMessage: "This room is no longer available.",
      primaryAction: {
        label: "Back to Home",
        to: "/",
        variant: "filled",
        color: "violet",
      },
      secondaryAction: {
        label: "Join Another Room",
        to: "/join",
        variant: "default",
      },
      hasSummary,
      formattedDuration,
      participantCountDisplay,
      mediaTitleDisplay,
      isReusable: false,
    };
  }

  // Scenario 4: Host Kicks Participant
  if (reason === "kicked") {
    return {
      badge: "Removed",
      badgeColor: "red",
      heading: "You were removed from this room",
      roomTitle,
      message: "The host has removed you from this watch session.",
      primaryAction: {
        label: "Back to Home",
        to: "/",
        variant: "filled",
        color: "violet",
      },
      secondaryAction: {
        label: "Join Another Room",
        to: "/join",
        variant: "default",
      },
      hasSummary: false,
      formattedDuration,
      participantCountDisplay,
      mediaTitleDisplay,
      isReusable: false,
    };
  }

  // Scenario 5: Room Unavailable / Expired
  if (reason === "unavailable") {
    return {
      badge: "Unavailable",
      badgeColor: "gray",
      heading: "Room is no longer available",
      roomTitle,
      message: "This room has expired or ended.",
      primaryAction: {
        label: "Back to Home",
        to: "/",
        variant: "filled",
        color: "violet",
      },
      secondaryAction: {
        label: "Join Another Room",
        to: "/join",
        variant: "default",
      },
      hasSummary: false,
      formattedDuration,
      participantCountDisplay,
      mediaTitleDisplay,
      isReusable: false,
    };
  }

  // Scenario 6: Connection Lost
  // reason === "connection_lost"
  return {
    badge: "Connection Interrupted",
    badgeColor: "orange",
    heading: "Connection to the room was lost",
    roomTitle,
    message: "Your connection to this room was interrupted.",
    subMessage: "You can try reconnecting to the room or return home.",
    primaryAction: {
      label: roomId ? "Reconnect" : "Back to Home",
      to: returnUrl,
      variant: "filled",
      color: "violet",
    },
    secondaryAction: {
      label: "Back to Home",
      to: "/",
      variant: "default",
    },
    hasSummary,
    formattedDuration,
    participantCountDisplay,
    mediaTitleDisplay,
    isReusable: isPermanent,
  };
}
