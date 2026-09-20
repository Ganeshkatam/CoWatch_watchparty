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
export const MIN_RADIUS = 120;
export const MAX_RADIUS = 144;
export const DEFAULT_RADIUS = 132;
export const DOCK_HOVER_RADIUS = 36;
export const WHEEL_HOVER_RADIUS_PADDING = 48;

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
 * Evenly distributes items across the symmetrical 90-degree quadrant (-90deg to -180deg).
 */
export function getOrbitItemAngle(index: number, total: number): number {
  if (total <= 1) return (-135 * Math.PI) / 180;
  const startAngle = (-90 * Math.PI) / 180;
  const endAngle = (-180 * Math.PI) / 180;
  return startAngle + (index / (total - 1)) * (endAngle - startAngle);
}

/**
 * Validates whether pointer coordinates relative to dock center are within
 * the allowed circular quadrant hover boundary.
 *
 * @param dx Horizontal offset from dock center (clientX - hubCenterX)
 * @param dy Vertical offset from dock center (clientY - hubCenterY)
 * @param radius Current active wheel orbit radius
 * @param padding Maximum padding beyond the orbit radius (defaults to WHEEL_HOVER_RADIUS_PADDING)
 */
export function isPointerWithinWheelRadius(
  dx: number,
  dy: number,
  radius: number,
  padding = WHEEL_HOVER_RADIUS_PADDING
): boolean {
  const maxRadius = radius + padding;
  const distance = Math.hypot(dx, dy);

  if (distance > maxRadius) {
    return false;
  }

  // Corner bounds: Wheel is anchored at bottom-right expanding top-left.
  // The center is 53px from bottom and right viewport edges.
  // Allow margin up to the viewport edge.
  if (dx > 56 || dy > 56) {
    return false;
  }

  return true;
}

/**
 * Checks whether pointer coordinates are within the center dock trigger circle.
 */
export function isPointerWithinDockRadius(
  dx: number,
  dy: number,
  dockRadius = DOCK_HOVER_RADIUS
): boolean {
  return Math.hypot(dx, dy) <= dockRadius;
}


