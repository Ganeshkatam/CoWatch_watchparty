import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  IconHome,
  IconDatabase,
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
import styles from "./MobileBottomNav.module.css";

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { resolvedColorScheme, setAppearance } = useAppearance();

  if (!isBottomNavVisible(location.pathname)) {
    return null;
  }

  const isDark = resolvedColorScheme === "dark";
  const toggleTheme = () => {
    setAppearance(isDark ? "light" : "mantine");
  };

  const themeLabel = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <nav className={styles.mobileBottomNav} aria-label="Mobile Navigation">
      <div className={styles.navContainer}>
        {/* Item 1: Home */}
        {(() => {
          const isActive = isRouteActive(location.pathname, "/", true);
          return (
            <Link
              to="/"
              className={`${styles.navItem} ${isActive ? styles.activeItem : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && <span className={styles.activeDot} aria-hidden="true" />}
              <div className={styles.iconWrapper}>
                <IconHome size={20} stroke={isActive ? 2.2 : 1.6} />
              </div>
              <span className={styles.navLabel}>Home</span>
            </Link>
          );
        })()}

        {/* Item 2: Rooms (Authenticated) or FAQ (Guest) */}
        {user ? (
          (() => {
            const isActive = isRouteActive(location.pathname, "/rooms", true);
            return (
              <Link
                to="/rooms"
                className={`${styles.navItem} ${isActive ? styles.activeItem : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && <span className={styles.activeDot} aria-hidden="true" />}
                <div className={styles.iconWrapper}>
                  <IconDatabase size={20} stroke={isActive ? 2.2 : 1.6} />
                </div>
                <span className={styles.navLabel}>Rooms</span>
              </Link>
            );
          })()
        ) : (
          (() => {
            const isActive = isRouteActive(location.pathname, "/faq", true);
            return (
              <Link
                to="/faq"
                className={`${styles.navItem} ${isActive ? styles.activeItem : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && <span className={styles.activeDot} aria-hidden="true" />}
                <div className={styles.iconWrapper}>
                  <IconHelpCircle size={20} stroke={isActive ? 2.2 : 1.6} />
                </div>
                <span className={styles.navLabel}>FAQ</span>
              </Link>
            );
          })()
        )}

        {/* Item 3: Center Elevated CTA: New Room (Authenticated) or Join (Guest) */}
        {user ? (
          <Link
            to="/create"
            className={styles.ctaWrapper}
            aria-label="Create New Room"
            aria-current={isRouteActive(location.pathname, "/create", true) ? "page" : undefined}
          >
            <div className={styles.ctaButton}>
              <IconPlus size={24} stroke={2.5} />
            </div>
            <span className={styles.ctaLabel}>New Room</span>
          </Link>
        ) : (
          <Link
            to="/signup"
            className={styles.ctaWrapper}
            aria-label="Get Started"
            aria-current={isRouteActive(location.pathname, "/signup", true) ? "page" : undefined}
          >
            <div className={styles.ctaButton}>
              <IconSparkles size={22} stroke={2.2} />
            </div>
            <span className={styles.ctaLabel}>Join</span>
          </Link>
        )}

        {/* Item 4: Profile (Authenticated) or Sign In (Guest) */}
        {user ? (
          (() => {
            const isActive = location.pathname.startsWith("/account") || isRouteActive(location.pathname, "/profile", true);
            return (
              <Link
                to="/account/profile"
                className={`${styles.navItem} ${isActive ? styles.activeItem : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && <span className={styles.activeDot} aria-hidden="true" />}
                <div className={styles.iconWrapper}>
                  <IconUser size={20} stroke={isActive ? 2.2 : 1.6} />
                </div>
                <span className={styles.navLabel}>Profile</span>
              </Link>
            );
          })()
        ) : (
          (() => {
            const isActive = isRouteActive(location.pathname, "/login", true);
            return (
              <Link
                to="/login"
                className={`${styles.navItem} ${isActive ? styles.activeItem : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && <span className={styles.activeDot} aria-hidden="true" />}
                <div className={styles.iconWrapper}>
                  <IconLogin size={20} stroke={isActive ? 2.2 : 1.6} />
                </div>
                <span className={styles.navLabel}>Sign In</span>
              </Link>
            );
          })()
        )}

        {/* Item 5: Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          className={styles.navItem}
          aria-label={themeLabel}
        >
          <div className={styles.iconWrapper}>
            {isDark ? (
              <IconSun size={20} stroke={1.6} />
            ) : (
              <IconMoon size={20} stroke={1.6} />
            )}
          </div>
          <span className={styles.navLabel}>Theme</span>
        </button>
      </div>
    </nav>
  );
};
