import React, { useState, useEffect, useCallback } from "react";
import { useHistory, Link } from "react-router-dom";
import {
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Alert,
} from "@mantine/core";
import { supabase } from "../../utils/supabaseClient";

export const Signup = () => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const history = useHistory();

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Clear previous states
    setError(null);
    setSuccess(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username.trim(),
            display_name: username.trim(),
          },
        },
      });
      if (error) throw error;

      // If a session is returned, email confirmation is disabled -- auto-login
      if (data.session) {
        history.push("/");
        return;
      }

      // Otherwise, email confirmation is required
      setError(null);
      setSuccess(
        "We've sent a confirmation link to your email address. Please confirm your email to sign in."
      );
      setResendCooldown(60);
    } catch (err: any) {
      console.error("Signup error:", err);
      setSuccess(null);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || !email) return;

    setError(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (error) throw error;
      setSuccess("Confirmation email resent. Please check your inbox.");
      setResendCooldown(60);
    } catch (err: any) {
      console.error("Resend error:", err);
      setError(err.message);
    }
  }, [email, resendCooldown]);

  return (
    <div style={{ width: "100%" }}>
      <Title 
        order={2} 
        ta="left" 
        fw={900} 
        style={{
          background: "linear-gradient(45deg, var(--color-violet), var(--color-pink))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        Create your account
      </Title>
      <Text c="dimmed" size="sm" ta="left" mt={5}>
        Join CoWatch and watch together with friends.
      </Text>

      <Paper 
        p={30} 
        mt={30} 
        radius="lg" 
        style={{ 
          background: "var(--surface-hover)", 
          border: "2px dashed var(--border-subtle)" 
        }}
      >
        {error && (
          <Alert color="red" mb="md" title="Error">
            {error}
          </Alert>
        )}

        {success ? (
          <div>
            <Alert color="green" title="Check your email" mb="md">
              {success}
            </Alert>
            <Button
              fullWidth
              variant="default"
              onClick={handleResend}
              disabled={resendCooldown > 0}
            >
              {resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : "Resend confirmation email"}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <TextInput
              label="Username"
              placeholder="Username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
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
            <PasswordInput
              label="Confirm Password"
              placeholder="Confirm password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <Button fullWidth type="submit" mt="md" loading={submitting}>
              Create account
            </Button>
          </form>
        )}
      </Paper>
      <Text size="sm" ta="center" mt="md" c="dimmed">
        Already have an account?{" "}
        <Link to="/login" style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>
          Sign in
        </Link>
      </Text>
    </div>
  );
};
