import React, { useState } from "react";
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

export const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const history = useHistory();
  const location = useLocation();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      
      const params = new URLSearchParams(location.search);
      const redirect = params.get("redirect") || "/";
      history.push(redirect);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error("Google Auth error:", err);
      setError(err.message);
    }
  };

  const enabledOptions = config.VITE_AUTH_SIGNIN_METHODS.split(",");

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
        radius="md" 
        style={{ 
          background: "var(--bg-elevated)", 
          borderColor: "var(--border-strong)",
          boxShadow: "0 0 20px var(--surface-active)" 
        }}
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
                <Link to="/forgot-password" style={{ color: "inherit", fontSize: "14px", textDecoration: "underline" }}>
                  Forgot password?
                </Link>
              </div>
              <Button fullWidth type="submit">
                Sign in
              </Button>
            </form>
          )}
        </div>
      </Paper>
      <Text size="sm" ta="center" mt="md" c="dimmed">
        Don't have an account?{" "}
        <Link to="/signup" style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>
          Create account
        </Link>
      </Text>
    </div>
  );
};
