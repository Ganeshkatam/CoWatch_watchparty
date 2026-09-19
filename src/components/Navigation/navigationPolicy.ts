import { matchPath } from "react-router-dom";

export interface RouteVisibilityRule {
  path: string;
  exact?: boolean;
}

export const HIDDEN_BOTTOM_NAV_ROUTES: RouteVisibilityRule[] = [
  { path: "/watch/:roomId", exact: false },
  { path: "/login", exact: true },
  { path: "/signup", exact: true },
  { path: "/forgot-password", exact: true },
  { path: "/reset-password", exact: true },
  { path: "/verify-email", exact: true },
  { path: "/preflight/:roomId", exact: false },
];

/**
 * Determines whether the mobile bottom navigation bar should be visible
 * based on the current pathname.
 */
export function isBottomNavVisible(pathname: string): boolean {
  for (const rule of HIDDEN_BOTTOM_NAV_ROUTES) {
    if (matchPath(pathname, { path: rule.path, exact: rule.exact ?? true })) {
      return false;
    }
  }
  return true;
}

/**
 * Route-aware matching helper using React Router semantics.
 * By default, requires exact path matching to prevent false positives
 * (e.g., /room/:roomId activating the /myrooms tab).
 */
export function isRouteActive(
  pathname: string,
  targetPath: string,
  exact = true
): boolean {
  const match = matchPath(pathname, { path: targetPath, exact });
  return Boolean(match);
}

/* ==========================================================================
   WHEEL NAVIGATION CONFIGURATION & MATHEMATICAL HELPERS
   ========================================================================== */

export const HOLD_THRESHOLD_MS = 180;
export const MOVE_JITTER_TOLERANCE_PX = 8;
export const MIN_RADIUS = 72;
export const MAX_RADIUS = 100;
export const DEFAULT_RADIUS = 82;

export interface WheelNavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; stroke?: number | string; className?: string }>;
  href?: string;
  action?: () => void;
  isActive: boolean;
  ariaLabel: string;
}

export function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a < -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % (2 * Math.PI);
  return diff > Math.PI ? 2 * Math.PI - diff : diff;
}

/**
 * Calculates the stationary radial angle for an orbiting item.
 * Fans out upward and leftward into the viewport from -82deg to -182deg
 * so every option is 100% on screen, stationary, and easily accessible.
 */
export function getOrbitItemAngle(index: number, total: number): number {
  if (total <= 1) return -Math.PI / 2;
  const startAngle = (-82 * Math.PI) / 180;
  const endAngle = (-182 * Math.PI) / 180;
  return startAngle + (index / (total - 1)) * (endAngle - startAngle);
}


