import React, { useState } from "react";
import { Button, Loader } from "@mantine/core";
import { IconHourglassHigh, IconRefresh, IconHome } from "@tabler/icons-react";
import styles from "./WaitingForHost.module.css";

interface WaitingForHostProps {
  roomId: string;
  roomTitle?: string;
  hostName?: string;
  onCheckStatus: () => Promise<void> | void;
}

export const WaitingForHost: React.FC<WaitingForHostProps> = ({
  roomId,
  roomTitle,
  hostName,
  onCheckStatus,
}) => {
  const [isChecking, setIsChecking] = useState(false);

  const handleManualCheck = async () => {
    if (isChecking) return;
    setIsChecking(true);
    try {
      await onCheckStatus();
    } finally {
      setTimeout(() => setIsChecking(false), 600);
    }
  };

  const displayName = roomTitle || roomId.replace(/^\//, "");

  return (
    <div className={styles.container} role="region" aria-label="Waiting for host">
      <div className={styles.card}>
        <div className={styles.statusPill}>
          <div className={styles.pulseDot} />
          <span>Waiting for Host</span>
        </div>

        <div className={styles.iconWrap} aria-hidden="true">
          <IconHourglassHigh size={30} stroke={1.8} />
        </div>

        <h1 className={styles.title}>Host hasn't started the room yet</h1>

        <div className={styles.roomName} title={displayName}>
          {displayName}
        </div>

        <p className={styles.subtitle}>
          {hostName ? `${hostName} has not started this watch party session yet.` : "The host has not started this watch party session yet."}{" "}
          Please hang tight — you will automatically enter the room as soon as the host begins.
        </p>

        <div className={styles.listeningBox}>
          <Loader size={12} color="violet" />
          <span>Listening for session start...</span>
        </div>

        <div className={styles.actions}>
          <Button
            variant="default"
            size="sm"
            className={styles.actionBtn}
            leftSection={<IconHome size={16} />}
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Go to Home
          </Button>

          <Button
            color="violet"
            size="sm"
            className={styles.actionBtn}
            loading={isChecking}
            leftSection={<IconRefresh size={16} />}
            onClick={handleManualCheck}
          >
            Check Status
          </Button>
        </div>
      </div>
    </div>
  );
};
