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
  { path: "/join", exact: false },
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
 * (e.g., /rooms/:roomId activating the /rooms tab).
 */
export function isRouteActive(
  pathname: string,
  targetPath: string,
  exact = true
): boolean {
  const match = matchPath(pathname, { path: targetPath, exact });
  return Boolean(match);
}
