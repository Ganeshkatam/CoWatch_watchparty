import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useHistory, Link } from "react-router-dom";
import { TextInput, PasswordInput, Button, Paper, Title, Text, Alert, Stack, Select, Group } from "@mantine/core";
import { IconAlertCircle, IconArrowRight, IconShieldCheck, IconLock } from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import config from "../../config";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

const MINIMUM_AGE = 18;
const ALLOWED_EMAIL_DOMAINS = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "zoho.com", "proton.me", "protonmail.com",
]);
const EMAIL_PROVIDER_ERROR = "Email provider is not supported.";

const isAllowedEmailDomain = (value: string) => {
  const email = value.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1 || /\s/.test(email)) return false;
  return ALLOWED_EMAIL_DOMAINS.has(email.slice(at + 1));
};

const MONTHS = [
  { value: "01", label: "January" }, { value: "02", label: "February" }, { value: "03", label: "March" },
  { value: "04", label: "April" }, { value: "05", label: "May" }, { value: "06", label: "June" },
  { value: "07", label: "July" }, { value: "08", label: "August" }, { value: "09", label: "September" },
  { value: "10", label: "October" }, { value: "11", label: "November" }, { value: "12", label: "December" },
];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1910 + 1 }, (_, i) => {
  const y = String(currentYear - i); return { value: y, label: y };
});
const getDaysInMonth = (yearStr: string | null, monthStr: string | null) => {
  if (!monthStr) return 31;
  return new Date(yearStr ? parseInt(yearStr, 10) : 2000, parseInt(monthStr, 10), 0).getDate();
};
const getTodayIsoDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};
const calculateAge = (birthdate: string) => {
  const [year, month, day] = birthdate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const dob = new Date(year, month - 1, day);
  if (Number.isNaN(dob.getTime()) || dob.getFullYear() !== year || dob.getMonth() !== month - 1 || dob.getDate() !== day) return null;
  const today = new Date(); let age = today.getFullYear() - year;
  const monthDelta = today.getMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < day)) age -= 1;
  return age;
};

