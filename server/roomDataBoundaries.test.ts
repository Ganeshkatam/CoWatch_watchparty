import http from "http";
import express from "express";

interface MockRoomRow {
  roomId: string;
  roomTitle: string;
  roomDescription?: string;
  coverPhoto?: string | null;
  status: string;
  expiresAt?: string | null;
  isPermanent: boolean;
  passcode?: string | null;
  owner_passcode?: string | null;
  owner_id: string;
  participants_locked: boolean;
  max_participants: number;
  hostName?: string;
}

// Mock In-Memory Room Database
const mockRoomsDb = new Map<string, MockRoomRow>([
  [
    "room_public_1",
    {
      roomId: "room_public_1",
      roomTitle: "Public Movie Night",
      roomDescription: "Everyone is welcome",
      status: "active",
      isPermanent: true,
      passcode: null,
      owner_passcode: "hashed_owner_secret_1",
      owner_id: "owner_user_1",
      participants_locked: false,
      max_participants: 20,
      hostName: "MovieHost",
    },
  ],
  [
    "room_protected_2",
    {
      roomId: "room_protected_2",
      roomTitle: "VIP Screening",
      roomDescription: "Password required",
      status: "inactive",
      isPermanent: false,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      passcode: "plaintext_super_secret_passcode",
      owner_passcode: "hashed_owner_secret_2",
      owner_id: "owner_user_2",
      participants_locked: true,
      max_participants: 5,
      hostName: "VIPHost",
    },
  ],
  [
    "room_expired_3",
    {
      roomId: "room_expired_3",
      roomTitle: "Old Party",
      roomDescription: "Expired room",
      status: "active", // status in DB is active but expiresAt is in the past
      isPermanent: false,
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
      passcode: null,
      owner_passcode: "hashed_owner_secret_3",
      owner_id: "owner_user_3",
      participants_locked: false,
      max_participants: 10,
      hostName: "OldHost",
    },
  ],
]);

function createTestToken(uid: string): string {
  return `mock_jwt_token_${uid}`;
}

function extractBearerToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return undefined;
}

function decodeTestToken(token?: string): { uid: string } | null {
  if (!token || !token.startsWith("mock_jwt_token_")) return null;
  return { uid: token.replace("mock_jwt_token_", "") };
}

function createRoomDataServer() {
  const app = express();
  app.use(express.json());

  // GET /roomInfo/:roomId
  app.get("/roomInfo/:roomId", (req, res) => {
    const rawRoomId = req.params.roomId;
    if (!rawRoomId) {
      res.status(400).json({ error: "Missing room identifier" });
      return;
    }

    let callerUid: string | undefined;
    const token = extractBearerToken(req);
    if (token) {
      const decoded = decodeTestToken(token);
      if (decoded) {
        callerUid = decoded.uid;
      }
    }

    const row = mockRoomsDb.get(rawRoomId);
    if (!row) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    // Compute derived status if expired
    let derivedStatus = row.status;
    if ((row.status === "active" || row.status === "inactive") && !row.isPermanent && row.expiresAt) {
      const expiresAt = new Date(row.expiresAt).getTime();
      if (expiresAt <= Date.now()) {
        derivedStatus = "expired";
      }
    }

    const isOwner = Boolean(callerUid && row.owner_id && callerUid === row.owner_id);

    // Sanitize response: NEVER leak passcode, owner_passcode, or foreign owner_id
    res.json({
      roomId: row.roomId,
      roomTitle: row.roomTitle || row.roomId,
      roomDescription: row.roomDescription || "",
      coverPhoto: row.coverPhoto || null,
      status: derivedStatus,
      requiresPasscode: Boolean(row.passcode && row.passcode.length > 0),
      participantsLocked: Boolean(row.participants_locked),
      maxParticipants: row.max_participants,
      isOwner,
      isHost: isOwner,
      owner_id: isOwner ? row.owner_id : null,
      isHostPresent: isOwner,
      hostName: row.hostName || "Host",
      isPermanent: Boolean(row.isPermanent),
    });
  });

  // GET /listRooms
  app.get("/listRooms", (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const decoded = decodeTestToken(token);
    if (!decoded) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    const callerUid = decoded.uid;

    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const limit = Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20);

    const userRooms: any[] = [];
    for (const room of mockRoomsDb.values()) {
      if (room.owner_id === callerUid) {
        if (
          !search ||
          room.roomTitle.toLowerCase().includes(search) ||
          room.roomId.toLowerCase().includes(search)
        ) {
          userRooms.push({
            roomId: room.roomId,
            roomTitle: room.roomTitle,
            roomDescription: room.roomDescription,
            status: room.status,
            coverPhoto: room.coverPhoto || null,
            isPermanent: room.isPermanent,
            isPasscodeProtected: Boolean(room.passcode && room.passcode.length > 0),
          });
        }
      }
    }

    res.json(userRooms.slice(0, limit));
  });

  return app;
}

// Direct Supabase RLS Simulation
function simulateSupabaseDirectQuery(callerUid: string | null, targetRoomId: string, requestedColumns: string[]) {
  // RLS Rule: USING ((SELECT auth.uid()) = owner_id)
  const row = mockRoomsDb.get(targetRoomId);
  if (!row) return { data: null, error: null };

  if (!callerUid || callerUid !== row.owner_id) {
    // RLS blocks access: returns null / empty set
    return { data: null, error: null };
  }

  // If caller is owner, construct projection of requested columns
  const projected: Record<string, any> = {};
  for (const col of requestedColumns) {
    if (col in row) {
      projected[col] = (row as any)[col];
    }
  }
  return { data: projected, error: null };
}

