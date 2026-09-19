import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  IconHome,
  IconDeviceTv,
  IconPlus,
  IconUser,
  IconSun,
  IconMoon,
  IconHelpCircle,
  IconSparkles,
  IconLogin,
} from "@tabler/icons-react";
import { useAuth } from "../../context/AuthContext";
import { useAppearance } from "../../theme/ThemeProvider";
import { isBottomNavVisible, isRouteActive } from "./navigationPolicy";
import {
  CircularNavigationWheel,
  WheelNavigationItem,
} from "./CircularNavigationWheel";

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { resolvedColorScheme, setAppearance } = useAppearance();

  const isVisible = isBottomNavVisible(location.pathname);
  const isDark = resolvedColorScheme === "dark";

  const toggleTheme = React.useCallback(() => {
    setAppearance(isDark ? "light" : "mantine");
  }, [isDark, setAppearance]);

  const themeLabel = isDark ? "Switch to light theme" : "Switch to dark theme";

  const navigationItems = useMemo<WheelNavigationItem[]>(() => {
    if (user) {
      // Authenticated destinations
      return [
        {
          id: "home",
          label: "Home",
          icon: IconHome,
          href: "/",
          isActive: isRouteActive(location.pathname, "/", true),
          ariaLabel: "Navigate to Home",
        },
        {
          id: "rooms",
          label: "Rooms",
          icon: IconDeviceTv,
          href: "/myrooms",
          isActive: isRouteActive(location.pathname, "/myrooms", true),
          ariaLabel: "Navigate to My Rooms",
        },
        {
          id: "create",
          label: "New Room",
          icon: IconPlus,
          href: "/create",
          isActive: isRouteActive(location.pathname, "/create", true),
          ariaLabel: "Create New Watch Party Room",
        },
        {
          id: "profile",
          label: "Profile",
          icon: IconUser,
          href: "/account/profile",
          isActive:
            location.pathname.startsWith("/account") ||
            isRouteActive(location.pathname, "/profile", true),
          ariaLabel: "Navigate to Account Profile",
        },
        {
          id: "theme",
          label: "Theme",
          icon: isDark ? IconSun : IconMoon,
          action: toggleTheme,
          isActive: false,
          ariaLabel: themeLabel,
        },
      ];
    }

    // Guest destinations
    return [
      {
        id: "home",
        label: "Home",
        icon: IconHome,
        href: "/",
        isActive: isRouteActive(location.pathname, "/", true),
        ariaLabel: "Navigate to Home",
      },
      {
        id: "faq",
        label: "FAQ",
        icon: IconHelpCircle,
        href: "/faq",
        isActive: isRouteActive(location.pathname, "/faq", true),
        ariaLabel: "Navigate to Frequently Asked Questions",
      },
      {
        id: "join",
        label: "Join",
        icon: IconSparkles,
        href: "/signup",
        isActive: isRouteActive(location.pathname, "/signup", true),
        ariaLabel: "Join CoWatch / Get Started",
      },
      {
        id: "signin",
        label: "Sign In",
        icon: IconLogin,
        href: "/login",
        isActive: isRouteActive(location.pathname, "/login", true),
        ariaLabel: "Sign in to CoWatch",
      },
      {
        id: "theme",
        label: "Theme",
        icon: isDark ? IconSun : IconMoon,
        action: toggleTheme,
        isActive: false,
        ariaLabel: themeLabel,
      },
    ];
  }, [user, location.pathname, isDark, toggleTheme, themeLabel]);

  if (!isVisible) {
    return null;
  }

  return (
    <CircularNavigationWheel
      items={navigationItems}
      currentLocationPath={location.pathname}
    />
  );
};
