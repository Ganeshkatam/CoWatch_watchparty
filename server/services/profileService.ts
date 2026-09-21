import crypto from "node:crypto";
import {
  ProfileRepository,
  profileRepository,
  type ProfileRow,
  type PublicProfileRow,
} from "../repositories/profileRepository.ts";
import type { ProfilePatchInput } from "../validation/profileSchemas.ts";

export class ProfileDomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ProfileDomainError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ProfileService {
  private readonly repo: ProfileRepository;

  constructor(repo: ProfileRepository = profileRepository) {
    this.repo = repo;
  }

  /**
   * Generates a safe candidate username from display name or email.
   */
  private generateBaseUsername(displayName?: string, email?: string): string {
    const raw = (displayName || email?.split("@")[0] || "user")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    const base = raw.slice(0, 16) || "user";
    if (base.length < 3) {
      return `${base}_${crypto.randomBytes(2).toString("hex")}`;
    }
    return base;
  }

  /**
   * Retrieves user profile, or atomically self-heals by creating a default record.
   * Enforces strict fail-closed: if DB insertion or selection fails, throws an error.
   */
  async getOrSelfHealProfile(
    userId: string,
    userMetadata?: Record<string, any>,
    email?: string
  ): Promise<ProfileRow> {
    const existing = await this.repo.getProfileById(userId);
    if (existing) {
      return existing;
    }

    const defaultDisplayName =
      userMetadata?.display_name?.trim() ||
      userMetadata?.full_name?.trim() ||
      userMetadata?.name?.trim() ||
      email?.split("@")[0] ||
      "User";

    const defaultAvatarUrl =
      userMetadata?.avatar_url ||
      userMetadata?.picture ||
      null;

    const baseUsername = this.generateBaseUsername(defaultDisplayName, email);

    // Bounded retry loop for username collision during atomic self-healing
    const MAX_RETRIES = 5;
    let candidateUsername = baseUsername;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.repo.atomicInsertProfile(
          userId,
          defaultDisplayName.slice(0, 50),
          candidateUsername,
          defaultAvatarUrl
        );
        break;
      } catch (err: any) {
        if (err.code === "23505") {
          // Unique violation (e.g. username taken by concurrent user)
          const randomSuffix = crypto.randomBytes(2).toString("hex");
          candidateUsername = `${baseUsername.slice(0, 24)}_${randomSuffix}`;
          continue;
        }
        // Strict fail-closed: propagate non-uniqueness database errors
        throw err;
      }
    }

    // Authoritative select after atomic insert or ON CONFLICT
    const canonical = await this.repo.getProfileById(userId);
    if (!canonical) {
      throw new ProfileDomainError(
        "PROFILE_CREATION_FAILED",
        "Failed to load or initialize canonical user profile",
        500
      );
    }

    return canonical;
  }

  /**
   * Updates specified profile columns.
   * Concurrency-safe: column-level update, does not replace the whole row.
   */
  async updateProfile(userId: string, updates: ProfilePatchInput): Promise<ProfileRow> {
    try {
      const updated = await this.repo.updateProfileColumns(userId, updates);
      if (!updated) {
        throw new ProfileDomainError("PROFILE_NOT_FOUND", "Profile record does not exist", 404);
      }
      return updated;
    } catch (err: any) {
      if (err instanceof ProfileDomainError) {
        throw err;
      }
      // Map PostgreSQL lower(username) unique violation (23505) to 409 Conflict
      if (err.code === "23505" || err.message?.includes("profiles_username_unique")) {
        throw new ProfileDomainError(
          "USERNAME_ALREADY_EXISTS",
          "This username is already taken. Please choose another username.",
          409
        );
      }
      throw err;
    }
  }

  /**
   * Resolves non-sensitive public profile projection.
   */
  async getPublicProfile(userId: string): Promise<PublicProfileRow> {
    const publicProfile = await this.repo.getPublicProfileById(userId);
    if (!publicProfile) {
      throw new ProfileDomainError("USER_NOT_FOUND", "User profile not found", 404);
    }
    return publicProfile;
  }
}

export const profileService = new ProfileService();
