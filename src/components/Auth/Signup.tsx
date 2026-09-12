import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useHistory, useLocation, Link } from "react-router-dom";
import { PasswordInput, Button, Paper, Title, Text, Alert, TextInput } from "@mantine/core";
import { supabase } from "../../utils/supabaseClient";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { autoCreateUsername } from "../../utils/utils";
import { calculateAge } from "../../utils/age";

const ALLOWED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "zoho.com",
  "proton.me",
  "protonmail.com",
]);

const EMAIL_PROVIDER_ERROR = "Email provider is not supported.";

const isAllowedEmailDomain = (value: string) => {
  const email = value.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1 || /\s/.test(email)) {
    return false;
  }
  return ALLOWED_EMAIL_DOMAINS.has(email.slice(at + 1));
};

export const Signup = () => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [dobError, setDobError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [usernameSuffix] = useState(() => Math.floor(1000 + Math.random() * 9000));
  const autoUsername = useMemo(
    () => autoCreateUsername(name, email, usernameSuffix),
    [name, email, usernameSuffix]
  );

  useDocumentMetadata({
    title: "Sign Up",
    description: "Create a free CoWatch account to host watch parties and connect with friends.",
  });
  const history = useHistory();
  const location = useLocation();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setDobError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    if (!dob) {
      const msg = "Please enter your date of birth";
      setDobError(msg);
      setError(msg);
      return;
    }

    const ageCheck = calculateAge(dob);
    if (!ageCheck.valid || !ageCheck.isEligible) {
      const msg = ageCheck.error || "You must be at least 18 years of age to create an account.";
      setDobError(msg);
      setError(msg);
      return;
    }

    if (!isAllowedEmailDomain(email)) {
      setError(EMAIL_PROVIDER_ERROR);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            full_name: name.trim(),
            display_name: name.trim(),
            username: autoUsername,
          },
        },
      });
      if (error) {
        if (error.message.includes(EMAIL_PROVIDER_ERROR)) {
          throw new Error(EMAIL_PROVIDER_ERROR);
        }
        throw error;
      }

      const params = new URLSearchParams(location.search);
      const redirect = params.get("redirect") || params.get("next") || "/";

      if (data.session) {
        history.push(redirect);
        return;
      }

      setSuccess("We've sent a confirmation link to your email address. Please confirm your email to sign in.");
      setResendCooldown(60);
    } catch (err: any) {
      console.error("Signup error:", err);
      setSuccess(null);
      setError(err?.message === EMAIL_PROVIDER_ERROR ? EMAIL_PROVIDER_ERROR : err?.message || "Unable to create your account.");
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
        email: email.trim(),
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
        Join CoWatch to host watch parties and watch together with friends.
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
          <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div>
              <TextInput label="Name" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <TextInput
                label="Date of birth"
                type="date"
                required
                value={dob}
                onChange={(e) => {
                  setDob(e.target.value);
                  if (dobError) setDobError(null);
                }}
                error={dobError}
                max={new Date().toISOString().split("T")[0]}
              />
              <Text size="xs" c="dimmed" mt={4}>
                Used solely for age eligibility verification. Your date of birth is not stored or shared on your profile.
              </Text>
            </div>
            <div>
              <TextInput label="Email" placeholder="your@email.com" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <Text size="xs" c="dimmed" mt={4}>
                Use Gmail, Outlook, Hotmail, Live, MSN, Yahoo, Zoho, or Proton.
              </Text>
            </div>
            <PasswordInput label="Password" placeholder="Your password" required value={password} onChange={(e) => setPassword(e.target.value)} />

            <Button fullWidth type="submit" mt="md" loading={submitting}>Create account</Button>
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              By creating an account, you agree to our{" "}
              <Link to="/terms" style={{ color: "var(--color-violet)", textDecoration: "underline" }}>
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" style={{ color: "var(--color-violet)", textDecoration: "underline" }}>
                Privacy Policy
              </Link>
              .
            </Text>
          </form>
        )}
      </Paper>
      <Text size="sm" ta="center" mt="md" c="dimmed">
        Already have an account?{" "}
        <Link to={{ pathname: "/login", search: location.search }} style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>
          Sign in
        </Link>
      </Text>
    </div>
  );
};
