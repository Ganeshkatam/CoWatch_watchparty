/**
 * FEEDBACK-001: Client Feedback Submission & Operation Coordinator Integration
 *
 * Invariants:
 * 1. Decoupled Transport: Sends directly to HTTP POST /api/feedback. Never depends on Socket.IO health.
 * 2. Privacy Boundary: Never attaches passcodes, raw errors, or internal IDs.
 * 3. Lifecycle Tracking: Uses OperationCoordinator (domain: "feedback").
 * 4. Sanitized Responses: Returns canonical UserMessage objects.
 */

import { operationCoordinator } from "./operationState";
import {
  USER_MESSAGES,
  type FeedbackPayload,
  type UserMessage,
} from "./userMessages";
import { safeGetSession } from "./supabaseClient";
import { createUuid } from "./utils";

export interface FeedbackSubmissionResult {
  success: boolean;
  userMessage: UserMessage;
  feedbackId?: string;
  deduped?: boolean;
}

export async function submitUserFeedback(
  payload: FeedbackPayload
): Promise<FeedbackSubmissionResult> {
  const messageText = (payload.message || "").trim();
  if (!messageText) {
    return {
      success: false,
      userMessage: USER_MESSAGES.FEEDBACK_MESSAGE_EMPTY,
    };
  }

  const idempotencyKey = payload.idempotency_key || createUuid();

  const opId = operationCoordinator.startOperation("feedback", "submit", undefined, {
    timeoutMs: 12000,
  });

  try {
    const sessionData = await safeGetSession();
    const token = sessionData?.data?.session?.access_token;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch("/api/feedback", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: payload.type || "bug",
        context: payload.context || "room",
        rating: payload.rating,
        message: messageText.slice(0, 2000),
        app_version: payload.app_version || "1.0.3",
        platform: payload.platform || "web",
        idempotency_key: idempotencyKey,
      }),
    });

    if (response.status === 429) {
      operationCoordinator.rejectOperation(
        opId,
        USER_MESSAGES.FEEDBACK_RATE_LIMITED.message
      );
      return {
        success: false,
        userMessage: USER_MESSAGES.FEEDBACK_RATE_LIMITED,
      };
    }

    if (response.status === 400) {
      operationCoordinator.rejectOperation(
        opId,
        USER_MESSAGES.FEEDBACK_VALIDATION_FAILED.message
      );
      return {
        success: false,
        userMessage: USER_MESSAGES.FEEDBACK_VALIDATION_FAILED,
      };
    }

    if (response.status === 503 || response.status === 500) {
      operationCoordinator.rejectOperation(
        opId,
        USER_MESSAGES.FEEDBACK_SERVICE_UNAVAILABLE.message
      );
      return {
        success: false,
        userMessage: USER_MESSAGES.FEEDBACK_SERVICE_UNAVAILABLE,
      };
    }

    if (!response.ok) {
      operationCoordinator.rejectOperation(
        opId,
        USER_MESSAGES.FEEDBACK_SUBMIT_FAILED.message
      );
      return {
        success: false,
        userMessage: USER_MESSAGES.FEEDBACK_SUBMIT_FAILED,
      };
    }

    const data = await response.json();
    operationCoordinator.resolveOperation(opId);

    return {
      success: true,
      userMessage: USER_MESSAGES.FEEDBACK_SUBMIT_SUCCESS,
      feedbackId: data.id,
      deduped: Boolean(data.deduped),
    };
  } catch (err) {
    console.warn("Feedback HTTP request failure:", err);
    operationCoordinator.rejectOperation(
      opId,
      USER_MESSAGES.FEEDBACK_SUBMIT_FAILED.message
    );
    return {
      success: false,
      userMessage: USER_MESSAGES.FEEDBACK_SUBMIT_FAILED,
    };
  }
}
