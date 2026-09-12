/**
 * FEEDBACK-004: Privacy-Preserving Feedback Telemetry & Observability
 *
 * Invariant:
 * Pure in-memory counters with zero Redis dependencies (0 Redis commands).
 * NEVER stores or logs feedback message text, request bodies, JWTs, session IDs,
 * room IDs, or participant IDs.
 */

export interface FeedbackTelemetryMetrics {
  submissionsTotal: number;
  submissionsSuccess: number;
  submissionsDeduped: number;
  submissionsRateLimited: number;
  submissionsValidationFailed: number;
  submissionsDbFailed: number;
  reviewUpdatesTotal: number;
  reviewConflicts409: number;
  avgLatencyMs: number;
  latencyCount: number;
}

class FeedbackTelemetryCollector {
  private submissionsTotal = 0;
  private submissionsSuccess = 0;
  private submissionsDeduped = 0;
  private submissionsRateLimited = 0;
  private submissionsValidationFailed = 0;
  private submissionsDbFailed = 0;
  private reviewUpdatesTotal = 0;
  private reviewConflicts409 = 0;
  private totalLatencyMs = 0;
  private latencyCount = 0;

  public recordSubmissionAttempt(): void {
    this.submissionsTotal++;
  }

  public recordSubmissionSuccess(deduped = false, latencyMs = 0): void {
    this.submissionsSuccess++;
    if (deduped) {
      this.submissionsDeduped++;
    }
    if (latencyMs > 0) {
      this.totalLatencyMs += latencyMs;
      this.latencyCount++;
    }
  }

  public recordRateLimitDrop(): void {
    this.submissionsRateLimited++;
  }

  public recordValidationFailure(): void {
    this.submissionsValidationFailed++;
  }

  public recordDbFailure(): void {
    this.submissionsDbFailed++;
  }

  public recordReviewUpdate(conflict = false): void {
    this.reviewUpdatesTotal++;
    if (conflict) {
      this.reviewConflicts409++;
    }
  }

  public getMetrics(): FeedbackTelemetryMetrics {
    return {
      submissionsTotal: this.submissionsTotal,
      submissionsSuccess: this.submissionsSuccess,
      submissionsDeduped: this.submissionsDeduped,
      submissionsRateLimited: this.submissionsRateLimited,
      submissionsValidationFailed: this.submissionsValidationFailed,
      submissionsDbFailed: this.submissionsDbFailed,
      reviewUpdatesTotal: this.reviewUpdatesTotal,
      reviewConflicts409: this.reviewConflicts409,
      avgLatencyMs: this.latencyCount > 0 ? Math.round((this.totalLatencyMs / this.latencyCount) * 100) / 100 : 0,
      latencyCount: this.latencyCount,
    };
  }

  public resetForTesting(): void {
    this.submissionsTotal = 0;
    this.submissionsSuccess = 0;
    this.submissionsDeduped = 0;
    this.submissionsRateLimited = 0;
    this.submissionsValidationFailed = 0;
    this.submissionsDbFailed = 0;
    this.reviewUpdatesTotal = 0;
    this.reviewConflicts409 = 0;
    this.totalLatencyMs = 0;
    this.latencyCount = 0;
  }
}

export const feedbackTelemetry = new FeedbackTelemetryCollector();
