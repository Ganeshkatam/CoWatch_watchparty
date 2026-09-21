/**
 * PUB-SURF-02: Client Abuse Report Submission Helper
 *
 * Invariants:
 * 1. Server-authoritative write path: Never writes to abuse_reports directly from browser.
 * 2. Mandatory JWT: Must provide valid authenticated bearer token.
 * 3. Sanitized error handling.
 */

import { apiFetch, ApiError } from "./utils.js";

export type AbuseReportCategory =
  | "harassment"
  | "spam"
  | "hate_speech"
  | "inappropriate_content"
  | "copyright"
  | "other";

export interface AbuseReportPayload {
  category: AbuseReportCategory;
  reason: string;
  targetUserId?: string | null;
  targetRoomId?: string | null;
  context?: Record<string, any>;
}

export interface AbuseReportResult {
  success: boolean;
  error?: string;
  reportId?: string;
}

export interface AbuseReportApiResponse {
  success: boolean;
  reportId?: string;
  createdAt?: string;
  error?: string;
}

export async function submitAbuseReport(
  payload: AbuseReportPayload
): Promise<AbuseReportResult> {
  const reasonText = (payload.reason || "").trim();
  if (reasonText.length < 5) {
    return {
      success: false,
      error: "Please provide a detailed explanation of at least 5 characters.",
    };
  }

  if (reasonText.length > 1000) {
    return {
      success: false,
      error: "Explanation must be under 1000 characters.",
    };
  }

  if (!payload.targetUserId && !payload.targetRoomId) {
    return {
      success: false,
      error: "A target user or room must be specified for the report.",
    };
  }

  try {
    const data = await apiFetch<AbuseReportApiResponse>("/api/reports/abuse", {
      method: "POST",
      requireAuth: true,
      body: {
        category: payload.category,
        reason: reasonText,
        targetUserId: payload.targetUserId || undefined,
        targetRoomId: payload.targetRoomId || undefined,
        context: payload.context || {},
      },
    });

    return {
      success: true,
      reportId: data?.reportId,
    };
  } catch (err: any) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        return {
          success: false,
          error: "You must be signed in to submit an abuse report.",
        };
      }
      return {
        success: false,
        error: err.message || `Failed to submit report (status: ${err.status})`,
      };
    }
    return {
      success: false,
      error: err?.message || "Network error while submitting report.",
    };
  }
}
