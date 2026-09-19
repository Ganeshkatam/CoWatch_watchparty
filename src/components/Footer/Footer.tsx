import { Link } from "react-router-dom";
import { Container, Group, Text } from "@mantine/core";

export const Footer = () => (
  <div style={{ borderTop: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-app)" }}>
    <Container size="xl" py="lg">
      <Group justify="space-between" align="center" style={{ flexWrap: "wrap", gap: "20px" }}>

        <Group gap="xs" align="center" style={{ flexWrap: "wrap" }}>
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
          <Text size="xs" c="dimmed" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>•</span>
            <span>Designed and Developed by</span>
            <Text
              component={Link}
              to="/creator"
              inherit
              style={{
                fontWeight: 600,
                color: "var(--color-violet, #8B5CF6)",
                textDecoration: "none",
              }}
            >
              Ganesh Reddy Katam &amp; Prasanna Lakshmi Challa
            </Text>
          </Text>
        </Group>

        <Group gap="md">
          <Text component={Link} to="/creator" size="sm" c="dimmed" style={{ textDecoration: "none" }}>
            Creator
          </Text>
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
