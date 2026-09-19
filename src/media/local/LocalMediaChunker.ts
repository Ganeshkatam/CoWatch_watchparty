/**
 * LOCAL-MEDIA-001: Local Media File Chunker
 * Efficiently slices local File/Blob objects into structured binary chunks on demand.
 */

import { LocalMediaChunk, LocalMediaChunkHeader, LocalMediaManifest, calculateTotalChunks, detectMediaContainer } from "./LocalMediaManifest";
import { cyrb53 } from "../../utils/hash";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function computeChunkChecksum(data: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export async function computeContentFingerprint(file: File | Blob, filename: string): Promise<string> {
  const size = file.size;
  if (size === 0) return `0_${cyrb53(filename)}`;
  const sampleSize = 4096;
  try {
    const headSlice = await file.slice(0, Math.min(size, sampleSize)).arrayBuffer();
    const midStart = Math.max(0, Math.floor(size / 2) - Math.floor(sampleSize / 2));
    const midSlice = await file.slice(midStart, midStart + Math.min(size - midStart, sampleSize)).arrayBuffer();
    const tailStart = Math.max(0, size - sampleSize);
    const tailSlice = await file.slice(tailStart, size).arrayBuffer();

    const h1 = cyrb53(new Uint8Array(headSlice).join(","));
    const h2 = cyrb53(new Uint8Array(midSlice).join(","));
    const h3 = cyrb53(new Uint8Array(tailSlice).join(","));

    return `${size}_${cyrb53(filename)}_${h1.toString(16)}_${h2.toString(16)}_${h3.toString(16)}`;
  } catch {
    return `${size}_${cyrb53(filename)}`;
  }
}

export class LocalMediaChunker {
  private file: File | Blob;
  private filename: string;
  private mimeType: string;
  private chunkSize: number;
  private totalChunks: number;
  private mediaId: string;
  private epoch: number;
  private durationSeconds: number;
  private codec: string;
  private contentFingerprint: string;
  private initSegmentLength: number;

  constructor(
    file: File | Blob,
    options?: {
      filename?: string;
      chunkSize?: number;
      mediaId?: string;
      epoch?: number;
      durationSeconds?: number;
      codec?: string;
      contentFingerprint?: string;
    }
  ) {
    this.file = file;
    this.filename = options?.filename || (file instanceof File ? file.name : "local-media.mp4");
    this.mimeType = file.type || "video/mp4";
    this.chunkSize = options?.chunkSize || 131072; // 128 KB standard chunk size
    this.totalChunks = calculateTotalChunks(this.file.size, this.chunkSize);
    this.mediaId = options?.mediaId || generateUUID();
    this.epoch = options?.epoch ?? 1;
    this.durationSeconds = options?.durationSeconds ?? 0;
    this.codec = options?.codec || "";
    this.contentFingerprint = options?.contentFingerprint || `${this.file.size}_${cyrb53(this.filename)}`;
    this.initSegmentLength = Math.min(this.file.size, this.chunkSize * 2); // First 256KB typically houses MP4/WebM headers
  }

  public async initializeFingerprint(): Promise<string> {
    this.contentFingerprint = await computeContentFingerprint(this.file, this.filename);
    return this.contentFingerprint;
  }

  public setMetadata(duration: number, codec?: string): void {
    if (duration > 0) {
      this.durationSeconds = duration;
    }
    if (codec) {
      this.codec = codec;
    }
  }

  public getManifest(roomId: string, ownerId: string): LocalMediaManifest {
    return {
      mediaId: this.mediaId,
      roomId,
      ownerId,
      filename: this.filename,
      byteLength: this.file.size,
      durationSeconds: this.durationSeconds,
      mimeType: this.mimeType,
      container: detectMediaContainer(this.filename, this.mimeType),
      codec: this.codec,
      chunkSize: this.chunkSize,
      totalChunks: this.totalChunks,
      contentFingerprint: this.contentFingerprint,
      contentHash: this.contentFingerprint,
      initializationSegmentByteLength: this.initSegmentLength,
      epoch: this.epoch,
      createdAt: Date.now(),
    };
  }

  public setDuration(duration: number): void {
    if (duration > 0) {
      this.durationSeconds = duration;
    }
  }

  public getMediaId(): string {
    return this.mediaId;
  }

  public getTotalChunks(): number {
    return this.totalChunks;
  }

  public getChunkSize(): number {
    return this.chunkSize;
  }

  public getFileSize(): number {
    return this.file.size;
  }

  public async getChunk(chunkIndex: number): Promise<LocalMediaChunk | null> {
    if (chunkIndex < 0 || chunkIndex >= this.totalChunks) {
      return null;
    }

    const start = chunkIndex * this.chunkSize;
    const end = Math.min(this.file.size, start + this.chunkSize);
    const slice = this.file.slice(start, end);
    const arrayBuffer = await slice.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const checksum = computeChunkChecksum(data);

    const header: LocalMediaChunkHeader = {
      mediaId: this.mediaId,
      chunkIndex,
      byteOffset: start,
      byteLength: data.byteLength,
      checksum: String(checksum),
      epoch: this.epoch,
    };

    return {
      header,
      data,
    };
  }

  public async getInitSegment(): Promise<Uint8Array> {
    const slice = this.file.slice(0, this.initSegmentLength);
    const arrayBuffer = await slice.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}
