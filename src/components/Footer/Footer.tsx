import React from "react";
import { Link } from "react-router-dom";
import { Container, Group, Text } from "@mantine/core";

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
          <Text component={Link} to="/about" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            About
          </Text>
          <Text component={Link} to="/faq" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            FAQ
          </Text>
          <Text component={Link} to="/terms" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Terms
          </Text>
          <Text component={Link} to="/privacy" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Privacy
          </Text>
          <Text component={Link} to="/support" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Support
          </Text>
          <Text component={Link} to="/community-guidelines" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Guidelines
          </Text>
        </Group>

      </Group>
    </Container>
  </div>
);
