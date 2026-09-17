import assert from "node:assert";
import {
  formatDuration,
  getPostRoomContext,
  getPostRoomPresentation,
  PostRoomContext,
  savePostRoomContext,
  clearPostRoomContext,
} from "./postRoomContext";

console.log("Running postRoomContext test suite...");

// Test 1: Duration formatting
{
  assert.strictEqual(formatDuration(undefined), "< 1m");
  assert.strictEqual(formatDuration(0), "< 1m");
  assert.strictEqual(formatDuration(-10), "< 1m");
  assert.strictEqual(formatDuration(45), "< 1m");
  assert.strictEqual(formatDuration(60), "1m");
  assert.strictEqual(formatDuration(150), "2m");
  assert.strictEqual(formatDuration(3600), "1h");
  assert.strictEqual(formatDuration(6120), "1h 42m"); // 102 minutes = 1h 42m
  assert.strictEqual(formatDuration(7200), "2h");
  assert.strictEqual(formatDuration(7260), "2h 1m");
}

// Test 2: Matrix - Voluntary Leave (Permanent Room)
{
  const ctx: PostRoomContext = {
    reason: "voluntary_leave",
    roomId: "movie-night",
    roomTitle: "Movie Night",
    isPermanent: true,
    isHost: false,
    durationSeconds: 6120,
    participantCount: 5,
    mediaTitle: "Interstellar",
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "You left the room");
  assert.strictEqual(pres.roomTitle, "Movie Night");
  assert.strictEqual(pres.message, "This room is still available.");
  assert.strictEqual(pres.badge, "Saved Room");
  assert.strictEqual(pres.primaryAction.label, "Return to Room");
  assert.strictEqual(pres.primaryAction.to, "/watch/movie-night");
  assert.strictEqual(pres.secondaryAction?.label, "Back to Home");
  assert.strictEqual(pres.secondaryAction?.to, "/");
  assert.strictEqual(pres.isReusable, true);
  assert.strictEqual(pres.hasSummary, true);
  assert.strictEqual(pres.formattedDuration, "1h 42m");
  assert.strictEqual(pres.participantCountDisplay, "5");
  assert.strictEqual(pres.mediaTitleDisplay, "Interstellar");
}

// Test 3: Matrix - Voluntary Leave (Temporary Room)
{
  const ctx: PostRoomContext = {
    reason: "voluntary_leave",
    roomId: "temp-watch-123",
    roomTitle: "Friday Popcorn",
    isPermanent: false,
    isHost: false,
    durationSeconds: 1800,
    participantCount: 4,
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "You left the watch party");
  assert.strictEqual(pres.message, "You watched with 4 people.");
  assert.strictEqual(pres.primaryAction.label, "Back to Home");
  assert.strictEqual(pres.primaryAction.to, "/");
  assert.strictEqual(pres.secondaryAction?.label, "Join Another Room");
  assert.strictEqual(pres.secondaryAction?.to, "/join");
  assert.strictEqual(pres.isReusable, false);
}

// Test 4: Matrix - Host Stops Permanent Room (Host View)
{
  const ctx: PostRoomContext = {
    reason: "host_stopped_permanent",
    roomId: "perm-lounge",
    roomTitle: "Late Lounge",
    isPermanent: true,
    isHost: true,
    durationSeconds: 3600,
    participantCount: 6,
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "Session ended");
  assert.strictEqual(pres.message, "Late Lounge is now inactive.");
  assert.strictEqual(pres.subMessage, "Your room, settings and invitation remain available.");
  assert.strictEqual(pres.primaryAction.label, "Open Room");
  assert.strictEqual(pres.primaryAction.to, "/watch/perm-lounge");
  assert.strictEqual(pres.secondaryAction?.label, "Back to Home");
  assert.strictEqual(pres.secondaryAction?.to, "/");
  assert.strictEqual(pres.isReusable, true);
}

// Test 5: Matrix - Host Stops Permanent Room (Participant View)
{
  const ctx: PostRoomContext = {
    reason: "host_stopped_permanent",
    roomId: "perm-lounge",
    roomTitle: "Late Lounge",
    isPermanent: true,
    isHost: false,
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "Session ended");
  assert.strictEqual(pres.message, "This watch session has ended.");
  assert.strictEqual(pres.subMessage, "The room is still saved and can be used again later.");
  assert.strictEqual(pres.primaryAction.label, "Return to Room");
  assert.strictEqual(pres.primaryAction.to, "/watch/perm-lounge");
  assert.strictEqual(pres.isReusable, true);
}

// Test 6: Matrix - Host Ends Temporary Room (Host View)
{
  const ctx: PostRoomContext = {
    reason: "host_ended_temporary",
    roomId: "temp-session",
    roomTitle: "Weekend Marathon",
    isPermanent: false,
    isHost: true,
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "Session ended");
  assert.strictEqual(pres.message, "Weekend Marathon has ended and can no longer be joined.");
  assert.strictEqual(pres.primaryAction.label, "Back to Home");
  assert.strictEqual(pres.secondaryAction?.label, "Create Room");
  assert.strictEqual(pres.secondaryAction?.to, "/create");
  assert.strictEqual(pres.isReusable, false);
}

