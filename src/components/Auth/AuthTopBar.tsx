import React from "react";
import { Link } from "react-router-dom";
import { Button, Group, ActionIcon, Tooltip } from "@mantine/core";
import { IconArrowLeft, IconSun, IconMoon } from "@tabler/icons-react";
import { useAppearance } from "../../theme/ThemeProvider";
import styles from "./AuthShell.module.css";

export const AuthTopBar: React.FC = () => {
  const { resolvedColorScheme, setAppearance } = useAppearance();

  const toggleTheme = () => {
    setAppearance(resolvedColorScheme === "light" ? "mantine" : "light");
  };

  return (
    <div className={styles.authTopBar}>
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <img
          className="cowatch-brand-logo"
          style={{ width: "32px", height: "32px", marginRight: "10px", objectFit: "contain" }}
          src="/logo192.png"
          alt="CoWatch"
        />
        <div
          style={{
            textTransform: "uppercase",
            fontWeight: 800,
            fontSize: "20px",
            background: "linear-gradient(135deg, var(--color-teal), var(--color-blue))",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            letterSpacing: 1.5,
          }}
        >
          CoWatch
        </div>
      </Link>

      <Group gap="xs">
        <Tooltip label={resolvedColorScheme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
          <ActionIcon
            onClick={toggleTheme}
            variant="subtle"
            color="violet"
            size="lg"
            radius="md"
            aria-label="Toggle color scheme"
          >
            {resolvedColorScheme === "light" ? <IconMoon size={18} /> : <IconSun size={18} />}
          </ActionIcon>
        </Tooltip>

        <Button
          component={Link}
          to="/"
          variant="subtle"
          color="violet"
          leftSection={<IconArrowLeft size={16} />}
          style={{ fontSize: "14px" }}
        >
          Back to home
        </Button>
      </Group>
    </div>
  );
};
