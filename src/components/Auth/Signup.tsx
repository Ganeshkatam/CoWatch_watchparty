import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useHistory, Link } from "react-router-dom";
import { PasswordInput, Button, Paper, Title, Text, Alert, Stack, TextInput } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconAlertCircle, IconArrowRight, IconCalendar, IconShieldCheck, IconLock } from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import config from "../../config";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { autoCreateUsername } from "../../utils/utils";

const MINIMUM_AGE = 18;

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
  const [birthdateValue, setBirthdateValue] = useState<string | null>(null);
  const [ageGateComplete, setAgeGateComplete] = useState<boolean>(false);
  const [underage, setUnderage] = useState(false);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
  const enabledOptions = (config.VITE_AUTH_SIGNIN_METHODS || "google,email").split(",");
  const googleSignupConfigured = enabledOptions.includes("google");

  const handleAgeVerification = (e: React.FormEvent) => {
    e.preventDefault();
    setAgeError(null);
    setUnderage(false);

    if (!birthdateValue) {
      setAgeError("Please select your date of birth to continue.");
      return;
    }

    const age = calculateAge(birthdateValue);
    if (age === null || birthdateValue > getTodayIsoDate()) {
      setAgeError("Please select a valid date of birth.");
      return;
    }

    if (age < MINIMUM_AGE) {
      setUnderage(true);
      return;
    }

    setAgeGateComplete(true);
    setError(null);
  };

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

    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    if (!isAllowedEmailDomain(email)) {
      setError(EMAIL_PROVIDER_ERROR);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
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

      if (data.session) {
        history.push("/");
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
              <div className={styles.ageLockIcon} aria-hidden="true"><IconLock size={28} /></div>
              <Text fw={700} ta="center">Account creation is unavailable</Text>
              <Text c="dimmed" size="sm" ta="center">
                Sorry, you must be at least {MINIMUM_AGE} years old to create a CoWatch account.
              </Text>
              <Button
                variant="default"
                fullWidth
                onClick={() => {
                  setBirthdateValue(null);
                  setAgeGateComplete(false);
                  setUnderage(false);
                }}
              >
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

                <DatePickerInput
                  size="md"
                  label="Date of birth"
                  description={`You must be at least ${MINIMUM_AGE} years old to create an account.`}
                  placeholder="Select your date of birth"
                  required
                  clearable
                  maxDate={new Date()}
                  defaultDate={new Date(new Date().getFullYear() - 20, 0, 1)}
                  value={birthdateValue}
                  onChange={(val) => {
                    setBirthdateValue(val);
                    setAgeError(null);
                  }}
                  leftSection={<IconCalendar size={18} style={{ color: "var(--color-violet)" }} />}
                  valueFormat="DD MMMM YYYY"
                  popoverProps={{
                    shadow: "xl",
                    radius: "lg",
                    position: "bottom-start",
                    offset: 8,
                    classNames: {
                      dropdown: styles.datePickerDropdown,
                    },
                  }}
                  classNames={{
                    root: styles.datePickerRoot,
                    input: styles.datePickerInputField,
                    calendarHeader: styles.calendarHeader,
                    calendarHeaderControl: styles.calendarHeaderControl,
                    calendarHeaderLevel: styles.calendarHeaderLevel,
                    weekday: styles.weekday,
                    day: styles.calendarDay,
                    monthsListControl: styles.pickerControl,
                    yearsListControl: styles.pickerControl,
                  }}
                  error={
                    ageError ? (
                      <span>
                        <IconAlertCircle size={14} style={{ verticalAlign: "middle" }} /> {ageError}
                      </span>
                    ) : undefined
                  }
                />

                <Button fullWidth type="submit" rightSection={<IconArrowRight size={18} />} disabled={!birthdateValue}>
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
          <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div>
              <TextInput label="Name" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
              <Text size="xs" c="dimmed" mt={4}>
                Auto-created username: <span style={{ color: "var(--color-violet)", fontWeight: 600 }}>@{autoUsername}</span>
              </Text>
            </div>
            <div>
              <TextInput label="Email" placeholder="your@email.com" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <Text size="xs" c="dimmed" mt={4}>
                Use Gmail, Outlook, Hotmail, Live, MSN, Yahoo, Zoho, or Proton.
              </Text>
            </div>
            <PasswordInput label="Password" placeholder="Your password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordInput label="Confirm Password" placeholder="Confirm password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            <Button fullWidth type="submit" mt="md" loading={submitting}>Create account</Button>
          </form>
        )}

        {googleSignupConfigured && !success && (
          <Text size="xs" c="dimmed" ta="center" mt="md">
            Google account creation is temporarily unavailable while mandatory age verification is enforced server-side. Use email sign-up to create a new account.
          </Text>
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
