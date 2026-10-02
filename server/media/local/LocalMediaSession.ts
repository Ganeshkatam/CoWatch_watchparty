/**
 * LOCAL-MEDIA-001: Local Media Server Session
 * Authoritative in-memory model for tracking a room's active local media session.
 */

export interface ServerLocalMediaManifest {
  mediaId: string;
  roomId: string;
  ownerId: string;
  filename: string;
  byteLength: number;
  durationSeconds: number;
  mimeType: string;
  container: "mp4" | "webm" | "mkv" | "unknown";
  codec: string;
  chunkSize: number;
  totalChunks: number;
  contentFingerprint: string;
  initializationSegmentByteLength: number;
  epoch: number;
  createdAt: number;
}

export interface ManifestValidationResult {
  valid: boolean;
  reason?: string;
  sanitized?: ServerLocalMediaManifest;
}

export const MANIFEST_LIMITS = {
  MAX_BYTE_LENGTH: 10 * 1024 * 1024 * 1024, // 10 GB
  MIN_CHUNK_SIZE: 16 * 1024, // 16 KB
  MAX_CHUNK_SIZE: 8 * 1024 * 1024, // 8 MB
  MAX_TOTAL_CHUNKS: 200000,
  MAX_DURATION_SECONDS: 86400, // 24 hours
  MAX_FILENAME_LENGTH: 255,
  MAX_INIT_SEGMENT_LENGTH: 10 * 1024 * 1024, // 10 MB
};

