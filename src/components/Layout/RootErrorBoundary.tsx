import React, { Component, ErrorInfo, ReactNode } from "react";
import { Container, Paper, Title, Text, Button, Group, Stack, Alert, Loader } from "@mantine/core";
import { IconAlertTriangle, IconRefresh, IconHome } from "@tabler/icons-react";
import { isChunkLoadError, hasChunkReloadAttempted, triggerChunkReload } from "../../utils/updatePolicy";

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
    if (isChunkLoadError(error)) {
      triggerChunkReload();
    }
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
      const isChunk = isChunkLoadError(this.state.error);
      const alreadyAttempted = hasChunkReloadAttempted();

      // State A: Chunk error detected and automatic reload initiated
      if (isChunk && !alreadyAttempted) {
        return (
          <div
            style={{
              minHeight: "100vh",
              backgroundColor: "var(--bg-base)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Stack align="center" gap="sm">
              <Loader color="violet" size="md" />
              <Text size="sm" c="var(--text-secondary)">
                Updating to the latest version of CoWatch...
              </Text>
            </Stack>
          </div>
        );
      }

      // State B: Chunk error detected, automatic reload already attempted
      if (isChunk && alreadyAttempted) {
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
                      backgroundColor: "rgba(139, 92, 246, 0.12)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--color-violet, #8b5cf6)",
                    }}
                  >
                    <IconRefresh size={32} />
                  </div>

                  <Title order={2} fw={800} style={{ color: "var(--text-primary)" }}>
                    CoWatch couldn't load the latest version
                  </Title>

                  <Text c="var(--text-secondary)" size="sm" maw={440}>
                    A new version of CoWatch was recently published, but the latest assets could not be retrieved. Please check your internet connection and try again.
                  </Text>

                  <Group justify="center" gap="sm" mt="lg">
                    <Button
                      variant="default"
                      leftSection={<IconRefresh size={16} />}
                      onClick={this.handleReload}
                    >
                      Try Again
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

      // State C: Ordinary application error
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

import { useLocation, Link, useHistory } from "react-router-dom";
import { parseErrorParams, SafeErrorCode } from "../../utils/routeParams";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

export const ErrorScreen: React.FC = () => {
  const location = useLocation();
  const history = useHistory();
  const { code } = parseErrorParams(location.search);

  const errorConfig: Record<
    SafeErrorCode,
    {
      title: string;
      message: string;
      primaryButtonText: string;
      primaryButtonLink: string;
    }
  > = {
    session_expired: {
      title: "Session Expired",
      message: "Your login session has expired. Please sign in again to continue enjoying CoWatch.",
      primaryButtonText: "Sign In",
      primaryButtonLink: "/login",
    },
    permission_denied: {
      title: "Access Denied",
      message: "You do not have permission to access this resource or perform this action.",
      primaryButtonText: "Return Home",
      primaryButtonLink: "/",
    },
    room_full: {
      title: "Room is Full",
      message: "This watch party has reached its maximum participant limit. Please try again later.",
      primaryButtonText: "Return Home",
      primaryButtonLink: "/",
    },
    room_not_found: {
      title: "Room Not Found",
      message: "The requested watch party room does not exist or has expired.",
      primaryButtonText: "Browse Rooms",
      primaryButtonLink: "/myrooms",
    },
    room_ended: {
      title: "Watch Party Ended",
      message: "This watch party session has concluded.",
      primaryButtonText: "Room Summary",
      primaryButtonLink: "/room-ended",
    },
    unauthorized: {
      title: "Authentication Required",
      message: "You must be signed in with a verified account to access this room.",
      primaryButtonText: "Sign In",
      primaryButtonLink: "/login",
    },
    server_unavailable: {
      title: "Something Went Wrong",
      message: "An unexpected error occurred or our servers are temporarily unavailable. Recovery systems are active.",
      primaryButtonText: "Return Home",
      primaryButtonLink: "/",
    },
  };

  const current = errorConfig[code] || errorConfig.server_unavailable;

  useDocumentMetadata({
    title: `${current.title} | CoWatch`,
    description: current.message,
    noIndex: true,
  });

  return (
    <div style={{ minHeight: "80vh", backgroundColor: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Container size="sm" style={{ padding: "40px 20px", width: "100%" }}>
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
              {current.title}
            </Title>

            <Text c="var(--text-secondary)" size="sm" maw={460}>
              {current.message}
            </Text>

            <Group justify="center" gap="sm" mt="lg" wrap="wrap">
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
              <Button
                component={Link}
                to={current.primaryButtonLink}
                leftSection={<IconHome size={16} />}
                style={{
                  background: "linear-gradient(135deg, var(--color-violet), var(--color-pink))",
                  color: "#ffffff",
                }}
              >
                {current.primaryButtonText}
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Container>
    </div>
  );
};
