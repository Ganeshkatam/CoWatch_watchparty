import React from "react";
import { useLocation } from "react-router-dom";
import { isBottomNavVisible } from "../Navigation/navigationPolicy";
import { MobileBottomNav } from "../Navigation/MobileBottomNav";
import { Announce } from "../Announce/Announce";
import styles from "./AppShell.module.css";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const location = useLocation();
  const isNavVisible = isBottomNavVisible(location.pathname);

  return (
    <div className={styles.appShell}>
      <Announce />
      <main className={`${styles.mainContent} ${isNavVisible ? styles.hasBottomNav : ""}`}>
        {children}
      </main>
      {isNavVisible && <MobileBottomNav />}
    </div>
  );
};
