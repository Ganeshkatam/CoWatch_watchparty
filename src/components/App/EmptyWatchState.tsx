import React from "react";
import { IconAlertCircle, IconLock, IconMovie } from "@tabler/icons-react";
import styles from "./EmptyWatchState.module.css";

interface EmptyWatchStateProps {
  haveLock: boolean;
}

export const EmptyWatchState: React.FC<EmptyWatchStateProps> = ({ haveLock }) => {
  return (
    <div className={styles.emptyContainer}>
      <div className={styles.emptyIcon}>
        <IconMovie size={26} stroke={1.5} />
      </div>
      <div>
        <h3 className={styles.emptyTitle}>You're not watching anything</h3>
        <p className={styles.emptySubtitle}>
          Pick something to watch or choose an option above.
        </p>
      </div>
      {!haveLock && (
        <div className={styles.lockNotice}>
          <IconLock size={14} />
          <span>Room controls are locked by the host</span>
        </div>
      )}
    </div>
  );
};

interface NonPlayableMediaStateProps {
  haveLock?: boolean;
}

export const NonPlayableMediaState: React.FC<NonPlayableMediaStateProps> = () => {
  return (
    <div className={styles.emptyContainer}>
      <div className={styles.unsupportedIcon}>
        <IconAlertCircle size={26} stroke={1.5} />
      </div>
      <div>
        <h3 className={styles.emptyTitle}>It doesn't look like this is a media file</h3>
        <p className={styles.emptySubtitle}>
          Maybe you meant to launch a VBrowser above if you're trying to visit a web page?
        </p>
      </div>
    </div>
  );
};
