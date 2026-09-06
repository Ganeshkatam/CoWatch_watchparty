export type AppearanceMode = "light" | "mantine" | "system";

export interface AppearanceContextValue {
  appearance: AppearanceMode;
  resolvedColorScheme: "light" | "dark";
  setAppearance: (appearance: AppearanceMode) => void;
}
