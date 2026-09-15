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
    const searchParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.substring(1) : location.hash);

    const errorCode = searchParams.get("error_code") || hashParams.get("error_code");
    const errorParam = searchParams.get("error") || hashParams.get("error");
    const errorDesc = searchParams.get("error_description") || hashParams.get("error_description");

    if (errorParam === "unsupported_email") {
      setError("Email provider is not supported. Please use an approved provider.");
      history.replace(location.pathname);
    } else if (errorCode === "otp_expired" || errorDesc?.includes("expired") || errorDesc?.includes("token")) {
      setError("Your confirmation or password reset link has expired. Please sign in or request a new link.");
      history.replace(location.pathname);
    } else if (errorParam === "access_denied" && errorDesc) {
      setError(decodeURIComponent(errorDesc.replace(/\+/g, " ")));
      history.replace(location.pathname);
    } else if (errorDesc || errorParam) {
      setError(decodeURIComponent((errorDesc || errorParam || "Authentication failed").replace(/\+/g, " ")));
      history.replace(location.pathname);
    }
  }, [location.search, location.hash, location.pathname, history]);

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
      history.push(redirect.startsWith("/") ? redirect : `/${redirect}`);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.toLowerCase().includes("invalid login credentials")) {
        setError("Invalid email or password. If you do not have an account yet, kindly create an account.");
      } else {
        setError(msg || "An error occurred during sign in.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      try {
        window.sessionStorage?.setItem("cowatch_pending_oauth", "google");
      } catch (e) { }
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
      try {
        window.sessionStorage?.removeItem("cowatch_pending_oauth");
      } catch (e) { }
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

      <Paper
        withBorder
        p={30}
        mt={30}
        radius="lg"
        className={styles.authCard}
      >
        {error && (
          <Alert color="red" mb="md" title="Sign In Notice">
            <div>{error}</div>
            {(error.includes("create an account") || error.toLowerCase().includes("invalid")) && (
              <div style={{ marginTop: "8px" }}>
                <Button
                  component={Link}
                  to={{ pathname: "/signup", search: location.search }}
                  size="compact-xs"
                  variant="filled"
                  color="violet"
                >
                  Create an account
                </Button>
              </div>
            )}
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
        Do not have an account?{" "}
        <Link to={{ pathname: "/signup", search: location.search }} style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>
          Create an account
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