export const Signup = () => {
  const [birthMonth, setBirthMonth] = useState<string | null>(null), [birthDay, setBirthDay] = useState<string | null>(null), [birthYear, setBirthYear] = useState<string | null>(null), [birthdate, setBirthdate] = useState("");
  const [ageGateComplete, setAgeGateComplete] = useState(false), [underage, setUnderage] = useState(false), [ageError, setAgeError] = useState<string | null>(null);
  const [email, setEmail] = useState(""), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null), [submitting, setSubmitting] = useState(false), [resendCooldown, setResendCooldown] = useState(0);
  const maxDays = useMemo(() => getDaysInMonth(birthYear, birthMonth), [birthYear, birthMonth]);
  const daysData = useMemo(() => Array.from({ length: maxDays }, (_, i) => { const d = String(i + 1).padStart(2, "0"); return { value: d, label: String(i + 1) }; }), [maxDays]);
  useEffect(() => { if (birthDay && parseInt(birthDay, 10) > maxDays) setBirthDay(String(maxDays).padStart(2, "0")); }, [maxDays, birthDay]);
  useEffect(() => { if (birthYear && birthMonth && birthDay) { setBirthdate(`${birthYear}-${birthMonth}-${birthDay}`); setAgeError(null); } else setBirthdate(""); }, [birthYear, birthMonth, birthDay]);
  useEffect(() => { if (resendCooldown <= 0) return; const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000); return () => clearTimeout(timer); }, [resendCooldown]);
  useDocumentMetadata({ title: "Sign Up", description: "Create a free CoWatch account to host watch parties and connect with friends." });
  const history = useHistory();
  const googleSignupConfigured = (config.VITE_AUTH_SIGNIN_METHODS || "google,email").split(",").includes("google");

  const handleAgeVerification = (e: React.FormEvent) => {
    e.preventDefault(); setAgeError(null); setUnderage(false);
    if (!birthdate) return setAgeError("Please enter your date of birth to continue.");
    const age = calculateAge(birthdate);
    if (age === null || birthdate > getTodayIsoDate()) return setAgeError("Please enter a valid date of birth.");
    if (age < MINIMUM_AGE) return setUnderage(true);
    setAgeGateComplete(true); setError(null);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault(); if (submitting || !ageGateComplete) return;
    setError(null); setSuccess(null);
    if (!isAllowedEmailDomain(email)) { setError(EMAIL_PROVIDER_ERROR); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: username.trim(), display_name: username.trim(), birthdate, age_verified: true } } });
      if (error) {
        if (error.message.includes(EMAIL_PROVIDER_ERROR)) throw new Error(EMAIL_PROVIDER_ERROR);
        throw error;
      }
      if (data.session) { history.push("/"); return; }
      setSuccess("We've sent a confirmation link to your email address. Please confirm your email to sign in."); setResendCooldown(60);
    } catch (err: any) { console.error("Signup error:", err); setSuccess(null); setError(err?.message === EMAIL_PROVIDER_ERROR ? EMAIL_PROVIDER_ERROR : err?.message || "Unable to create your account."); }
    finally { setSubmitting(false); }
  };
  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || !email) return; setError(null);
    try { const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() }); if (error) throw error; setSuccess("Confirmation email resent. Please check your inbox."); setResendCooldown(60); }
    catch (err: any) { console.error("Resend error:", err); setError(err.message); }
  }, [email, resendCooldown]);

  if (!ageGateComplete) return <div style={{ width: "100%" }}><Title order={2} ta="left" fw={900} style={{ background: "linear-gradient(45deg, var(--color-violet), var(--color-pink))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Age Verification Required</Title><Text c="dimmed" size="sm" ta="left" mt={5}>CoWatch requires age verification before you can create an account.</Text><Paper withBorder p={30} mt={30} radius="lg" className={styles.authCard}>{underage ? <Stack gap="md" align="center"><div className={styles.ageLockIcon} aria-hidden="true"><IconLock size={28} /></div><Text fw={700} ta="center">Account creation is unavailable</Text><Text c="dimmed" size="sm" ta="center">Sorry, you must be at least {MINIMUM_AGE} years old to create a CoWatch account.</Text><Button variant="default" fullWidth onClick={() => { setBirthMonth(null); setBirthDay(null); setBirthYear(null); setBirthdate(""); setUnderage(false); }}>Check another date</Button></Stack> : <form onSubmit={handleAgeVerification}><Stack gap="md"><div className={styles.ageBadge}><IconShieldCheck size={18} /><span>Age verification</span></div><div><Text size="sm" fw={500} mb={4}>Date of birth <span style={{ color: "var(--color-danger)" }}>*</span></Text><Text size="xs" c="dimmed" mb={10}>You must be at least {MINIMUM_AGE} years old to create an account.</Text><Group grow gap="xs"><Select placeholder="Month" data={MONTHS} value={birthMonth} onChange={v => { setBirthMonth(v); setAgeError(null); }} searchable clearable aria-label="Birth month" /><Select placeholder="Day" data={daysData} value={birthDay} onChange={v => { setBirthDay(v); setAgeError(null); }} searchable clearable aria-label="Birth day" /><Select placeholder="Year" data={YEARS} value={birthYear} onChange={v => { setBirthYear(v); setAgeError(null); }} searchable clearable aria-label="Birth year" /></Group>{ageError && <Text c="red" size="xs" mt={8} style={{ display: "flex", alignItems: "center", gap: 4 }}><IconAlertCircle size={14} />{ageError}</Text>}</div><Button fullWidth type="submit" rightSection={<IconArrowRight size={18} />} disabled={!birthdate}>Continue</Button><Text size="xs" c="dimmed" ta="center">Your date of birth is used for the account age requirement.</Text></Stack></form>}</Paper><Text size="sm" ta="center" mt="md" c="dimmed">Already have an account? <Link to="/login" style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>Sign in</Link></Text></div>;

  return <div style={{ width: "100%" }}><Title order={2} ta="left" fw={900} style={{ background: "linear-gradient(45deg, var(--color-violet), var(--color-pink))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Create your account</Title><Text c="dimmed" size="sm" ta="left" mt={5}>Your age requirement has been verified. Join CoWatch and watch together with friends.</Text><Paper withBorder p={30} mt={30} radius="lg" className={styles.authCard}>{error && <Alert color="red" mb="md" title="Error">{error}</Alert>}{success ? <div><Alert color="green" title="Check your email" mb="md">{success}</Alert><Button fullWidth variant="default" onClick={handleResend} disabled={resendCooldown > 0}>{resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend confirmation email"}</Button></div> : <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "15px" }}><TextInput label="Username" placeholder="Username" required value={username} onChange={e => setUsername(e.target.value)} /><TextInput label="Email" placeholder="your@email.com" type="email" required value={email} onChange={e => setEmail(e.target.value)} /><Text size="xs" c="dimmed" mt={-8}>Use Gmail, Outlook, Hotmail, Live, MSN, Yahoo, Zoho, or Proton.</Text><PasswordInput label="Password" placeholder="Your password" required value={password} onChange={e => setPassword(e.target.value)} /><PasswordInput label="Confirm Password" placeholder="Confirm password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /><Button fullWidth type="submit" mt="md" loading={submitting}>Create account</Button></form>}{googleSignupConfigured && !success && <Text size="xs" c="dimmed" ta="center" mt="md">Google account creation is temporarily unavailable while mandatory age verification is enforced server-side. Use email sign-up to create a new account.</Text>}</Paper><Text size="sm" ta="center" mt="md" c="dimmed">Already have an account? <Link to="/login" style={{ color: "var(--color-violet)", textDecoration: "underline", fontWeight: 600 }}>Sign in</Link></Text></div>;
};
