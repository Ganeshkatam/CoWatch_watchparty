import React, { useContext, useEffect, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { supabase } from "../../utils/supabaseClient";
import { getSafeRedirectUrl } from "../../utils/redirect";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Alert,
  Loader,
  Center
} from "@mantine/core";
import { IconMail, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import styles from "./AuthShell.module.css";
import { serverPath } from "../../utils/utils";

export const VerifyEmail = () => {
  useDocumentMetadata({
    title: "Verify Email | CoWatch",
    description: "Verify your email address to access your CoWatch account.",
    noIndex: true,
  });

  const { user } = useContext(MetadataContext);
  const history = useHistory();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const next = searchParams.get("next");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const isGoogleUser = Boolean(
    user?.app_metadata?.provider === "google" ||
    (Array.isArray(user?.app_metadata?.providers) && user?.app_metadata?.providers.includes("google")) ||
    user?.identities?.some((id: any) => id.provider === "google")
  );

  useEffect(() => {
    if (user === null) {
      history.replace("/login");
    } else if (user && user.email_confirmed_at != null && !isGoogleUser) {
      history.replace(getSafeRedirectUrl(next));
    }
  }, [user, history, next, isGoogleUser]);

  useEffect(() => {
    let timer: any;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!user?.email || cooldown > 0) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isGoogleUser) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          throw new Error("No active session found. Please sign in again.");
        }

        const response = await fetch(`${serverPath}/api/auth/send-google-confirmation`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          if (data.retryAfterSeconds) {
            setCooldown(data.retryAfterSeconds);
          }
          throw new Error(data.error || "Failed to dispatch confirmation email.");
        }

        setSuccess("Verification email has been resent! Please check your inbox.");
        setCooldown(60);
      } else {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email: user.email,
          options: {
            emailRedirectTo: `${window.location.origin}${getSafeRedirectUrl(next)}`,
          },
        });

        if (error) throw error;
        setSuccess("Verification email has been resent! Please check your inbox and spam folder.");
        setCooldown(60);
      }
    } catch (err: any) {
      setError(err.message || "Failed to resend confirmation email.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;

      if (isGoogleUser && user) {
        // Query server metadata to check if account is now confirmed
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const metaRes = await fetch(`${serverPath}/metadata?uid=${user.id}&token=${token}`);
        if (metaRes.status === 403) {
          const body = await metaRes.json().catch(() => ({}));
          if (body?.error?.code === "EMAIL_NOT_VERIFIED") {
            setError("Your email has not been confirmed yet. Please check your inbox for the confirmation link.");
            setLoading(false);
            return;
          }
        }
      }
      history.replace(getSafeRedirectUrl(next));
    } catch (err: any) {
      setError(err.message || "Failed to refresh verification status.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (user === undefined) {
      const timer = setTimeout(() => setTimedOut(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [user]);

  if (user === undefined && !timedOut) {
    return (
      <Center style={{ minHeight: "100vh", width: "100%" }}>
        <Loader color="violet" size="lg" />
      </Center>
    );
  }

  // Double check so we don't flash UI before redirect
  if (!user || (user.email_confirmed_at != null && !isGoogleUser)) {
    return null;
  }

  return (
    <Container size="sm" mt={80}>
      <Paper radius="md" p="xl" withBorder className={styles.authCard}>
        <Stack align="center" gap="md">
          <IconMail size={50} color="var(--color-violet)" />

          <Title order={2} style={{ color: "var(--text-primary)" }}>
            Verify your email
          </Title>

          <Text c="dimmed" ta="center">
            You need to confirm your email before you can log in.
            We've sent a verification link to <strong>{user.email}</strong>.
            Please click the link to confirm your account and access CoWatch.
          </Text>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" w="100%">
              {error}
            </Alert>
          )}

          {success && (
            <Alert icon={<IconCheck size={16} />} title="Success" color="green" w="100%">
              {success}
            </Alert>
          )}

          <Stack gap="sm" w="100%" mt="md">
            <Button
              fullWidth
              variant="light"
              color="violet"
              loading={loading}
              disabled={cooldown > 0}
              onClick={handleResend}
            >
              {cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend verification email"}
            </Button>

            <Button
              fullWidth
              variant="outline"
              color="gray"
              loading={loading}
              onClick={handleRefresh}
            >
              I've verified my email (Refresh)
            </Button>
          </Stack>

          <Group justify="center" mt="xl">
            <Button variant="subtle" color="gray" size="sm" onClick={handleSignOut}>
              Sign Out
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
};
