import React from "react";
import { Loader } from "@mantine/core";
import { IconAlertTriangle, IconWifiOff, IconRefresh } from "@tabler/icons-react";
import { useRoomInitStage } from "../../hooks/useOperationState";
import styles from "./RoomRecoveryOverlay.module.css";

export const RoomRecoveryOverlay: React.FC = () => {
  const { stage } = useRoomInitStage();

  if (stage === "ready" || stage === "booting" || stage === "authenticating") {
    return null;
  }

  let text = "Connecting...";
  let badgeClass = styles.connecting;
  let icon: React.ReactNode = <Loader size={14} color="gray" />;

  switch (stage) {
    case "connecting":
      text = "Reconnecting to room...";
      badgeClass = styles.connecting;
      icon = <Loader size={14} color="gray" />;
      break;
    case "synchronizing":
      text = "Synchronizing room...";
      badgeClass = styles.synchronizing;
      icon = <Loader size={14} color="violet" />;
      break;
    case "degraded":
      text = "Connection degraded - recovering room state...";
      badgeClass = styles.degraded;
      icon = <IconAlertTriangle size={15} color="#f59e0b" />;
      break;
    case "failed":
      text = "Unable to connect to room";
      badgeClass = styles.failed;
      icon = <IconWifiOff size={15} color="#ef4444" />;
      break;
  }

  return (
    <div className={`${styles.recoveryBadge} ${badgeClass}`} role="status" aria-live="polite">
      {icon}
      <span className={styles.text}>{text}</span>
    </div>
  );
};