// Test 7: Matrix - Host Ends Temporary Room (Participant View)
{
  const ctx: PostRoomContext = {
    reason: "host_ended_temporary",
    roomId: "temp-session",
    roomTitle: "Weekend Marathon",
    isPermanent: false,
    isHost: false,
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "Session ended");
  assert.strictEqual(pres.message, "The host has ended this watch party.");
  assert.strictEqual(pres.subMessage, "This room is no longer available.");
  assert.strictEqual(pres.primaryAction.label, "Back to Home");
  assert.strictEqual(pres.secondaryAction?.label, "Join Another Room");
  assert.strictEqual(pres.secondaryAction?.to, "/join");
  assert.strictEqual(pres.isReusable, false);
}

// Test 8: Matrix - Participant Kicked
{
  const ctx: PostRoomContext = {
    reason: "kicked",
    roomId: "gaming-hub",
    roomTitle: "Gaming Hub",
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "You were removed from this room");
  assert.strictEqual(pres.message, "The host has removed you from this watch session.");
  assert.strictEqual(pres.primaryAction.label, "Back to Home");
  assert.strictEqual(pres.secondaryAction?.label, "Join Another Room");
  assert.strictEqual(pres.isReusable, false);
}

// Test 9: Matrix - Room Unavailable
{
  const ctx: PostRoomContext = {
    reason: "unavailable",
    roomId: "expired-room",
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "Room is no longer available");
  assert.strictEqual(pres.message, "This room has expired or ended.");
  assert.strictEqual(pres.primaryAction.label, "Back to Home");
}

// Test 10: Matrix - Connection Lost
{
  const ctx: PostRoomContext = {
    reason: "connection_lost",
    roomId: "reconnect-room",
    isPermanent: true,
  };
  const pres = getPostRoomPresentation(ctx);

  assert.strictEqual(pres.heading, "Connection to the room was lost");
  assert.strictEqual(pres.message, "Your connection to this room was interrupted.");
  assert.strictEqual(pres.primaryAction.label, "Reconnect");
  assert.strictEqual(pres.primaryAction.to, "/watch/reconnect-room");
  assert.strictEqual(pres.secondaryAction?.label, "Back to Home");
}

// Test 11: Mocked Storage Serialization and Fallback
{
  const storageMock: Record<string, string> = {};
  (global as any).window = {
    sessionStorage: {
      setItem: (k: string, v: string) => { storageMock[k] = v; },
      getItem: (k: string) => storageMock[k] || null,
      removeItem: (k: string) => { delete storageMock[k]; },
    },
  };

  const sample: PostRoomContext = {
    reason: "voluntary_leave",
    roomId: "storage-test",
    roomTitle: "Storage Test Room",
    isPermanent: true,
    durationSeconds: 120,
    participantCount: 3,
    mediaTitle: "Sample Video",
  };

  savePostRoomContext(sample);
  assert.strictEqual(Boolean(storageMock["cowatch:post_room_context"]), true);

  // Read via sessionStorage fallback when location state is absent
  const fromStorage = getPostRoomContext(undefined);
  assert.strictEqual(fromStorage.roomId, "storage-test");
  assert.strictEqual(fromStorage.roomTitle, "Storage Test Room");
  assert.strictEqual(fromStorage.reason, "voluntary_leave");
  assert.strictEqual(fromStorage.durationSeconds, 120);

  // Clear storage
  clearPostRoomContext();
  assert.strictEqual(storageMock["cowatch:post_room_context"], undefined);

  // Fallback to default
  const fallback = getPostRoomContext(undefined);
  assert.strictEqual(fallback.reason, "voluntary_leave");
  assert.strictEqual(fallback.isPermanent, false);

  delete (global as any).window;
}

// Test 12: Zero Emojis Rule Enforcement
{
  const allReasons: PostRoomContext["reason"][] = [
    "voluntary_leave",
    "host_ended_temporary",
    "host_stopped_permanent",
    "kicked",
    "unavailable",
    "connection_lost",
  ];

  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  for (const r of allReasons) {
    for (const isPermanent of [true, false]) {
      for (const isHost of [true, false]) {
        const pres = getPostRoomPresentation({
          reason: r,
          roomId: "test",
          roomTitle: "Test Room",
          isPermanent,
          isHost,
          durationSeconds: 300,
          participantCount: 2,
          mediaTitle: "Test Video",
        });

        const combinedText = `${pres.badge} ${pres.heading} ${pres.message} ${pres.subMessage || ""} ${pres.footnote || ""} ${pres.primaryAction.label} ${pres.secondaryAction?.label || ""}`;
        assert.strictEqual(
          emojiRegex.test(combinedText),
          false,
          `Presentation for reason=${r}, isPermanent=${isPermanent}, isHost=${isHost} must not contain emojis`
        );
      }
    }
  }
}

console.log("All postRoomContext tests passed successfully!");
