import React, { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, Text, Title, Badge } from "@mantine/core";
import {
  IconCirclePlus,
  IconDoorEnter,
  IconHome,
  IconRotateClockwise,
  IconClock,
  IconUsers,
  IconMovie,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import {
  getPostRoomContext,
  getPostRoomPresentation,
  PostRoomAction,
  PostRoomContext,
} from "../../utils/postRoomContext";
import styles from "./PostRoom.module.css";

interface PostRoomProps {
  location?: any;
  history?: any;
}

function getActionIcon(action?: PostRoomAction) {
  if (!action) return undefined;
  const label = action.label.toLowerCase();
  if (label.includes("return") || label.includes("open") || label.includes("reconnect")) {
    return <IconRotateClockwise size={18} />;
  }
  if (label.includes("home")) {
    return <IconHome size={18} />;
  }
  if (label.includes("join")) {
    return <IconDoorEnter size={18} />;
  }
  if (label.includes("create")) {
    return <IconCirclePlus size={18} />;
  }
  return undefined;
}

export const PostRoom: React.FC<PostRoomProps> = ({ location: propLocation }) => {
  const routerLocation = useLocation();
  const locationState = propLocation?.state ?? routerLocation?.state;

  const context: PostRoomContext = useMemo(() => {
    return getPostRoomContext(locationState);
  }, [locationState]);

  const presentation = useMemo(() => {
    return getPostRoomPresentation(context);
  }, [context]);

  useDocumentMetadata({
    title: `${presentation.heading} • CoWatch`,
    description: presentation.message,
    noIndex: true,
  });

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.contentCard}>
        {/* Brand & Contextual Status Badge */}
        <div className={styles.badgeRow}>
          <div className={styles.brandBadge}>
            <span className={styles.brandLogoText}>CoWatch</span>
          </div>
          <Badge
            variant="light"
            color={presentation.badgeColor}
            size="md"
            radius="sm"
            className={styles.statusBadge}
          >
            {presentation.badge}
          </Badge>
        </div>

        {/* Heading & Room Identity */}
        <Title order={1} className={styles.title}>
          {presentation.heading}
        </Title>

        <Text className={styles.roomName}>
          {presentation.roomTitle}
        </Text>

        {/* Primary & Secondary Context Messages */}
        <Text className={styles.subtitle}>
          {presentation.message}
        </Text>

        {presentation.subMessage && (
          <Text className={styles.subMessage}>
            {presentation.subMessage}
          </Text>
        )}

        {/* Compact Session Summary (Client-observed snapshot, not authoritative) */}
        {presentation.hasSummary && (
          <div className={styles.summaryCard}>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <div className={styles.summaryItemHeader}>
                  <IconClock size={15} className={styles.summaryIcon} />
                  <span className={styles.summaryLabel}>Duration</span>
                </div>
                <span className={styles.summaryValue}>
                  {presentation.formattedDuration}
                </span>
              </div>

              <div className={styles.summaryItem}>
                <div className={styles.summaryItemHeader}>
                  <IconUsers size={15} className={styles.summaryIcon} />
                  <span className={styles.summaryLabel}>Participants</span>
                </div>
                <span className={styles.summaryValue}>
                  {presentation.participantCountDisplay}
                </span>
              </div>

              <div className={styles.summaryItem}>
                <div className={styles.summaryItemHeader}>
                  <IconMovie size={15} className={styles.summaryIcon} />
                  <span className={styles.summaryLabel}>Media</span>
                </div>
                <span className={styles.summaryValue} title={presentation.mediaTitleDisplay}>
                  {presentation.mediaTitleDisplay}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footnote reassurance */}
        {presentation.footnote && (
          <Text className={styles.footnote}>
            {presentation.footnote}
          </Text>
        )}

        {/* Contextual Action Buttons */}
        <div className={styles.buttonGroup}>
          <Button
            component={Link}
            to={presentation.primaryAction.to}
            color={presentation.primaryAction.color || "violet"}
            size="md"
            leftSection={getActionIcon(presentation.primaryAction)}
            className={styles.primaryButton}
          >
            {presentation.primaryAction.label}
          </Button>

          {presentation.secondaryAction && (
            <Button
              component={Link}
              to={presentation.secondaryAction.to}
              variant={presentation.secondaryAction.variant || "default"}
              size="md"
              leftSection={getActionIcon(presentation.secondaryAction)}
              className={styles.secondaryButton}
            >
              {presentation.secondaryAction.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
