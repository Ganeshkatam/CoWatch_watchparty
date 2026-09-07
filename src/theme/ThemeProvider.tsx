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

const resolveInitialScheme = (mode: AppearanceMode): "light" | "dark" => {
  if (mode === "light") return "light";
  if (mode === "mantine") return "dark";
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
};

export const ThemeProvider = ({
  children,
  userAppearance,
  onAppearanceChange,
}: ThemeProviderProps) => {
  // LocalStorage is authoritative for this browser session
  const [appearance, setAppearanceInternal] = useState<AppearanceMode>(() => {
    if (typeof window !== "undefined") {
      const local = localStorage.getItem("cowatch-appearance");
      if (local === "light" || local === "mantine" || local === "system") {
        return local as AppearanceMode;
      }
    }
    if (userAppearance && (userAppearance === "light" || userAppearance === "mantine" || userAppearance === "system")) {
      return userAppearance;
    }
    return "system";
  });

  const [resolvedColorScheme, setResolvedColorScheme] = useState<"light" | "dark">(() => {
    return resolveInitialScheme(appearance);
  });

  // Sync with userAppearance prop from DB ONLY if user has not explicitly set a local preference
  useEffect(() => {
    if (userAppearance) {
      const local = typeof window !== "undefined" ? localStorage.getItem("cowatch-appearance") : null;
      if (!local && (userAppearance === "light" || userAppearance === "mantine" || userAppearance === "system")) {
        setAppearanceInternal(userAppearance);
        try {
          localStorage.setItem("cowatch-appearance", userAppearance);
        } catch (e) {}
      }
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
    try {
      localStorage.setItem("cowatch-appearance", mode);
    } catch (e) {}
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
