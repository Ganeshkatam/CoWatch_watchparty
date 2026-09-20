import React, { useMemo, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  IconHome,
  IconDeviceTv,
  IconPlus,
  IconUser,
  IconUsers,
  IconHelpCircle,
  IconSparkles,
  IconLogin,
} from "@tabler/icons-react";
import { useAuth } from "../../context/AuthContext";
import { isBottomNavVisible, isRouteActive } from "./navigationPolicy";
import {
  CircularNavigationWheel,
  WheelNavigationItem,
} from "./CircularNavigationWheel";

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);

    setIsMobileViewport(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } else {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  const isVisible = isBottomNavVisible(location.pathname);

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
          id: "myrooms",
          label: "My Rooms",
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
          id: "join",
          label: "Join",
          icon: IconUsers,
          href: "/join",
          isActive: isRouteActive(location.pathname, "/join", false),
          ariaLabel: "Join a Watch Party Room",
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
        id: "signup",
        label: "Sign Up",
        icon: IconSparkles,
        href: "/signup",
        isActive: isRouteActive(location.pathname, "/signup", true),
        ariaLabel: "Create Account / Sign Up",
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
        id: "join",
        label: "Join",
        icon: IconUsers,
        href: "/join",
        isActive: isRouteActive(location.pathname, "/join", false),
        ariaLabel: "Join a Watch Party Room",
      },
    ];
  }, [user, location.pathname, isMobileViewport]);

  if (!isVisible || !isMobileViewport) {
    return null;
  }

  return (
    <CircularNavigationWheel
      items={navigationItems}
      currentLocationPath={location.pathname}
    />
  );
};