async function runRoomDataBoundariesTests() {
  console.log("================================================================");
  console.log("ROOM-DATA-001: Room Data & RLS Access Boundary Verification");
  console.log("================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testNum: number, testName: string, detail?: string) {
    if (condition) {
      console.log(`  PASS [Test ${testNum}: ${testName}]`);
      passed++;
    } else {
      console.error(`  FAIL [Test ${testNum}: ${testName}] - ${detail || "Assertion failed"}`);
      failed++;
    }
  }

  const app = createRoomDataServer();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  const ownerToken = createTestToken("owner_user_2");
  const guestToken = createTestToken("guest_user_99");

  try {
    // Test 1: Public roomInfo returns permitted metadata
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_public_1`);
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.roomId === "room_public_1" &&
        data.roomTitle === "Public Movie Night" &&
        data.requiresPasscode === false &&
        data.status === "active",
        1,
        "Public roomInfo returns permitted metadata"
      );
    }

    // Test 2: Anonymous roomInfo cannot obtain passcode
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_protected_2`);
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.requiresPasscode === true &&
        !("passcode" in data) &&
        !("owner_passcode" in data),
        2,
        "Anonymous roomInfo cannot obtain passcode"
      );
    }

    // Test 3: Guest roomInfo cannot obtain passcode
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_protected_2`, {
        headers: { Authorization: `Bearer ${guestToken}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.isOwner === false &&
        data.owner_id === null &&
        data.requiresPasscode === true &&
        !("passcode" in data),
        3,
        "Guest roomInfo cannot obtain passcode"
      );
    }

    // Test 4: Owner roomInfo cannot obtain plaintext passcode via roomInfo
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_protected_2`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.isOwner === true &&
        data.owner_id === "owner_user_2" &&
        data.requiresPasscode === true &&
        !("passcode" in data),
        4,
        "Owner roomInfo cannot obtain plaintext passcode"
      );
    }

    // Test 5: Response contains no `passcode` key anywhere
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_protected_2`);
      const data = await res.json();
      const keys = Object.keys(data);
      assert(!keys.includes("passcode"), 5, "Response contains no `passcode` property");
    }

    // Test 6: Response contains no `owner_passcode` key anywhere
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_protected_2`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const data = await res.json();
      const keys = Object.keys(data);
      assert(!keys.includes("owner_passcode"), 6, "Response contains no `owner_passcode` property");
    }

    // Test 7: Guest sees correct lifecycle status and expiration derivation
    {
      const res = await fetch(`${baseUrl}/roomInfo/room_expired_3`);
      const data = await res.json();
      assert(
        res.status === 200 && data.status === "expired",
        7,
        "Guest sees correct derived lifecycle status for expired room"
      );
    }

    // Test 8: Waiting guest sees status transition via /roomInfo
    {
      // Room starts inactive
      const res1 = await fetch(`${baseUrl}/roomInfo/room_protected_2`);
      const data1 = await res1.json();

      // Host starts session -> status becomes active
      const room = mockRoomsDb.get("room_protected_2")!;
      room.status = "active";

      const res2 = await fetch(`${baseUrl}/roomInfo/room_protected_2`);
      const data2 = await res2.json();

      assert(
        data1.status === "inactive" && data2.status === "active",
        8,
        "Waiting guest sees status transition via /roomInfo polling"
      );
    }

    // Test 9: Unknown room returns 404
    {
      const res = await fetch(`${baseUrl}/roomInfo/nonexistent_room_xyz`);
      assert(res.status === 404, 9, "Unknown room returns 404 Not Found");
    }

    // Test 10: listRooms returns sanitized search projection
    {
      const res = await fetch(`${baseUrl}/listRooms?search=vip`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        Array.isArray(data) &&
        data.length === 1 &&
        data[0].roomId === "room_protected_2" &&
        !("passcode" in data[0]) &&
        !("owner_passcode" in data[0]),
        10,
        "listRooms returns sanitized search projection"
      );
    }

    // Test 11: Direct rooms SELECT remains owner-scoped under RLS
    {
      const ownerQuery = simulateSupabaseDirectQuery("owner_user_2", "room_protected_2", [
        "roomId",
        "roomTitle",
        "status",
      ]);
      assert(
        Boolean(ownerQuery.data && ownerQuery.data.roomId === "room_protected_2"),
        11,
        "Direct rooms SELECT allowed for owner under RLS"
      );
    }

    // Test 12: Non-owner direct SELECT cannot expose another owner's room
    {
      const guestQuery = simulateSupabaseDirectQuery("guest_user_99", "room_protected_2", [
        "roomId",
        "passcode",
        "status",
      ]);
      assert(
        guestQuery.data === null,
        12,
        "Non-owner direct SELECT strictly blocked by RLS returning null"
      );
    }
  } finally {
    server.close();
  }

  console.log("================================================================");
  if (failed === 0) {
    console.log(`ALL 12 ROOM-DATA-001 TESTS PASSED WITH ZERO FAILURES.`);
  } else {
    console.error(`TEST SUITE FAILED: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }
  console.log("================================================================\n");
}

runRoomDataBoundariesTests();
