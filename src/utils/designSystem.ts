/**
 * FRONTEND-003: Visual System & Layout Contracts
 *
 * Single Source of Truth for component layout constraints and modal sizing tiers.
 * Visual components consume these constants for sizing constraints while CSS variables
 * define rendering tokens.
 */

export const MODAL_SIZES = {
  sm: 420, // Confirmations, alerts, host assignment, error dialogs, passcode prompt
  md: 520, // Standard configuration, settings, feedback, invites, audio/video device selection
  lg: 680, // Complex editing, room details, virtual browser, multi-stream selection
  xl: 840, // Dense management data grids, multi-tab settings
} as const;

export type ModalSizeTier = keyof typeof MODAL_SIZES;

/**
 * Returns a responsive modal size constraint ensuring no horizontal clipping on narrow viewports down to 320px/375px.
 */
export function getResponsiveModalWidth(tier: ModalSizeTier, gutterPx: number = 32): string {
  const maxPx = MODAL_SIZES[tier];
  return `min(${maxPx}px, calc(100vw - ${gutterPx}px))`;
}

/**
 * Canonical spacing tokens (in pixels) for consistent padding, margins, and gaps.
 */
export const SPACING_TOKENS = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;

/**
 * Canonical radius tokens (in pixels).
 */
export const RADIUS_TOKENS = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
} as const;

/**
 * Standard breakpoints (in pixels) for responsive design and layout boundaries.
 */
export const BREAKPOINTS = {
  xs: 375,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
} as const;
