/**
 * NOTIFY-001 / NOTIFY-002 Backward Compatibility Alias
 *
 * Re-exports ResendEmailProvider as ResendProvider.
 */

import { ResendEmailProvider } from './resendEmailProvider.ts';

export class ResendProvider extends ResendEmailProvider {
  // Alias for backward compatibility
}
