// CoWatch Premium 3-Redis Architecture: In-Memory RedisMetrics Engine
// Telemetry is stored in process RAM only. NEVER write Redis telemetry to Redis.

export type BudgetState = 'normal' | 'warn' | 'critical';

export interface InstanceMetric {
  commands: number;
  errors: number;
  latencyMs: {
    avgMs: number;
    maxMs: number;
    p95Ms: number;
  };
}

export interface RedisMetricsSnapshot {
  totalCommands: number;
  monthlyRunRate: number;
  budgetState: BudgetState;
  monthlyBudgetCap: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  instances: {
    core: InstanceMetric;
    edge: InstanceMetric;
    metrics: InstanceMetric;
  };
  commandsByFeature: Record<string, number>;
  commandsByOp: Record<string, number>;
  latencyMs: {
    count: number;
    avgMs: number;
    maxMs: number;
    p95Ms?: number;
  };
  errors: number;
  degradedModeActive: boolean;
  uptimeSeconds: number;
}

const MONTHLY_BUDGET_CAP = 250000;
const WARN_THRESHOLD = 200000;
const SECONDS_PER_MONTH = 30 * 24 * 3600; // 2,592,000 seconds

export class RedisMetricsTracker {
  private startTime = Date.now();
  private totalCommands = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private commandsByFeature = new Map<string, number>();
  private commandsByOp = new Map<string, number>();
  private errors = 0;
  private totalLatencyMs = 0;
  private maxLatencyMs = 0;
  private latencySamples: number[] = [];
  private readonly maxLatencySamples = 1000;

  // Instance tracking
  private instanceStats = {
    core: { commands: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, latencySamples: [] as number[] },
    edge: { commands: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, latencySamples: [] as number[] },
    metrics: { commands: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, latencySamples: [] as number[] },
  };

  public recordCommand(
    feature: string,
    op: string,
    latencyMs: number,
    success = true,
    instance: 'core' | 'edge' | 'metrics' = 'edge'
  ): void {
    this.totalCommands++;
    if (!success) {
      this.errors++;
    }

    // Instance specific telemetry
    const targetInst = this.instanceStats[instance] || this.instanceStats.edge;
    targetInst.commands++;
    if (!success) targetInst.errors++;
    targetInst.totalLatencyMs += latencyMs;
    if (latencyMs > targetInst.maxLatencyMs) targetInst.maxLatencyMs = latencyMs;
    if (targetInst.latencySamples.length < 500) {
      targetInst.latencySamples.push(latencyMs);
    } else {
      targetInst.latencySamples[Math.floor(Math.random() * 500)] = latencyMs;
    }

    const featureCount = this.commandsByFeature.get(feature) || 0;
    this.commandsByFeature.set(feature, featureCount + 1);

    const opKey = op.toUpperCase();
    const opCount = this.commandsByOp.get(opKey) || 0;
    this.commandsByOp.set(opKey, opCount + 1);

    this.totalLatencyMs += latencyMs;
    if (latencyMs > this.maxLatencyMs) {
      this.maxLatencyMs = latencyMs;
    }

    if (this.latencySamples.length < this.maxLatencySamples) {
      this.latencySamples.push(latencyMs);
    } else {
      const idx = Math.floor(Math.random() * this.maxLatencySamples);
      this.latencySamples[idx] = latencyMs;
    }
  }

  public recordCacheHit(feature = 'default'): void {
    this.cacheHits++;
    const count = this.commandsByFeature.get(feature) || 0;
    this.commandsByFeature.set(feature, count);
  }

  public recordCacheMiss(feature = 'default'): void {
    this.cacheMisses++;
    const count = this.commandsByFeature.get(feature) || 0;
    this.commandsByFeature.set(feature, count);
  }

  private forcedRunRate: number | undefined = undefined;

  public setForcedRunRate(rate?: number): void {
    this.forcedRunRate = rate;
  }

  public getMonthlyRunRate(): number {
    if (this.forcedRunRate !== undefined) {
      return this.forcedRunRate;
    }
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    // Require at least 10 seconds of sampling before extrapolating to full 30-day monthly run-rate
    if (elapsedSeconds < 10) {
      return 0;
    }
    return Math.round((this.totalCommands / elapsedSeconds) * SECONDS_PER_MONTH);
  }

  public getBudgetState(): BudgetState {
    const runRate = this.getMonthlyRunRate();
    if (runRate >= MONTHLY_BUDGET_CAP) {
      return 'critical';
    }
    if (runRate >= WARN_THRESHOLD) {
      return 'warn';
    }
    return 'normal';
  }

  public isDegradedMode(): boolean {
    return this.getBudgetState() === 'critical';
  }

  private computePercentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[idx] || 0;
  }

  public getSnapshot(): RedisMetricsSnapshot {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRatio = totalRequests > 0 ? Number((this.cacheHits / totalRequests).toFixed(4)) : 1;
    const avgLatency = this.totalCommands > 0 ? Number((this.totalLatencyMs / this.totalCommands).toFixed(2)) : 0;
    const p95Ms = this.computePercentile(this.latencySamples, 0.95);

    const featureObj: Record<string, number> = {};
    for (const [k, v] of this.commandsByFeature.entries()) {
      featureObj[k] = v;
    }

    const opObj: Record<string, number> = {};
    for (const [k, v] of this.commandsByOp.entries()) {
      opObj[k] = v;
    }

    const formatInstance = (inst: typeof this.instanceStats.core): InstanceMetric => ({
      commands: inst.commands,
      errors: inst.errors,
      latencyMs: {
        avgMs: inst.commands > 0 ? Number((inst.totalLatencyMs / inst.commands).toFixed(2)) : 0,
        maxMs: inst.maxLatencyMs,
        p95Ms: this.computePercentile(inst.latencySamples, 0.95),
      },
    });

    return {
      totalCommands: this.totalCommands,
      monthlyRunRate: this.getMonthlyRunRate(),
      budgetState: this.getBudgetState(),
      monthlyBudgetCap: MONTHLY_BUDGET_CAP,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: hitRatio,
      instances: {
        core: formatInstance(this.instanceStats.core),
        edge: formatInstance(this.instanceStats.edge),
        metrics: formatInstance(this.instanceStats.metrics),
      },
      commandsByFeature: featureObj,
      commandsByOp: opObj,
      latencyMs: {
        count: this.totalCommands,
        avgMs: avgLatency,
        maxMs: this.maxLatencyMs,
        p95Ms,
      },
      errors: this.errors,
      degradedModeActive: this.isDegradedMode(),
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  public resetForTesting(): void {
    this.startTime = Date.now();
    this.totalCommands = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.commandsByFeature.clear();
    this.commandsByOp.clear();
    this.errors = 0;
    this.totalLatencyMs = 0;
    this.maxLatencyMs = 0;
    this.latencySamples = [];
    this.forcedRunRate = undefined;
    this.instanceStats = {
      core: { commands: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, latencySamples: [] },
      edge: { commands: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, latencySamples: [] },
      metrics: { commands: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0, latencySamples: [] },
    };
  }
}

export const RedisMetrics = new RedisMetricsTracker();
