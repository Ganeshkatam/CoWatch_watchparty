import type { User } from "@supabase/supabase-js";
import React from "react";

import type { AppearanceMode } from "./theme/types";

export const DEFAULT_STATE = {
  user: undefined as User | null | undefined,
  profile: undefined as any | null | undefined,
  displayName: "Guest",
  avatarUrl: null as string | null,
  streamPath: undefined as string | undefined,
  convertPath: undefined as string | undefined,
  beta: false,
  userAppearance: "system" as AppearanceMode,
  setMetadata: (data: any) => {},
};

export const MetadataContext = React.createContext(DEFAULT_STATE);
