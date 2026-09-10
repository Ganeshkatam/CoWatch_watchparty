import React, { useState, useEffect, useCallback } from "react";
import { useHistory, useLocation, Link } from "react-router-dom";
import {
  TextInput,
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Alert,
  Divider,
  Stack,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBrandGoogleFilled,
  IconCalendar,
  IconShieldCheck,
  IconLock,
} from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import config from "../../config";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

const MINIMUM_AGE = 13;

const getTodayIsoDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const calculateAge = (birthdate: string) => {
  const [year, month, day] = birthdate.split("-").map(Number);
  if (!year || !month || !day) return null;

  const dob = new Date(year, month - 1, day);
  if (
    Number.isNaN(dob.getTime()) ||
    dob.getFullYear() !== year ||
    dob.getMonth() !== month - 1 ||
    dob.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDelta = today.getMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < day)) age -= 1;
  return age;
};

export const Signup = () => {
  const [birthdate, setBirthdate] = useState("");
  const [ageGateComplete, setAgeGateComplete] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useDocumentMetadata({
    title: "Sign Up",
    description: "Create a free CoWatch account to host watch parties and connect with friends.",
  });
  const history = useHistory();
  const location = useLocation();

  const handleAgeVerification = (e: React.FormEvent) => {
    e.preventDefault();
    setAgeError(null);
    setUnderage(false);

    if (!birthdate) {
      setAgeError("Please enter your date of birth to continue.");
      return;
    }

    const age = calculateAge(birthdate);
    if (age === null || birthdate > getTodayIsoDate()) {
      setAgeError("Please enter a valid date of birth.");
      return;
    }

    if (age < MINIMUM_AGE) {
      setUnderage(true);
      return;
    }

    setAgeGateComplete(true);
    setError(null);
  };

  const handleGoogleSignIn = async () => {
    if (!ageGateComplete) return;

    setError(null);
    setGoogleLoading(true);
    try {
      const params = new URLSearchParams(location.search);
      const redirect = params.get("redirect") || "/";
      const redirectTarget = redirect.startsWith("/") ? redirect : `/${redirect}`;
      const redirectTo = `${window.location.origin}${redirectTarget}`;
      const queryParams: Record<string, string> = {};
      if (email.trim()) queryParams.login_hint = email.trim();

      // The current Supabase browser OAuth API does not support attaching
      // custom signup metadata to the auth.users INSERT. The database guard
      // therefore permits existing OAuth users to sign in but rejects a new
      // OAuth account until the OAuth flow has a trusted age-verification path.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
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

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !ageGateComplete) return;

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
            birthdate,
            age_verified: true,
          },
        },
      });
      if (error) throw error;

      if (data.session) {
        history.push("/");
        return;
      }

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
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      setSuccess("Confirmation email resent. Please check your inbox.");
      setResendCooldown(60);
    } catch (err: any) {
      console.error("Resend error:", err);
      setError(err.message);
    }
  }, [email, resendCooldown]);

  if (!ageGateComplete) {
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
          Age Verification Required
        </Title>
        <Text c="dimmed" size="sm" ta="left" mt={5}>
          CoWatch requires age verification before you can create an account.
        </Text>

        <Paper withBorder p={30} mt={30} radius="lg" className={styles.authCard}>
          {underage ? (
            <Stack gap="md" align="center">
              <div className={styles.ageLockIcon} aria-hidden="true">
                <IconLock size={28} />
              </div>
              <Text fw={700} ta="center">Account creation is unavailable</Text>
              <Text c="dimmed" size="sm" ta="center">
                Sorry, you must be at least {MINIMUM_AGE} years old to create a CoWatch account.
              </Text>
              <Button variant="default" fullWidth onClick={() => { setBirthdate(""); setUnderage(false); }}>
                Check another date
              </Button>
            </Stack>
          ) : (
            <form onSubmit={handleAgeVerification}>
              <Stack gap="md">
                <div className={styles.ageBadge}>
                  <IconShieldCheck size={18} />
                  <span>Age verification</span>
                </div>

                <TextInput
                  label="Date of birth"
                  description={`You must be at least ${MINIMUM_AGE} years old to create an account.`}
                  type="date"
                  required
                  autoFocus
                  max={getTodayIsoDate()}
                  value={birthdate}
                  onChange={(e) => {
                    setBirthdate(e.target.value);
                    setAgeError(null);
                  }}
                  leftSection={<IconCalendar size={17} />}
                  error={
                    ageError ? (
                      <span>
                        <IconAlertCircle size={14} style={{ verticalAlign: "middle" }} /> {ageError}
                      </span>
                    ) : undefined
                  }
                />

                <Button
                  fullWidth
                  type="submit"
                  rightSection={<IconArrowRight size={18} />}
                  disabled={!birthdate}
                >
                  Continue
                </Button>

                <Text size="xs" c="dimmed" ta="center">
                  Your date of birth is used for the account age requirement.
                </Text>
              </Stack>
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
  }

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
        Your age requirement has been verified. Join CoWatch and watch together with friends.
      </Text>

      <Paper withBorder p={30} mt={30} radius="lg" className={styles.authCard}>
        {error && <Alert color="red" mb="md" title="Error">{error}</Alert>}

        {success ? (
          <div>
            <Alert color="green" title="Check your email" mb="md">{success}</Alert>
            <Button fullWidth variant="default" onClick={handleResend} disabled={resendCooldown > 0}>
              {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend confirmation email"}
            </Button>
          </div>
        ) : (
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
              <Divider label="Or sign up with email" labelPosition="center" my="xs" />
            )}

            {enabledOptions.includes("email") && (
              <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                <TextInput label="Username" placeholder="Username" required value={username} onChange={(e) => setUsername(e.target.value)} />
                <TextInput label="Email" placeholder="your@email.com" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                <PasswordInput label="Password" placeholder="Your password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <PasswordInput label="Confirm Password" placeholder="Confirm password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <Button fullWidth type="submit" mt="md" loading={submitting}>Create account</Button>
              </form>
            )}
          </div>
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
