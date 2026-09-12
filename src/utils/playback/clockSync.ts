export interface ClockSyncSample {
  serverTime: number;
  clientTime: number;
  rtt: number;
  offset: number;
}

export class ClockSynchronizer {
  private samples: ClockSyncSample[] = [];
  private maxSamples: number;
  private currentOffset: number = 0;

  constructor(maxSamples: number = 10) {
    this.maxSamples = maxSamples;
  }

  public recordSample(serverTime: number, clientSendTime: number, clientReceiveTime: number = Date.now()): void {
    const rtt = Math.max(0, clientReceiveTime - clientSendTime);
    // offset = serverTime - (clientReceiveTime - rtt / 2) = serverTime - (clientSendTime + clientReceiveTime) / 2
    const offset = serverTime - (clientSendTime + rtt / 2);

    this.samples.push({ serverTime, clientTime: clientReceiveTime, rtt, offset });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.recomputeOffset();
  }

  public setDirectOffset(offset: number): void {
    this.currentOffset = offset;
  }

  private recomputeOffset(): void {
    if (this.samples.length === 0) {
      this.currentOffset = 0;
      return;
    }

    // Sort samples by RTT to prioritize lowest latency samples, then calculate median offset
    const sortedByRtt = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    // Take best half of samples
    const bestSamples = sortedByRtt.slice(0, Math.max(1, Math.ceil(sortedByRtt.length / 2)));
    const sortedOffsets = bestSamples.map((s) => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(sortedOffsets.length / 2);

    this.currentOffset =
      sortedOffsets.length % 2 !== 0
        ? sortedOffsets[mid]
        : (sortedOffsets[mid - 1] + sortedOffsets[mid]) / 2;
  }

  public getOffset(): number {
    return this.currentOffset;
  }

  public getEstimatedServerNow(clientNow: number = Date.now()): number {
    return clientNow + this.currentOffset;
  }

  public reset(): void {
    this.samples = [];
    this.currentOffset = 0;
  }
}

export const clockSynchronizer = new ClockSynchronizer();
