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
  contentFingerprint: string;
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

export function normalizeLocalMediaManifest(raw: unknown): LocalMediaManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = { ...(raw as Record<string, unknown>) };

  if (!m.contentFingerprint && typeof m.contentHash === "string" && m.contentHash.trim().length > 0) {
    m.contentFingerprint = m.contentHash.trim();
  }
  delete m.contentHash;

  if (validateLocalMediaManifest(m)) {
    return m as unknown as LocalMediaManifest;
  }
  return null;
}

export function validateLocalMediaManifest(manifest: unknown): manifest is LocalMediaManifest {
  if (!manifest || typeof manifest !== "object") return false;
  const m = manifest as Record<string, unknown>;

  const fingerprint = (m.contentFingerprint as string) || (m.contentHash as string);
  if (typeof fingerprint !== "string" || fingerprint.trim().length === 0) return false;

  const totalChunks = typeof m.totalChunks === "number" ? m.totalChunks : 0;
  const chunkSize = typeof m.chunkSize === "number" ? m.chunkSize : 0;
  const byteLength = typeof m.byteLength === "number" ? m.byteLength : 0;
  const durationSeconds = typeof m.durationSeconds === "number" ? m.durationSeconds : 0;
  const epoch = typeof m.epoch === "number" ? m.epoch : 0;

  if (chunkSize <= 0 || byteLength <= 0 || totalChunks <= 0 || epoch < 1) return false;
  if (totalChunks !== Math.ceil(byteLength / chunkSize)) return false;
  if (durationSeconds <= 0) return false;

  return (
    typeof m.mediaId === "string" &&
    m.mediaId.trim().length > 0 &&
    typeof m.roomId === "string" &&
    m.roomId.trim().length > 0 &&
    typeof m.ownerId === "string" &&
    m.ownerId.trim().length > 0 &&
    typeof m.filename === "string" &&
    m.filename.trim().length > 0 &&
    typeof m.mimeType === "string" &&
    m.mimeType.trim().length > 0
  );
}
