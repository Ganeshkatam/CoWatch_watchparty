/**
 * NOTIFY-001A Notification & Outbox Telemetry (Zero Redis)
 *
 * Enforces:
 *   - Durable queue health is derived strictly from PostgreSQL public.email_outbox.
 *   - Process metrics (cycle time, count, last cycle) are tracked ephemerally in memory.
 *   - Zero PII: outputs operational aggregates only.
 */

import { postgres } from '../utils/postgres.ts';

export interface ProcessMetrics {
  worker_last_cycle_at: string | null;
  worker_cycle_duration_ms: number;
  worker_cycles_total: number;
  worker_is_running: boolean;
}

export interface QueueHealthMetrics {
  queue_depth: number;
  processing_count: number;
  retry_count: number;
  failed_count_24h: number;
  sent_count_24h: number;
  oldest_pending_age_seconds: number | null;
}

export interface NotificationHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  process: ProcessMetrics;
  queue: QueueHealthMetrics;
}

// In-memory ephemeral process stats
const processStats: ProcessMetrics = {
  worker_last_cycle_at: null,
  worker_cycle_duration_ms: 0,
  worker_cycles_total: 0,
  worker_is_running: false,
};

export function recordWorkerCycleStart(): void {
  processStats.worker_is_running = true;
}

export function recordWorkerCycleComplete(durationMs: number): void {
  processStats.worker_is_running = false;
  processStats.worker_cycle_duration_ms = durationMs;
  processStats.worker_cycles_total += 1;
  processStats.worker_last_cycle_at = new Date().toISOString();
}

/**
 * Derives queue health aggregates directly from public.email_outbox.
 * Zero PII: counts and age only.
 */
export async function getQueueHealthMetrics(): Promise<QueueHealthMetrics> {
  const fallback: QueueHealthMetrics = {
    queue_depth: 0,
    processing_count: 0,
    retry_count: 0,
    failed_count_24h: 0,
    sent_count_24h: 0,
    oldest_pending_age_seconds: null,
  };

  if (!postgres) return fallback;

  try {
    const result = await postgres.query<{
      queue_depth: string;
      processing_count: string;
      retry_count: string;
      failed_count_24h: string;
      sent_count_24h: string;
      oldest_pending_age_seconds: string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('PENDING', 'RETRY')) AS queue_depth,
         count(*) FILTER (WHERE status = 'PROCESSING') AS processing_count,
         count(*) FILTER (WHERE status = 'RETRY') AS retry_count,
         count(*) FILTER (WHERE status = 'FAILED' AND updated_at >= now() - interval '24 hours') AS failed_count_24h,
         count(*) FILTER (WHERE status = 'SENT' AND updated_at >= now() - interval '24 hours') AS sent_count_24h,
         COALESCE(
           EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status IN ('PENDING', 'RETRY'))))::integer,
           NULL
         ) AS oldest_pending_age_seconds
       FROM public.email_outbox`,
    );

    const row = result.rows[0];
    if (!row) return fallback;

    return {
      queue_depth: parseInt(row.queue_depth ?? '0', 10),
      processing_count: parseInt(row.processing_count ?? '0', 10),
      retry_count: parseInt(row.retry_count ?? '0', 10),
      failed_count_24h: parseInt(row.failed_count_24h ?? '0', 10),
      sent_count_24h: parseInt(row.sent_count_24h ?? '0', 10),
      oldest_pending_age_seconds:
        row.oldest_pending_age_seconds !== null
          ? parseInt(row.oldest_pending_age_seconds, 10)
          : null,
    };
  } catch (err) {
    console.error('[NotificationTelemetry] Failed to query queue health:', err);
    return fallback;
  }
}

/**
 * Evaluates overall notification subsystem health.
 */
export async function getNotificationHealthReport(): Promise<NotificationHealthReport> {
  const queue = await getQueueHealthMetrics();
  const process = { ...processStats };

  // Status heuristic:
  // - unhealthy: oldest pending email > 1 hour or worker hasn't run in 10 minutes (and queue > 0)
  // - degraded: retry count > 20 or failed count > 50
  // - healthy: normal flow
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (
    (queue.oldest_pending_age_seconds !== null && queue.oldest_pending_age_seconds > 3600) ||
    (queue.queue_depth > 0 &&
      process.worker_last_cycle_at &&
      Date.now() - new Date(process.worker_last_cycle_at).getTime() > 600_000)
  ) {
    status = 'unhealthy';
  } else if (queue.retry_count > 20 || queue.failed_count_24h > 50) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    process,
    queue,
  };
}
