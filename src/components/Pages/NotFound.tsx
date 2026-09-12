import React from "react";
import { Container, Paper, Title, Text, Button, Group, Stack } from "@mantine/core";
import { Link, useHistory } from "react-router-dom";
import { IconHome, IconSearch, IconHelp, IconArrowLeft } from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

export const NotFound: React.FC = () => {
  useDocumentMetadata({
    title: "Page Not Found | CoWatch",
    description: "The page or watch party room you requested could not be found.",
  });
  const history = useHistory();

  return (
    <Container size="sm" style={{ padding: "80px 20px", minHeight: "70vh", display: "flex", alignItems: "center" }}>
      <Paper
        radius="lg"
        p={40}
        withBorder
        style={{
          width: "100%",
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          textAlign: "center",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <Stack align="center" gap="md">
          <Text
            fw={900}
            style={{
              fontSize: "clamp(64px, 12vw, 96px)",
              lineHeight: 1,
              background: "linear-gradient(45deg, var(--color-violet), var(--color-pink))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            404
          </Text>

          <Title order={2} fw={800} style={{ color: "var(--text-primary)" }}>
            Page or Room Not Found
          </Title>

          <Text c="var(--text-secondary)" size="md" maw={440}>
            We couldn't find the page or watch party room you were looking for. The link may be incorrect, or the room may have concluded and expired.
          </Text>

          <Group justify="center" gap="sm" mt="lg" wrap="wrap">
            <Button
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => history.goBack()}
            >
              Go Back
            </Button>
            <Button
              component={Link}
              to="/"
              leftSection={<IconHome size={16} />}
              style={{
                background: "linear-gradient(135deg, var(--color-violet), var(--color-pink))",
                color: "#ffffff",
              }}
            >
              Return Home
            </Button>
            <Button
              component={Link}
              to="/myrooms"
              variant="default"
              leftSection={<IconSearch size={16} />}
            >
              Browse My Rooms
            </Button>
            <Button
              component={Link}
              to="/support"
              variant="subtle"
              color="gray"
              leftSection={<IconHelp size={16} />}
            >
              Help & Support
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
};
