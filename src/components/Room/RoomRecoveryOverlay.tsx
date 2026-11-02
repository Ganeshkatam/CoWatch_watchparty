import React from "react";
import { Loader } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useRoomInitStage } from "../../hooks/useOperationState";
import { getLifecycleStageMessage } from "../../utils/userMessages";
import styles from "./RoomRecoveryOverlay.module.css";

export const RoomRecoveryOverlay: React.FC = () => {
  const { stage, isRecovering } = useRoomInitStage();

  if (
    stage === "ready" ||
    stage === "booting" ||
    stage === "authenticating" ||
    stage === "failed" ||
    !isRecovering
  ) {
    return null;
  }

  const text = getLifecycleStageMessage(stage);
  let badgeClass = styles.connecting;
  let icon: React.ReactNode = <Loader size={14} color="gray" />;

  switch (stage) {
    case "connecting":
      badgeClass = styles.connecting;
      icon = <Loader size={14} color="gray" />;
      break;
    case "synchronizing":
      badgeClass = styles.synchronizing;
      icon = <Loader size={14} color="violet" />;
      break;
    case "degraded":
      badgeClass = styles.degraded;
      icon = <IconAlertTriangle size={15} color="#f59e0b" />;
      break;
  }

  return (
    <div className={`${styles.recoveryBadge} ${badgeClass}`} role="status" aria-live="polite">
      {icon}
      <span className={styles.text}>{text}</span>
    </div>
  );
};
