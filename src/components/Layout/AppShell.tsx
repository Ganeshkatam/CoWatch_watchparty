import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isBottomNavVisible } from "../Navigation/navigationPolicy";
import { MobileBottomNav } from "../Navigation/MobileBottomNav";
import { Announce } from "../Announce/Announce";
import { IconWifiOff } from "@tabler/icons-react";
import styles from "./AppShell.module.css";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const location = useLocation();
  const isNavVisible = isBottomNavVisible(location.pathname);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" ? !navigator.onLine : false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className={styles.appShell}>
      {isOffline && (
        <div
          style={{
            backgroundColor: "#dc2626",
            color: "#ffffff",
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            zIndex: 9999,
            position: "sticky",
            top: 0,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          <IconWifiOff size={16} />
          <span>You appear to be offline. Please check your network connection.</span>
        </div>
      )}
      <Announce />
      <main className={`${styles.mainContent} ${isNavVisible ? styles.hasBottomNav : ""}`}>
        {children}
      </main>
      {isNavVisible && <MobileBottomNav />}
    </div>
  );
};
