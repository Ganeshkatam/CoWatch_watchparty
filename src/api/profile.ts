import { getAccessToken } from "../utils/supabaseClient";
import { serverPath } from "../utils/utils";

export interface ProfileData {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  pref_show_chat_column: boolean;
  pref_show_people_column: boolean;
  pref_disable_chat_sound: boolean;
  pref_camera_on: boolean;
  pref_mic_on: boolean;
  pref_appearance_mode: "light" | "mantine" | "system";
  terms_agreed_at: string | null;
  age_verified_at: string | null;
  updated_at?: string;
}

export interface PublicProfileData {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiError("UNAUTHENTICATED", "Active authentication session is required", 401);
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Fetches canonical profile for the authenticated user from CoWatch backend.
 * Automatically self-heals in PostgreSQL if this is the user's first login.
 */
export async function fetchUserProfile(signal?: AbortSignal): Promise<ProfileData> {
  const authHeaders = await getAuthHeader();
  const res = await fetch(`${serverPath}/api/profile`, {
    headers: {
      ...authHeaders,
      Accept: "application/json",
    },
    signal,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const code = errorData?.error?.code || `HTTP_${res.status}`;
    const message = errorData?.error?.message || "Failed to load user profile";
    throw new ApiError(code, message, res.status);
  }

  const data = await res.json();
  if (!data?.profile) {
    throw new ApiError("INVALID_RESPONSE", "Server response missing profile data", 500);
  }
  return data.profile;
}

/**
 * Updates profile attributes authoritatively on the backend.
 * Employs column-level mutations to prevent lost updates.
 */
export async function updateUserProfile(
  updates: Partial<Omit<ProfileData, "id" | "created_at" | "terms_agreed_at" | "age_verified_at">>,
  signal?: AbortSignal
): Promise<ProfileData> {
  const authHeaders = await getAuthHeader();
  const res = await fetch(`${serverPath}/api/profile`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(updates),
    signal,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const code = errorData?.error?.code || `HTTP_${res.status}`;
    const message = errorData?.error?.message || "Failed to update profile";
    throw new ApiError(code, message, res.status);
  }

  const data = await res.json();
  if (!data?.profile) {
    throw new ApiError("INVALID_RESPONSE", "Server response missing updated profile data", 500);
  }
  return data.profile;
}

/**
 * Resolves non-sensitive public profile projection for a specific user ID.
 */
export async function fetchPublicProfile(
  userId: string,
  signal?: AbortSignal
): Promise<PublicProfileData> {
  const authHeaders = await getAuthHeader();
  const res = await fetch(`${serverPath}/api/users/${encodeURIComponent(userId)}/public-profile`, {
    headers: {
      ...authHeaders,
      Accept: "application/json",
    },
    signal,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const code = errorData?.error?.code || `HTTP_${res.status}`;
    const message = errorData?.error?.message || "Failed to load public profile";
    throw new ApiError(code, message, res.status);
  }

  const data = await res.json();
  if (!data?.profile) {
    throw new ApiError("INVALID_RESPONSE", "Server response missing public profile data", 500);
  }
  return data.profile;
}
