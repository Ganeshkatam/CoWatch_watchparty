import {
  stripLeadingSlash,
  sanitizeRoomId,
  stripSlashesFromDatabase,
} from "./strip_slashes.ts";

async function runTests() {
  console.log("Running strip_slashes tests...");

  // Test 1: Single leading slash
  if (stripLeadingSlash("/room-123") !== "room-123") {
    throw new Error(`Expected 'room-123', got '${stripLeadingSlash("/room-123")}'`);
  }

  // Test 2: Multiple leading slashes
  if (stripLeadingSlash("///room-456") !== "room-456") {
    throw new Error(`Expected 'room-456', got '${stripLeadingSlash("///room-456")}'`);
  }

  // Test 3: Trimming whitespace with leading slashes (" /abc/def " -> "abc/def")
  if (stripLeadingSlash(" /abc/def ") !== "abc/def") {
    throw new Error(`Expected 'abc/def', got '${stripLeadingSlash(" /abc/def ")}'`);
  }

  // Test 4: Already clean room ID unchanged
  if (stripLeadingSlash("my-clean-room") !== "my-clean-room") {
    throw new Error(`Expected 'my-clean-room', got '${stripLeadingSlash("my-clean-room")}'`);
  }

  // Test 5: Empty, null, undefined inputs
  if (stripLeadingSlash("") !== "") {
    throw new Error("Expected empty string for ''");
  }
  if (stripLeadingSlash(null) !== "") {
    throw new Error("Expected empty string for null");
  }
  if (stripLeadingSlash(undefined) !== "") {
    throw new Error("Expected empty string for undefined");
  }
  if (stripLeadingSlash("   ") !== "") {
    throw new Error("Expected empty string for whitespace string");
  }

  // Test 6: sanitizeRoomId alias equivalence
  if (sanitizeRoomId(" /test-room ") !== "test-room") {
    throw new Error(`Expected sanitizeRoomId to return 'test-room'`);
  }

  // Test 7: Transactional idempotent database migration with mock client
  const executedQueries: string[] = [];
  const mockClient: any = {
    query: async (sql: string) => {
      executedQueries.push(sql.trim());
      if (sql.includes("UPDATE rooms")) {
        return { rowCount: 2 };
      }
      if (sql.includes("UPDATE room_lifecycle_events")) {
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  };

  const result = await stripSlashesFromDatabase(mockClient);
  if (result.roomsUpdated !== 2 || result.lifecycleEventsUpdated !== 1) {
    throw new Error(
      `Unexpected migration result: ${JSON.stringify(result)}`,
    );
  }

  if (executedQueries[0] !== "BEGIN") {
    throw new Error("Migration must begin with transaction BEGIN");
  }
  if (executedQueries[executedQueries.length - 1] !== "COMMIT") {
    throw new Error("Migration must finish with transaction COMMIT");
  }

  // Test 8: Transaction rollback on failure
  let rollbackExecuted = false;
  const failingClient: any = {
    query: async (sql: string) => {
      if (sql.trim() === "BEGIN") return {};
      if (sql.trim() === "ROLLBACK") {
        rollbackExecuted = true;
        return {};
      }
      if (sql.includes("UPDATE rooms")) {
        throw new Error("Simulated database failure");
      }
      return {};
    },
  };

  try {
    await stripSlashesFromDatabase(failingClient);
    throw new Error("Expected stripSlashesFromDatabase to throw on error");
  } catch (err: any) {
    if (err.message !== "Simulated database failure") {
      throw err;
    }
  }

  if (!rollbackExecuted) {
    throw new Error("Expected transaction ROLLBACK on query failure");
  }

  console.log("All strip_slashes tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