export function validateLocalMediaManifest(raw: unknown): ManifestValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, reason: "Manifest must be a non-null object" };
  }

  const obj = raw as Record<string, unknown>;

  // mediaId
  const mediaId = typeof obj.mediaId === "string" ? obj.mediaId.trim() : "";
  if (!mediaId || mediaId.length > 128) {
    return { valid: false, reason: "Invalid mediaId: must be non-empty string <= 128 chars" };
  }

  // filename
  let filename = typeof obj.filename === "string" ? obj.filename.trim() : "unnamed_media";
  filename = filename.replace(/[\/\\]/g, "_").replace(/\0/g, "").slice(0, MANIFEST_LIMITS.MAX_FILENAME_LENGTH);
  if (!filename) {
    filename = "media";
  }

  // byteLength
  const byteLength =
    typeof obj.byteLength === "number" && Number.isFinite(obj.byteLength)
      ? Math.floor(obj.byteLength)
      : -1;
  if (byteLength < 1 || byteLength > MANIFEST_LIMITS.MAX_BYTE_LENGTH) {
    return {
      valid: false,
      reason: `Invalid byteLength: must be integer between 1 and ${MANIFEST_LIMITS.MAX_BYTE_LENGTH}`,
    };
  }

  // chunkSize
  const chunkSize =
    typeof obj.chunkSize === "number" && Number.isFinite(obj.chunkSize)
      ? Math.floor(obj.chunkSize)
      : -1;
  if (chunkSize < MANIFEST_LIMITS.MIN_CHUNK_SIZE || chunkSize > MANIFEST_LIMITS.MAX_CHUNK_SIZE) {
    return {
      valid: false,
      reason: `Invalid chunkSize: must be between ${MANIFEST_LIMITS.MIN_CHUNK_SIZE} and ${MANIFEST_LIMITS.MAX_CHUNK_SIZE}`,
    };
  }

  // totalChunks
  const totalChunks =
    typeof obj.totalChunks === "number" && Number.isFinite(obj.totalChunks)
      ? Math.floor(obj.totalChunks)
      : -1;
  const expectedChunks = Math.ceil(byteLength / chunkSize);
  if (
    totalChunks < 1 ||
    totalChunks > MANIFEST_LIMITS.MAX_TOTAL_CHUNKS ||
    Math.abs(totalChunks - expectedChunks) > 2
  ) {
    return {
      valid: false,
      reason: `Invalid totalChunks: expected ~${expectedChunks} for size ${byteLength} and chunkSize ${chunkSize}, received ${totalChunks}`,
    };
  }

  // durationSeconds
  const durationSeconds =
    typeof obj.durationSeconds === "number" && Number.isFinite(obj.durationSeconds)
      ? Math.max(0, obj.durationSeconds)
      : 0;
  if (durationSeconds > MANIFEST_LIMITS.MAX_DURATION_SECONDS) {
    return {
      valid: false,
      reason: `Invalid durationSeconds: exceeds max of ${MANIFEST_LIMITS.MAX_DURATION_SECONDS} seconds`,
    };
  }

  // container
  const rawContainer = typeof obj.container === "string" ? obj.container.toLowerCase().trim() : "mp4";
  const validContainers: ReadonlyArray<"mp4" | "webm" | "mkv" | "unknown"> = [
    "mp4",
    "webm",
    "mkv",
    "unknown",
  ];
  const container: "mp4" | "webm" | "mkv" | "unknown" = validContainers.includes(
    rawContainer as "mp4" | "webm" | "mkv" | "unknown"
  )
    ? (rawContainer as "mp4" | "webm" | "mkv" | "unknown")
    : "unknown";

  // mimeType
  const mimeType =
    typeof obj.mimeType === "string" ? obj.mimeType.trim().slice(0, 100) : "video/mp4";

  // codec
  const codec = typeof obj.codec === "string" ? obj.codec.trim().slice(0, 100) : "";

  // contentFingerprint
  const contentFingerprint =
    typeof obj.contentFingerprint === "string"
      ? obj.contentFingerprint.trim().slice(0, 128)
      : typeof obj.contentHash === "string"
      ? String(obj.contentHash).trim().slice(0, 128)
      : "";

  // initializationSegmentByteLength
  const initSegBytes =
    typeof obj.initializationSegmentByteLength === "number" &&
    Number.isFinite(obj.initializationSegmentByteLength)
      ? Math.max(0, Math.floor(obj.initializationSegmentByteLength))
      : 0;
  if (initSegBytes > MANIFEST_LIMITS.MAX_INIT_SEGMENT_LENGTH) {
    return {
      valid: false,
      reason: `Invalid initializationSegmentByteLength: exceeds max of ${MANIFEST_LIMITS.MAX_INIT_SEGMENT_LENGTH}`,
    };
  }

  // epoch
  const epoch =
    typeof obj.epoch === "number" && Number.isFinite(obj.epoch)
      ? Math.max(1, Math.floor(obj.epoch))
      : 1;

  const sanitized: ServerLocalMediaManifest = {
    mediaId,
    roomId: typeof obj.roomId === "string" ? obj.roomId.trim() : "",
    ownerId: typeof obj.ownerId === "string" ? obj.ownerId.trim() : "",
    filename,
    byteLength,
    durationSeconds,
    mimeType,
    container,
    codec,
    chunkSize,
    totalChunks,
    contentFingerprint,
    initializationSegmentByteLength: initSegBytes,
    epoch,
    createdAt:
      typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
        ? obj.createdAt
        : Date.now(),
  };

  return { valid: true, sanitized };
}

export class LocalMediaSession {
  public readonly mediaId: string;
  public readonly roomId: string;
  public ownerId: string;
  public manifest: ServerLocalMediaManifest;
  public status: "ACTIVE" | "ENDED" | "FAILED" = "ACTIVE";
  public epoch: number;
  public createdAt: number;

  constructor(manifest: ServerLocalMediaManifest) {
    this.mediaId = manifest.mediaId;
    this.roomId = manifest.roomId;
    this.ownerId = manifest.ownerId;
    this.manifest = manifest;
    this.epoch = manifest.epoch || 1;
    this.createdAt = Date.now();
  }

  public promoteFailoverSeed(newOwnerUserId: string): number {
    this.ownerId = newOwnerUserId;
    this.epoch += 1;
    this.manifest.ownerId = newOwnerUserId;
    this.manifest.epoch = this.epoch;
    return this.epoch;
  }

  public updateOwner(newOwnerId: string): void {
    this.ownerId = newOwnerId;
    this.manifest.ownerId = newOwnerId;
  }

  public incrementEpoch(): number {
    this.epoch += 1;
    this.manifest.epoch = this.epoch;
    return this.epoch;
  }

  public terminate(): void {
    this.status = "ENDED";
  }

  public isActive(): boolean {
    return this.status === "ACTIVE";
  }
}
