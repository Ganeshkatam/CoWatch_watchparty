/**
 * LOCAL-MEDIA-001: Local Media In-Memory Chunk Cache
 * Stores received binary chunks, tracks availability ranges, and prevents memory unbounded growth.
 */

import { LocalMediaChunk, LocalMediaManifest } from "./LocalMediaManifest";

export class LocalMediaCache {
  private mediaId: string;
  private totalChunks: number;
  private chunks: Map<number, Uint8Array>;
  private maxCachedChunks: number;
  private accessHistory: number[];

  constructor(manifest: LocalMediaManifest, maxCachedChunks: number = 500) {
    this.mediaId = manifest.mediaId;
    this.totalChunks = manifest.totalChunks;
    this.chunks = new Map();
    this.maxCachedChunks = Math.max(2, maxCachedChunks);
    this.accessHistory = [];
  }

  public putChunk(chunkIndex: number, data: Uint8Array): void {
    if (chunkIndex < 0 || chunkIndex >= this.totalChunks) return;

    this.chunks.set(chunkIndex, data);
    this.markAccessed(chunkIndex);
    this.evictIfNecessary();
  }

  public getChunk(chunkIndex: number): Uint8Array | null {
    const chunk = this.chunks.get(chunkIndex);
    if (chunk) {
      this.markAccessed(chunkIndex);
      return chunk;
    }
    return null;
  }

  public hasChunk(chunkIndex: number): boolean {
    return this.chunks.has(chunkIndex);
  }

  public getAvailableChunks(): number[] {
    return Array.from(this.chunks.keys()).sort((a, b) => a - b);
  }

  public getContiguousCoverageFromStart(): number {
    let index = 0;
    while (this.chunks.has(index)) {
      index++;
    }
    return index; // returns number of contiguous chunks from 0
  }

  public getContiguousCoverageFrom(startIndex: number): number {
    let index = startIndex;
    while (this.chunks.has(index)) {
      index++;
    }
    return index - startIndex;
  }

  public getContiguousByteSegment(startIndex: number, count: number): Uint8Array | null {
    if (count <= 0) return null;

    let totalLength = 0;
    const slices: Uint8Array[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) return null;
      slices.push(chunk);
      totalLength += chunk.byteLength;
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const slice of slices) {
      merged.set(slice, offset);
      offset += slice.byteLength;
    }

    return merged;
  }

  public getMissingChunkIndices(targetIndices: number[]): number[] {
    return targetIndices.filter((idx) => !this.chunks.has(idx) && idx >= 0 && idx < this.totalChunks);
  }

  public clear(): void {
    this.chunks.clear();
    this.accessHistory = [];
  }

  public getMemoryUsageBytes(): number {
    let bytes = 0;
    for (const chunk of this.chunks.values()) {
      bytes += chunk.byteLength;
    }
    return bytes;
  }

  private markAccessed(chunkIndex: number): void {
    const existingPos = this.accessHistory.indexOf(chunkIndex);
    if (existingPos !== -1) {
      this.accessHistory.splice(existingPos, 1);
    }
    this.accessHistory.push(chunkIndex);
  }

  private evictIfNecessary(): void {
    while (this.chunks.size > this.maxCachedChunks && this.accessHistory.length > 0) {
      // Never evict chunk 0 or 1 (init headers)
      let evictCandidateIndex = -1;
      for (let i = 0; i < this.accessHistory.length; i++) {
        const candidate = this.accessHistory[i];
        if (candidate > 1) {
          evictCandidateIndex = candidate;
          this.accessHistory.splice(i, 1);
          break;
        }
      }

      if (evictCandidateIndex !== -1) {
        this.chunks.delete(evictCandidateIndex);
      } else {
        break;
      }
    }
  }
}
