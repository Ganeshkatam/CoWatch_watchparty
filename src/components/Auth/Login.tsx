import React, { useState, useEffect } from "react";
import { useHistory, useLocation, Link } from "react-router-dom";
import {
  TextInput,
  PasswordInput,
  Button,
  Container,
  Paper,
  Title,
  Text,
  Alert,
  Divider,
} from "@mantine/core";
import { IconBrandGoogleFilled } from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import config from "../../config";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

export const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const history = useHistory();
  const location = useLocation();

  useDocumentMetadata({
    title: "Sign In",
    description: "Sign in to your CoWatch account to create and join watch parties.",
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("error") === "unsupported_email") {
      setError("Email provider is not supported. Please use an approved provider.");
      history.replace(location.pathname);
    }
  }, [location.search, location.pathname, history]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      
      const params = new URLSearchParams(location.search);
      const redirect = params.get("redirect") || params.get("next") || "/";
      history.push(redirect);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      const params = new URLSearchParams(location.search);
      const redirect = params.get("redirect") || params.get("next") || "/";
      const redirectTarget = redirect.startsWith("/") ? redirect : `/${redirect}`;
      const redirectTo = `${window.location.origin}${redirectTarget}`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error("Google Auth error:", err);
      setError(err.message);
      setGoogleLoading(false);
    }
  };

  const enabledOptions = (config.VITE_AUTH_SIGNIN_METHODS || "google,email").split(",");

  return (
    <div style={{ width: "100%" }}>
      <Title order={2} ta="left" fw={800} style={{ color: "var(--text-primary)" }}>
        Welcome back
      </Title>
      <Text c="dimmed" size="sm" ta="left" mt={5}>
        Sign in to continue watching together.
      </Text>

      <Paper 
        withBorder 
        p={30} 
        mt={30} 
        radius="lg" 
        className={styles.authCard}
      >
        {error && (
          <Alert color="red" mb="md" title="Error">
            {error}
          </Alert>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {enabledOptions.includes("google") && (
            <Button
              leftSection={<IconBrandGoogleFilled />}
              onClick={handleGoogleSignIn}
              variant="default"
              fullWidth
              loading={googleLoading}
            >
              Continue with Google
            </Button>
          )}

          {enabledOptions.includes("email") && enabledOptions.includes("google") && (
            <Divider label="Or continue with email" labelPosition="center" my="xs" />
          )}

          {enabledOptions.includes("email") && (
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
              <TextInput
                label="Email"
                placeholder="your@email.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <PasswordInput
                label="Password"
                placeholder="Your password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link to="/forgot-password" style={{ color: "var(--color-violet)", fontSize: "14px", textDecoration: "underline", fontWeight: 500 }}>
                  Forgot password?
                </Link>
              </div>
              <Button fullWidth type="submit" loading={submitting}>
                Sign in
              </Button>
            </form>
          )}
        </div>
      </Paper>
      <Text size="sm" ta="center" mt="md" c="dimmed">
        Don't have an account?{" "}
        <Link to={{ pathname: "/signup", search: location.search }} style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>
          Create account
        </Link>
      </Text>
      <Text size="xs" ta="center" mt="xs" c="dimmed">
        <Link to="/terms" style={{ color: "var(--text-muted)", textDecoration: "underline", marginRight: "12px" }}>
          Terms of Service
        </Link>
        <Link to="/privacy" style={{ color: "var(--text-muted)", textDecoration: "underline" }}>
          Privacy Policy
        </Link>
      </Text>
    </div>
  );
};
