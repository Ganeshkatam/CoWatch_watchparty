import React from "react";
import { useHistory } from "react-router-dom";
import { Title, Text, Button, Group } from "@mantine/core";
import { IconCirclePlusFilled } from "@tabler/icons-react";
import styles from "./MyRooms.module.css";

export const Hero: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const history = useHistory();

  return (
    <div className={styles.hero}>
      <div className={styles.heroContent}>
        <div className={styles.heroHeader}>
          <div className={styles.heroTitleBox}>
            <Title order={1} className={styles.heroTitle}>MY ROOMS</Title>
            <Text className={styles.heroSubtitle}>
              All the watch parties you create and manage.
            </Text>
          </div>
          
          <Button
            size="sm"
            variant="gradient"
            gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
            leftSection={<IconCirclePlusFilled size={16} />}
            onClick={() => history.push("/create")}
            className={styles.heroNewRoomBtn}
          >
            New Room
          </Button>
        </div>

        <div className={styles.heroMetrics}>
          {children}
        </div>
      </div>
    </div>
  );
};
