import { parseRoomInput, autoCreateUsername } from "../../utils/utils";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// 1. Plain room codes and slugs
assert(parseRoomInput("abc123") === "abc123", "abc123 should parse as abc123");
assert(
  parseRoomInput("rebel-structure-balance") === "rebel-structure-balance",
  "rebel-structure-balance should parse as rebel-structure-balance"
);
assert(parseRoomInput("room_name_42") === "room_name_42", "room_name_42 should parse as room_name_42");

// 2. Slash-prefixed room codes
assert(parseRoomInput("/abc123") === "abc123", "/abc123 should parse as abc123");
assert(
  parseRoomInput("/rebel-structure-balance") === "rebel-structure-balance",
  "/rebel-structure-balance should parse as rebel-structure-balance"
);

// 3. /join/ and /watch/ paths
assert(
  parseRoomInput("/join/rebel-structure-balance") === "rebel-structure-balance",
  "/join/rebel-structure-balance should parse as rebel-structure-balance"
);
assert(
  parseRoomInput("/watch/rebel-structure-balance") === "rebel-structure-balance",
  "/watch/rebel-structure-balance should parse as rebel-structure-balance"
);
assert(parseRoomInput("/join/abc123?pass=123") === "abc123", "/join/abc123?pass=123 should parse as abc123");

// 4. Full URLs with /join/ or /watch/
assert(
  parseRoomInput("https://cowatch.tv/join/rebel-structure-balance") === "rebel-structure-balance",
  "https URL with /join/ should parse correctly"
);
assert(
  parseRoomInput("https://cowatch-six.vercel.app/join/rebel-structure-balance?passcode=123") ===
    "rebel-structure-balance",
  "URL with query params should parse clean room ID"
);
assert(
  parseRoomInput("https://cowatch.tv/join/abc123/subpath") === "abc123",
  "URL with trailing subpath should parse base room ID"
);
assert(
  parseRoomInput("https://cowatch.tv/watch/rebel-structure-balance") === "rebel-structure-balance",
  "https URL with /watch/ should parse correctly"
);
assert(
  parseRoomInput("http://localhost:5173/join/rebel-structure-balance") === "rebel-structure-balance",
  "localhost URL should parse correctly"
);

// 5. Rejects unrelated URLs
assert(parseRoomInput("https://google.com") === null, "Unrelated Google URL should return null");
assert(parseRoomInput("https://youtube.com/watch?v=12345") === null, "YouTube URL should return null");
assert(parseRoomInput("https://twitter.com/cowatch") === null, "Twitter URL should return null");

// 6. Rejects invalid characters and empty input
assert(parseRoomInput("") === null, "Empty string should return null");
assert(parseRoomInput("   ") === null, "Whitespace should return null");
assert(parseRoomInput("room code with spaces") === null, "Spaces in code should return null");
assert(parseRoomInput("room!@#$%^&*()") === null, "Special characters should return null");

// 7. autoCreateUsername tests
assert(
  autoCreateUsername("Ganesh Katam", null, 1234) === "ganesh_katam_1234",
  "multi-word name should convert to snake_case with suffix"
);
assert(
  autoCreateUsername("Jane", null, 5555) === "jane_5555",
  "single name should keep handle format"
);
assert(
  autoCreateUsername("François Côté", null, 9999) === "francois_cote_9999",
  "accents should be normalized"
);
assert(
  autoCreateUsername("", "alex@example.com", 2026) === "alex_2026",
  "empty name should fall back to email prefix"
);
assert(
  autoCreateUsername("", "", 4040) === "user_4040",
  "empty name and email should fall back to user prefix"
);
assert(
  autoCreateUsername("A Very Long Profile Name Exceeding Eighteen Characters", null, 1111).startsWith("a_very_long_profil_1111"),
  "long names should be cleanly truncated"
);

console.log("All parseRoomInput and autoCreateUsername tests passed successfully!");
