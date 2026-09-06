import React, { useContext, useEffect, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { supabase } from "../../utils/supabaseClient";
import { getSafeRedirectUrl } from "../../utils/redirect";
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Alert,
  Loader
} from "@mantine/core";
import { IconMail, IconCheck, IconAlertCircle } from "@tabler/icons-react";

export const VerifyEmail = () => {
  const { user } = useContext(MetadataContext);
  const history = useHistory();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const next = searchParams.get("next");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (user === null) {
      history.replace("/login");
    } else if (user && user.email_confirmed_at != null) {
      history.replace(getSafeRedirectUrl(next));
    }
  }, [user, history, next]);

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

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: user.email,
      options: {
        emailRedirectTo: `${window.location.origin}${getSafeRedirectUrl(next)}`
      }
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setSuccess("Verification email has been resent! Please check your inbox and spam folder.");
      setCooldown(60);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    const { error } = await supabase.auth.refreshSession();
    setLoading(false);
    if (error) {
      setError(error.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (user === undefined) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '100px' }}>
        <Loader color="violet" />
      </div>
    );
  }

  // Double check so we don't flash UI before redirect
  if (!user || user.email_confirmed_at != null) {
    return null;
  }

  return (
    <Container size="sm" mt={80}>
      <Paper radius="md" p="xl" withBorder style={{ backgroundColor: "rgba(17, 21, 34, 0.65)", borderColor: "var(--border-subtle)" }}>
        <Stack align="center" gap="md">
          <IconMail size={50} color="var(--color-violet)" />
          
          <Title order={2} style={{ color: "var(--text-primary)" }}>
            Verify your email
          </Title>
          
          <Text c="dimmed" ta="center">
            You need to confirm your email before you can log in. 
            We've sent a verification link to <strong>{user.email}</strong>. 
            Please click the link to confirm your account and access WatchParty.
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
