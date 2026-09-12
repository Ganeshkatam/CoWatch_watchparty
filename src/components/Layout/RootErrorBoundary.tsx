import React, { Component, ErrorInfo, ReactNode } from "react";
import { Container, Paper, Title, Text, Button, Group, Stack, Alert } from "@mantine/core";
import { IconAlertTriangle, IconRefresh, IconHome } from "@tabler/icons-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught application error caught by RootErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-base)", display: "flex", alignItems: "center" }}>
          <Container size="sm" style={{ padding: "40px 20px" }}>
            <Paper
              radius="lg"
              p={36}
              withBorder
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                textAlign: "center",
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <Stack align="center" gap="md">
                <div
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(239, 68, 68, 0.12)",
                    display: "grid",
                    placeItems: "center",
                    color: "#ef4444",
                  }}
                >
                  <IconAlertTriangle size={32} />
                </div>

                <Title order={2} fw={800} style={{ color: "var(--text-primary)" }}>
                  Something went wrong
                </Title>

                <Text c="var(--text-secondary)" size="sm" maw={440}>
                  An unexpected error occurred while rendering the page. We have logged this diagnostic event and our recovery system is active.
                </Text>

                {Boolean(import.meta.env?.DEV) && this.state.error?.message && (
                  <Alert
                    color="red"
                    variant="light"
                    radius="md"
                    maw={480}
                    w="100%"
                    title="Diagnostic Details (Dev Only)"
                    styles={{ title: { fontWeight: 700 } }}
                  >
                    <Text size="xs" style={{ wordBreak: "break-word", fontFamily: "monospace" }}>
                      {this.state.error.message}
                    </Text>
                  </Alert>
                )}

                <Group justify="center" gap="sm" mt="lg">
                  <Button
                    variant="default"
                    leftSection={<IconRefresh size={16} />}
                    onClick={this.handleReload}
                  >
                    Reload Page
                  </Button>
                  <Button
                    leftSection={<IconHome size={16} />}
                    onClick={this.handleGoHome}
                    style={{
                      background: "linear-gradient(135deg, var(--color-violet), var(--color-pink))",
                      color: "#ffffff",
                    }}
                  >
                    Return Home
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </Container>
        </div>
      );
    }

    return this.props.children;
  }
}
