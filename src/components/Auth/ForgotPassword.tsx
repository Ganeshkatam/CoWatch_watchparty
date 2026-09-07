import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  TextInput,
  Button,
  Container,
  Paper,
  Title,
  Text,
  Alert,
  Center,
} from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import styles from "./AuthShell.module.css";

export const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSuccess(true);
    } catch (err: any) {
      console.error("Password reset request error:", err);
      setError(err.message);
    }
  };

  return (
    <div style={{ width: "100%" }}>
      <Center mb={20}>
        <div style={{ 
          background: "var(--surface-hover)", 
          padding: "16px", 
          borderRadius: "50%",
          display: "flex"
        }}>
          <IconLock size={32} color="var(--color-violet)" />
        </div>
      </Center>
      <Title order={2} ta="center" fw={800}>Reset your password</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5} mx="auto" maw={300}>
        Enter your email and we'll send you a password-reset link.
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
        
        {success ? (
          <div>
            <Alert color="green" title="Check your email" mb="md">
              We've sent password-reset instructions if an account exists for that address.
            </Alert>
            <Button component={Link} to="/login" fullWidth variant="default">
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <TextInput
              label="Email"
              placeholder="your@email.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button fullWidth type="submit" mt="md">
              Send reset link
            </Button>
          </form>
        )}
      </Paper>
      {!success && (
        <Text size="sm" ta="center" mt="md" c="dimmed">
          Remember your password?{" "}
          <Link to="/login" style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>
            Sign in
          </Link>
        </Text>
      )}
    </div>
  );
};
