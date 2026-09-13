import React, { useEffect, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { Container, Paper, Title, Text, Button, Alert, Loader, Stack, Center } from "@mantine/core";
import { IconCheck, IconAlertCircle } from "@tabler/icons-react";
import { serverPath } from "../../utils/utils";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./AuthShell.module.css";

export const ConfirmGoogleSignup = () => {
  useDocumentMetadata({
    title: "Confirming Google Signup | CoWatch",
    description: "Verifying your Google signup confirmation link.",
    noIndex: true,
  });

  const location = useLocation();
  const history = useHistory();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");

    if (!token) {
      setLoading(false);
      setError("No confirmation token provided in the verification link.");
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const response = await fetch(`${serverPath}/api/auth/confirm-google-signup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();
        if (!isMounted) return;

        if (!response.ok || data.error) {
          setError(data.error || "Failed to confirm your signup. The token may be expired or invalid.");
          setLoading(false);
        } else {
          setSuccess("Your Google signup has been confirmed successfully! Redirecting you now...");
          setLoading(false);
          setTimeout(() => {
            history.push("/");
          }, 2000);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setError(err.message || "An unexpected error occurred while confirming your signup.");
        setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [location.search, history]);

  return (
    <Container size="sm" mt={80}>
      <Paper radius="md" p="xl" withBorder className={styles.authCard}>
        <Stack align="center" gap="md">
          <Title order={2} style={{ color: "var(--text-primary)" }}>
            Google account confirmation
          </Title>

          {loading && (
            <Center style={{ flexDirection: "column", gap: 16, padding: "24px 0" }}>
              <Loader color="violet" size="lg" />
              <Text c="dimmed">Verifying your confirmation link...</Text>
            </Center>
          )}

          {error && (
            <>
              <Alert icon={<IconAlertCircle size={16} />} title="Confirmation failed" color="red" w="100%">
                {error}
              </Alert>
              <Button variant="default" fullWidth onClick={() => history.push("/login")}>
                Return to sign in
              </Button>
            </>
          )}

          {success && (
            <>
              <Alert icon={<IconCheck size={16} />} title="Confirmed" color="green" w="100%">
                {success}
              </Alert>
              <Button color="violet" fullWidth onClick={() => history.push("/")}>
                Continue to CoWatch
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
};
