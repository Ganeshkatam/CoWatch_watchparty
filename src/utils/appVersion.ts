/**
 * Client Build & Deployment Identity
 *
 * Establishes the authoritative runtime client build information.
 * Injected during Vite compilation via `__APP_BUILD_INFO__`.
 */

export interface AppBuildInfo {
  buildId: string;
  commit: string;
  appVersion: string;
  protocolVersion: number;
  deploymentTime: string;
}

export type UpdateState = "current" | "available" | "recommended" | "required";

export interface UpdateCheckResult {
  state: UpdateState;
  current: AppBuildInfo;
  latest?: AppBuildInfo;
  checkedAt: number;
  error?: string;
}

export const FALLBACK_BUILD_INFO: AppBuildInfo = {
  buildId: "development",
  commit: "dev",
  appVersion: "1.2.2",
  protocolVersion: 1,
  deploymentTime: new Date(0).toISOString(),
};

export const CURRENT_BUILD_INFO: AppBuildInfo =
  typeof __APP_BUILD_INFO__ !== "undefined" && __APP_BUILD_INFO__
    ? __APP_BUILD_INFO__
    : FALLBACK_BUILD_INFO;
