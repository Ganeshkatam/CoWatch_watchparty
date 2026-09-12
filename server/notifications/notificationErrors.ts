/**
 * NOTIFY-001 Notification Error Classes
 */

export class NotificationNotFoundError extends Error {
  readonly code = 'NOTIFICATION_NOT_FOUND';
  constructor(id: string) {
    super(`Notification not found: ${id}`);
    this.name = 'NotificationNotFoundError';
  }
}

export class NotificationUnauthorizedError extends Error {
  readonly code = 'NOTIFICATION_UNAUTHORIZED';
  constructor(message = 'Notification mutation not authorized for this user') {
    super(message);
    this.name = 'NotificationUnauthorizedError';
  }
}

export class NotificationDeliveryError extends Error {
  readonly code: string;
  readonly isRetryable: boolean;
  constructor(message: string, code = 'DELIVERY_ERROR', retryable = true) {
    super(message);
    this.name = 'NotificationDeliveryError';
    this.code = code;
    this.isRetryable = retryable;
  }
}

export class NotificationPreferencesNotFoundError extends Error {
  readonly code = 'PREFERENCES_NOT_FOUND';
  constructor(userId: string) {
    super(`Notification preferences not found for user: ${userId}`);
    this.name = 'NotificationPreferencesNotFoundError';
  }
}
