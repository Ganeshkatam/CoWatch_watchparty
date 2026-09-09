import React, { useState, useEffect } from "react";
import { useHistory } from "react-router-dom";
import {
  PasswordInput,
  Button,
  Container,
  Paper,
  Title,
  Text,
  Alert,
  Center,
} from "@mantine/core";
import { IconShieldCheck } from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

export const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const history = useHistory();

  useDocumentMetadata({
    title: "Reset Password",
    description: "Create a new password for your CoWatch account.",
    noIndex: true,
  });

  useEffect(() => {
    // Supabase will automatically parse the hash containing the recovery token
    // and establish a session. We can listen for the hash change or just rely on
    // supabase.auth.onAuthStateChange in App, but here we just need to ensure
    // we have a session to update the password.
    
    // Check if we have an active session (user followed the email link)
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setError("Invalid or expired password reset link. Please request a new one.");
      }
    };
    checkSession();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });
      if (error) throw error;
      
      // Successfully updated password, show success state
      setSuccess(true);
    } catch (err: any) {
      console.error("Password update error:", err);
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
          <IconShieldCheck size={32} color="var(--color-teal)" />
        </div>
      </Center>
      <Title order={2} ta="center" fw={800}>Choose a new password</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Enter your new password below.
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
            <Alert color="green" title="Password updated" mb="md">
              Your password has been changed successfully.
            </Alert>
            <Button onClick={() => history.push("/login")} fullWidth>
              Sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleUpdate} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <PasswordInput
              label="New Password"
              placeholder="New password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              label="Confirm New Password"
              placeholder="Confirm new password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <Button fullWidth type="submit" mt="md" disabled={!!error && error.includes("Invalid")}>
              Update password
            </Button>
          </form>
        )}
      </Paper>
    </div>
  );
};
