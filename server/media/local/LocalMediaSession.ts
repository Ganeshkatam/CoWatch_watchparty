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
  contentHash: string;
  initializationSegmentByteLength: number;
  epoch: number;
  createdAt: number;
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
}
