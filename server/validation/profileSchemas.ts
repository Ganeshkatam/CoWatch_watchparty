import config from "../config.ts";

export interface ProfilePatchInput {
  display_name?: string;
  username?: string;
  avatar_url?: string | null;
  pref_show_chat_column?: boolean;
  pref_show_people_column?: boolean;
  pref_disable_chat_sound?: boolean;
  pref_camera_on?: boolean;
  pref_mic_on?: boolean;
  pref_appearance_mode?: "light" | "mantine" | "system";
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

const ALLOWED_PATCH_FIELDS = new Set<string>([
  "display_name",
  "username",
  "avatar_url",
  "pref_show_chat_column",
  "pref_show_people_column",
  "pref_disable_chat_sound",
  "pref_camera_on",
  "pref_mic_on",
  "pref_appearance_mode",
]);

const PROTECTED_FIELDS = new Set<string>([
  "id",
  "created_at",
  "updated_at",
  "terms_agreed_at",
  "age_verified_at",
  "email",
  "role",
]);

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Returns permitted avatar storage origins derived from server configuration.
 */
export function getAllowedAvatarOrigins(): Set<string> {
  const allowed = new Set<string>();

  if (config.SUPABASE_URL) {
    try {
      const url = new URL(config.SUPABASE_URL);
      allowed.add(url.origin.toLowerCase());
      allowed.add(url.hostname.toLowerCase());
    } catch {
      // invalid SUPABASE_URL config
    }
  }

  // Default fallback for development/testing if supabase is mocked or local
  allowed.add("localhost");
  allowed.add("127.0.0.1");

  if (process.env.ALLOWED_AVATAR_ORIGINS) {
    process.env.ALLOWED_AVATAR_ORIGINS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((origin) => {
        try {
          if (origin.startsWith("http://") || origin.startsWith("https://")) {
            const parsed = new URL(origin);
            allowed.add(parsed.origin.toLowerCase());
            allowed.add(parsed.hostname.toLowerCase());
          } else {
            allowed.add(origin);
          }
        } catch {
          allowed.add(origin);
        }
      });
  }

  return allowed;
}

/**
 * Validates whether an avatar URL complies with origin security policy.
 */
export function isValidAvatarUrl(urlStr: string): boolean {
  if (!urlStr || urlStr.length > 2048) return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    // Only allow HTTP on localhost
    if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return false;
    }

    const allowed = getAllowedAvatarOrigins();
    const origin = parsed.origin.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    return allowed.has(origin) || allowed.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Validates a UUID v4 string.
 */
export function isValidUuid(id: string): boolean {
  if (typeof id !== "string") return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Validates the body of a PATCH /api/profile request.
 * Enforces explicit rejection of unknown and protected fields.
 */
export function validateProfilePatch(body: any): ValidationResult<ProfilePatchInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      success: false,
      error: {
        code: "INVALID_BODY",
        message: "Request body must be a valid JSON object",
      },
    };
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return {
      success: false,
      error: {
        code: "EMPTY_PATCH_PAYLOAD",
        message: "At least one profile attribute must be provided for update",
      },
    };
  }

  // 1. Strict unknown & protected field verification
  for (const key of keys) {
    if (PROTECTED_FIELDS.has(key)) {
      return {
        success: false,
        error: {
          code: "PROTECTED_FIELD_REJECTED",
          message: `Field "${key}" is protected and cannot be modified via profile update`,
        },
      };
    }
    if (!ALLOWED_PATCH_FIELDS.has(key)) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_FIELD_REJECTED",
          message: `Field "${key}" is not a recognized profile attribute`,
        },
      };
    }
  }

  const sanitized: ProfilePatchInput = {};

  // 2. Attribute-specific validations
  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string") {
      return {
        success: false,
        error: {
          code: "INVALID_DISPLAY_NAME",
          message: "display_name must be a string",
        },
      };
    }
    const trimmed = body.display_name.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      return {
        success: false,
        error: {
          code: "INVALID_DISPLAY_NAME_LENGTH",
          message: "display_name must be between 1 and 50 characters",
        },
      };
    }
    sanitized.display_name = trimmed;
  }

  if (body.username !== undefined) {
    if (typeof body.username !== "string") {
      return {
        success: false,
        error: {
          code: "INVALID_USERNAME",
          message: "username must be a string",
        },
      };
    }
    const trimmed = body.username.trim();
    if (!USERNAME_REGEX.test(trimmed)) {
      return {
        success: false,
        error: {
          code: "INVALID_USERNAME_FORMAT",
          message: "username must be 3-30 characters long and contain only letters, numbers, underscores, and dashes",
        },
      };
    }
    sanitized.username = trimmed;
  }

  if (body.avatar_url !== undefined) {
    if (body.avatar_url === null) {
      sanitized.avatar_url = null;
    } else if (typeof body.avatar_url === "string") {
      const trimmed = body.avatar_url.trim();
      if (!isValidAvatarUrl(trimmed)) {
        return {
          success: false,
          error: {
            code: "INVALID_AVATAR_URL",
            message: "avatar_url must be null or a valid HTTPS URL originating from an authorized storage host",
          },
        };
      }
      sanitized.avatar_url = trimmed;
    } else {
      return {
        success: false,
        error: {
          code: "INVALID_AVATAR_URL",
          message: "avatar_url must be a string or null",
        },
      };
    }
  }

  if (body.pref_appearance_mode !== undefined) {
    if (!["light", "mantine", "system"].includes(body.pref_appearance_mode)) {
      return {
        success: false,
        error: {
          code: "INVALID_APPEARANCE_MODE",
          message: "pref_appearance_mode must be one of: 'light', 'mantine', 'system'",
        },
      };
    }
    sanitized.pref_appearance_mode = body.pref_appearance_mode;
  }

  const booleanPrefs = [
    "pref_show_chat_column",
    "pref_show_people_column",
    "pref_disable_chat_sound",
    "pref_camera_on",
    "pref_mic_on",
  ] as const;

  for (const pref of booleanPrefs) {
    if (body[pref] !== undefined) {
      if (typeof body[pref] !== "boolean") {
        return {
          success: false,
          error: {
            code: "INVALID_BOOLEAN_PREFERENCE",
            message: `${pref} must be a boolean value`,
          },
        };
      }
      sanitized[pref] = body[pref];
    }
  }

  return {
    success: true,
    data: sanitized,
  };
}
