import React from "react";
import { Link } from "react-router-dom";
import { Container, Group, Text, ActionIcon } from "@mantine/core";
import { IconBrandTwitter, IconBrandGithub, IconBrandDiscord } from "@tabler/icons-react";

export const Footer = () => (
  <div style={{ borderTop: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-app)" }}>
    <Container size="xl" py="lg">
      <Group justify="space-between" align="center" style={{ flexWrap: "wrap", gap: "20px" }}>

        <Group gap="xs" align="center">
          <div
            style={{
              textTransform: "uppercase",
              fontWeight: 700,
              fontSize: "18px",
              lineHeight: "18px",
              background: "linear-gradient(135deg, var(--color-teal), var(--color-blue))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            CoWatch
          </div>
          <Text size="sm" c="dimmed">
            © {new Date().getFullYear()} CoWatch. All rights reserved.
          </Text>
        </Group>

        <Group gap="md">
          <Text component={Link} to="/terms" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Terms
          </Text>
          <Text component={Link} to="/privacy" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Privacy
          </Text>
          <Text component={Link} to="/faq" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            FAQ
          </Text>
        </Group>

        <Group gap="xs">
          {/* <ActionIcon size="lg" color="gray" variant="subtle">
            <IconBrandTwitter size={18} stroke={1.5} />
          </ActionIcon> */}
          {/* <ActionIcon size="lg" color="gray" variant="subtle">
            <IconBrandGithub size={18} stroke={1.5} />
          </ActionIcon> */}
        </Group>

      </Group>
    </Container>
  </div>
);
