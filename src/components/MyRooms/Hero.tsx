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
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={1} className={styles.heroTitle}>MY ROOMS</Title>
            <Text className={styles.heroSubtitle}>
              All the watch parties you create and manage.
            </Text>
          </div>
          
          <Button
            size="sm"
            variant="default"
            leftSection={<IconCirclePlusFilled size={16} />}
            onClick={() => history.push("/create")}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            New Room
          </Button>
        </Group>

        <div className={styles.heroMetrics}>
          {children}
        </div>
      </div>
    </div>
  );
};
