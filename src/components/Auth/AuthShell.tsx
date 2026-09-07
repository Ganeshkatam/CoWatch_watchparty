import React from "react";
import { useLocation } from "react-router-dom";
import styles from "./AuthShell.module.css";

interface AuthShellProps {
  children: React.ReactNode;
}

export const AuthShell: React.FC<AuthShellProps> = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;

  let title = "Watch together.<br />Anywhere.";
  let description = "Create a room, invite your friends, and watch together from anywhere.";
  let features = (
    <div className={styles.brandFeatures}>
      <div className={styles.featureItem}>
        <span className={styles.featureCheck}>✓</span> Shared rooms for watching together
      </div>
      <div className={styles.featureItem}>
        <span className={styles.featureCheck}>✓</span> High-quality video & audio streaming
      </div>
      <div className={styles.featureItem}>
        <span className={styles.featureCheck}>✓</span> Interactive chat with live reactions
      </div>
    </div>
  );

  if (path.includes("signup")) {
    title = "Join the party.";
    description = "Create a free account to unlock premium features and keep your rooms forever.";
    features = (
      <div className={styles.brandFeatures}>
        <div className={styles.featureItem}>
          <span className={styles.featureCheck}>✓</span> Claim your custom username
        </div>
        <div className={styles.featureItem}>
          <span className={styles.featureCheck}>✓</span> Save and manage permanent rooms
        </div>
        <div className={styles.featureItem}>
          <span className={styles.featureCheck}>✓</span> Watch together instantly
        </div>
      </div>
    );
  } else if (path.includes("forgot-password")) {
    title = "Locked out?";
    description = "Don't worry, it happens to the best of us. We'll help you get back to your watch party.";
    features = <></>;
  } else if (path.includes("reset-password")) {
    title = "Secure your account.";
    description = "Choose a strong password to keep your rooms and settings safe.";
    features = <></>;
  }

  return (
    <div className={styles.authPage}>
      <img
        src="/auth_bg.jpg"
        alt="Cinema watch party background"
        className={styles.authBgImage}
      />
      <div className={styles.authBgOverlay} />
      <div className={styles.authLayout}>
        <div className={styles.brandPanel}>
          <div
            className={styles.brandTitle}
            dangerouslySetInnerHTML={{ __html: title }}
          />
          <div className={styles.brandDescription}>
            {description}
          </div>
          {features}
        </div>
        <div className={styles.formPanel}>
          {children}
        </div>
      </div>
    </div>
  );
};
