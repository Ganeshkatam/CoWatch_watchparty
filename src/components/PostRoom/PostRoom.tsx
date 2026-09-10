import React from "react";
import { Link } from "react-router-dom";
import { Button, Text, Title } from "@mantine/core";
import { IconCirclePlus, IconDoorEnter } from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./PostRoom.module.css";

export const PostRoom: React.FC = () => {
  useDocumentMetadata({
    title: "Session Ended • CoWatch",
    description: "Start a new watch session or join another room on CoWatch.",
    noIndex: true,
  });

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.contentCard}>
        <div className={styles.brandBadge}>
          <span className={styles.brandLogoText}>CoWatch</span>
        </div>

        <Title order={1} className={styles.title}>
          Ready for another watch?
        </Title>

        <Text className={styles.subtitle}>
          Start a new watch session or join another room.
        </Text>

        <div className={styles.buttonGroup}>
          <Button
            component={Link}
            to="/create"
            color="violet"
            size="md"
            leftSection={<IconCirclePlus size={18} />}
            className={styles.primaryButton}
          >
            Create Room
          </Button>

          <Button
            component={Link}
            to="/join"
            variant="default"
            size="md"
            leftSection={<IconDoorEnter size={18} />}
            className={styles.secondaryButton}
          >
            Join a Room
          </Button>
        </div>
      </div>
    </div>
  );
};
