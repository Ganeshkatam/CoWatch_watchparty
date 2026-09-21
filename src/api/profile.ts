import { apiFetch, ApiError } from "../utils/utils";

export { ApiError };

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

/**
 * Fetches canonical profile for the authenticated user from CoWatch backend.
 * Automatically self-heals in PostgreSQL if this is the user's first login.
 */
export async function fetchUserProfile(signal?: AbortSignal): Promise<ProfileData> {
  const data = await apiFetch<{ profile: ProfileData }>("/api/profile", {
    requireAuth: true,
    signal,
  });
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
  const data = await apiFetch<{ profile: ProfileData }>("/api/profile", {
    method: "PATCH",
    body: updates,
    requireAuth: true,
    signal,
  });
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
  const data = await apiFetch<{ profile: PublicProfileData }>(
    `/api/users/${encodeURIComponent(userId)}/public-profile`,
    {
      requireAuth: true,
      signal,
    }
  );
  if (!data?.profile) {
    throw new ApiError("INVALID_RESPONSE", "Server response missing public profile data", 500);
  }
  return data.profile;
}

