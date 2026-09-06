import React from "react";
import {
  IconAlertCircle,
  IconLock,
  IconPlayerPlayFilled,
  IconPlus,
} from "@tabler/icons-react";
import styles from "./EmptyWatchState.module.css";

interface EmptyWatchStateProps {
  haveLock: boolean;
  onOpenAddMedia: () => void;
}

export const EmptyWatchState: React.FC<EmptyWatchStateProps> = ({
  haveLock,
  onOpenAddMedia,
}) => {
  return (
    <div className={styles.stageWrapper}>
      <div className={styles.horizonGlow} />

      <div className={styles.emptyContainer}>
        <div className={styles.playIconWrapper}>
          <div className={styles.playIconGlow} />
          <div className={styles.playIconBox}>
            <IconPlayerPlayFilled size={30} />
          </div>
        </div>

        <h2 className={styles.emptyTitle}>Nothing playing yet</h2>
        <p className={styles.emptySubtitle}>
          Choose something to watch with your friends.
        </p>
        <p className={styles.emptySecondary}>
          Add a video, share your screen, or browse together.
        </p>

        <button
          type="button"
          className={styles.addMediaCtaBtn}
          onClick={onOpenAddMedia}
          disabled={!haveLock}
          title={haveLock ? "Add something to watch" : "Controls are locked"}
        >
          <IconPlus size={16} stroke={2.5} />
          <span>Add something to watch</span>
        </button>

        {!haveLock && (
          <div className={styles.lockNotice}>
            <IconLock size={14} />
            <span>Room controls are locked by the host</span>
          </div>
        )}
      </div>
    </div>
  );
};

interface NonPlayableMediaStateProps {
  haveLock?: boolean;
}

export const NonPlayableMediaState: React.FC<NonPlayableMediaStateProps> = () => {
  return (
    <div className={styles.stageWrapper}>
      <div className={styles.emptyContainer}>
        <div className={styles.unsupportedIcon}>
          <IconAlertCircle size={26} stroke={1.5} />
        </div>
        <div>
          <h3 className={styles.emptyTitle} style={{ fontSize: "18px" }}>
            It doesn't look like this is a media file
          </h3>
          <p className={styles.emptySubtitle}>
            Maybe you meant to launch a Virtual Browser if you're trying to visit a web page?
          </p>
        </div>
      </div>
    </div>
  );
};
