import React, { createContext, useContext, useEffect, useState } from "react";
import { AppearanceMode, AppearanceContextValue } from "./types";

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

export const useAppearance = () => {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used within an AppearanceProvider");
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
  userAppearance?: AppearanceMode;
  onAppearanceChange?: (appearance: AppearanceMode) => void;
}

export const ThemeProvider = ({
  children,
  userAppearance,
  onAppearanceChange,
}: ThemeProviderProps) => {
  // Try to get initial appearance from localStorage or fallback to system
  const [appearance, setAppearanceInternal] = useState<AppearanceMode>(() => {
    if (userAppearance) return userAppearance;
    const local = localStorage.getItem("cowatch-appearance");
    if (local === "light" || local === "mantine" || local === "system") {
      return local;
    }
    return "system";
  });

  const [resolvedColorScheme, setResolvedColorScheme] = useState<"light" | "dark">("dark");

  // Sync with userAppearance prop if it loads from Supabase
  useEffect(() => {
    if (userAppearance) {
      setAppearanceInternal(userAppearance);
    }
  }, [userAppearance]);

  // Resolve color scheme and update HTML data attribute
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const resolveAndApply = () => {
      let scheme: "light" | "dark" = "dark";
      if (appearance === "light") {
        scheme = "light";
      } else if (appearance === "mantine") {
        scheme = "dark";
      } else {
        scheme = mediaQuery.matches ? "dark" : "light";
      }
      
      setResolvedColorScheme(scheme);
      document.documentElement.setAttribute("data-color-scheme", scheme);
    };

    resolveAndApply();

    // Listen for system preference changes
    const listener = () => {
      if (appearance === "system") {
        resolveAndApply();
      }
    };

    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [appearance]);

  const setAppearance = (mode: AppearanceMode) => {
    setAppearanceInternal(mode);
    localStorage.setItem("cowatch-appearance", mode);
    if (onAppearanceChange) {
      onAppearanceChange(mode);
    }
  };

  return (
    <AppearanceContext.Provider value={{ appearance, resolvedColorScheme, setAppearance }}>
      {children}
    </AppearanceContext.Provider>
  );
};
