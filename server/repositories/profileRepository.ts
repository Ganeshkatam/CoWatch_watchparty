import { postgres, type PostgresClient } from "../utils/postgres.ts";

export interface ProfileRow {
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
  updated_at: string;
}

export interface PublicProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

const SELECT_PROFILE_COLUMNS = `
  id,
  display_name,
  username,
  avatar_url,
  pref_show_chat_column,
  pref_show_people_column,
  pref_disable_chat_sound,
  pref_camera_on,
  pref_mic_on,
  pref_appearance_mode,
  terms_agreed_at,
  age_verified_at,
  updated_at
`;

export class ProfileRepository {
  private getDb(client?: PostgresClient): PostgresClient {
    const db = client || postgres;
    if (!db) {
      const err = new Error("PostgreSQL client unavailable");
      (err as any).code = "SERVICE_UNAVAILABLE";
      throw err;
    }
    return db;
  }

  /**
   * Retrieves a profile by user ID.
   */
  async getProfileById(userId: string, client?: PostgresClient): Promise<ProfileRow | null> {
    const db = this.getDb(client);
    const result = await db.query<ProfileRow>(
      `SELECT ${SELECT_PROFILE_COLUMNS}
       FROM public.profiles
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Atomically inserts a profile record if absent using ON CONFLICT (id) DO NOTHING.
   * Returns true if a new row was inserted, false if a conflict occurred.
   */
  async atomicInsertProfile(
    userId: string,
    displayName: string,
    username: string,
    avatarUrl: string | null,
    client?: PostgresClient
  ): Promise<boolean> {
    const db = this.getDb(client);
    const result = await db.query(
      `INSERT INTO public.profiles (id, display_name, username, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [userId, displayName, username, avatarUrl]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Updates specified columns directly in public.profiles.
   * Column-level concurrency safe; never does full-row replacement.
   */
  async updateProfileColumns(
    userId: string,
    columns: Record<string, any>,
    client?: PostgresClient
  ): Promise<ProfileRow | null> {
    const db = this.getDb(client);
    const keys = Object.keys(columns);
    if (keys.length === 0) {
      return this.getProfileById(userId, client);
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const key of keys) {
      setClauses.push(`"${key}" = $${idx++}`);
      values.push(columns[key]);
    }
    setClauses.push(`updated_at = now()`);
    values.push(userId);

    const query = `
      UPDATE public.profiles
      SET ${setClauses.join(", ")}
      WHERE id = $${idx}
      RETURNING ${SELECT_PROFILE_COLUMNS}
    `;

    const result = await db.query<ProfileRow>(query, values);
    return result.rows[0] || null;
  }

  /**
   * Retrieves non-sensitive public profile projection by user ID.
   */
  async getPublicProfileById(userId: string, client?: PostgresClient): Promise<PublicProfileRow | null> {
    const db = this.getDb(client);
    const result = await db.query<PublicProfileRow>(
      `SELECT id, display_name, username, avatar_url
       FROM public.public_profiles
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }
}

export const profileRepository = new ProfileRepository();
