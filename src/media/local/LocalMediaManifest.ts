/**
 * LOCAL-MEDIA-001: Local Media Manifest Definitions & Validators
 * Authoritative schema for describing host-selected media files distributed via P2P.
 */

export interface LocalMediaManifest {
  mediaId: string;
  roomId: string;
  ownerId: string;
  filename: string;
  byteLength: number;
  durationSeconds: number;
  mimeType: string;
  container: "mp4" | "webm" | "mkv" | "unknown";
  codec: string;
  chunkSize: number; // e.g., 131072 (128 KB)
  totalChunks: number;
  contentHash: string;
  initializationSegmentByteLength: number;
  epoch: number;
  createdAt: number;
}

export interface LocalMediaChunkHeader {
  mediaId: string;
  chunkIndex: number;
  byteOffset: number;
  byteLength: number;
  checksum: string;
  epoch: number;
}

export interface LocalMediaChunk {
  header: LocalMediaChunkHeader;
  data: Uint8Array;
}

export interface PeerChunkAvailability {
  peerId: string;
  mediaId: string;
  epoch: number;
  availableChunks: number[]; // or bitfield / ranges
  contiguousThrough: number;
  lastUpdated: number;
}

export function detectMediaContainer(filename: string, mimeType: string): "mp4" | "webm" | "mkv" | "unknown" {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (lowerName.endsWith(".mp4") || lowerMime.includes("mp4")) {
    return "mp4";
  }
  if (lowerName.endsWith(".webm") || lowerMime.includes("webm")) {
    return "webm";
  }
  if (lowerName.endsWith(".mkv") || lowerMime.includes("matroska") || lowerMime.includes("mkv")) {
    return "mkv";
  }
  return "unknown";
}

export function calculateTotalChunks(byteLength: number, chunkSize: number): number {
  if (byteLength <= 0 || chunkSize <= 0) return 0;
  return Math.ceil(byteLength / chunkSize);
}

export function validateLocalMediaManifest(manifest: unknown): manifest is LocalMediaManifest {
  if (!manifest || typeof manifest !== "object") return false;
  const m = manifest as Record<string, unknown>;

  return (
    typeof m.mediaId === "string" &&
    m.mediaId.length > 0 &&
    typeof m.roomId === "string" &&
    m.roomId.length > 0 &&
    typeof m.ownerId === "string" &&
    typeof m.filename === "string" &&
    typeof m.byteLength === "number" &&
    m.byteLength > 0 &&
    typeof m.durationSeconds === "number" &&
    typeof m.mimeType === "string" &&
    typeof m.chunkSize === "number" &&
    m.chunkSize > 0 &&
    typeof m.totalChunks === "number" &&
    m.totalChunks > 0 &&
    typeof m.contentHash === "string" &&
    typeof m.epoch === "number"
  );
}
