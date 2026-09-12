import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useHistory, useLocation, Link } from "react-router-dom";
import {
  PasswordInput,
  Button,
  Paper,
  Title,
  Text,
  Alert,
  TextInput,
  Avatar,
  Group,
  Tooltip,
} from "@mantine/core";
import { IconPhoto, IconCheck, IconX } from "@tabler/icons-react";
import { supabase } from "../../utils/supabaseClient";
import styles from "./AuthShell.module.css";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { autoCreateUsername, openFileSelector } from "../../utils/utils";
import { calculateAge } from "../../utils/age";

export const SIGNUP_AVATAR_PRESETS = [
  { id: "avatar-1", label: "Neon Pop", url: "/avatars/avatar_1.jpg" },
  { id: "avatar-2", label: "Cosmic", url: "/avatars/avatar_2.jpg" },
  { id: "avatar-3", label: "Cyberpunk", url: "/avatars/avatar_3.jpg" },
  { id: "avatar-4", label: "Anime Chill", url: "/avatars/avatar_4.jpg" },
  { id: "avatar-5", label: "Retro Synth", url: "/avatars/avatar_5.jpg" },
];

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

  // Profile photo selection state
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(SIGNUP_AVATAR_PRESETS[0].url);
  const [customAvatarFile, setCustomAvatarFile] = useState<File | null>(null);
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [usernameSuffix] = useState(() => Math.floor(1000 + Math.random() * 9000));
  const autoUsername = useMemo(
    () => autoCreateUsername(name, email, usernameSuffix),
    [name, email, usernameSuffix]
  );

  const activeAvatarPreview = customAvatarPreview || selectedAvatarUrl || (name ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8b5cf6&color=ffffff` : "/avatars/avatar_1.jpg");

  const handleSelectPreset = (url: string) => {
    setSelectedAvatarUrl(url);
    setCustomAvatarFile(null);
    if (customAvatarPreview) {
      URL.revokeObjectURL(customAvatarPreview);
      setCustomAvatarPreview(null);
    }
    setAvatarError(null);
  };

  const handleUploadCustomPhoto = async () => {
    try {
      const files = await openFileSelector("image/jpeg,image/png,image/webp");
      if (!files || files.length === 0) return;
      const file = files[0];
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(file.type)) {
        setAvatarError("Only JPG, PNG, and WebP images are allowed.");
        return;
      }
      if (file.size > 1 * 1024 * 1024) {
        setAvatarError("Image must be smaller than 1MB.");
        return;
      }
      setAvatarError(null);
      setCustomAvatarFile(file);
      const preview = URL.createObjectURL(file);
      setCustomAvatarPreview(preview);
      setSelectedAvatarUrl(null);
    } catch (err) {
      console.warn("File selection failed:", err);
    }
  };

  const handleClearAvatar = () => {
    setSelectedAvatarUrl(null);
    setCustomAvatarFile(null);
    if (customAvatarPreview) {
      URL.revokeObjectURL(customAvatarPreview);
      setCustomAvatarPreview(null);
    }
    setAvatarError(null);
  };

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
      const avatarUrlPayload = selectedAvatarUrl ? selectedAvatarUrl : undefined;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            full_name: name.trim(),
            display_name: name.trim(),
            username: autoUsername,
            ...(avatarUrlPayload ? { avatar_url: avatarUrlPayload } : {}),
          },
        },
      });
      if (error) {
        if (error.message.includes(EMAIL_PROVIDER_ERROR)) {
          throw new Error(EMAIL_PROVIDER_ERROR);
        }
        throw error;
      }

      // Handle custom avatar file upload / persistence
      if (customAvatarFile) {
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          try {
            window.localStorage.setItem("cowatch-pending-avatar", dataUrl);
            window.localStorage.setItem("cowatch-pending-avatar-type", customAvatarFile.type);
          } catch (e) { }

          // If session returned immediately, upload directly
          if (data?.session?.user) {
            try {
              const fileExt = customAvatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
              const filePath = `${data.session.user.id}/profile_${Date.now()}.${fileExt}`;
              const { error: uploadError } = await supabase.storage.from("avatars").upload(filePath, customAvatarFile, {
                upsert: true,
                contentType: customAvatarFile.type,
              });
              if (!uploadError) {
                const { data: pubData } = supabase.storage.from("avatars").getPublicUrl(filePath);
                if (pubData?.publicUrl) {
                  await supabase.from("profiles").update({ avatar_url: pubData.publicUrl }).eq("id", data.session.user.id);
                  window.localStorage.removeItem("cowatch-pending-avatar");
                  window.localStorage.removeItem("cowatch-pending-avatar-type");
                }
              }
            } catch (err) {
              console.warn("Direct avatar upload warning:", err);
            }
          }
        };
        reader.readAsDataURL(customAvatarFile);
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
            <div className={styles.avatarSection}>
              <div className={styles.avatarPreviewRing}>
                <Avatar
                  src={activeAvatarPreview}
                  alt={name || "Profile avatar"}
                  size={70}
                  radius="50%"
                  className={styles.avatarPreviewItem}
                />
              </div>

              <div style={{ textAlign: "center" }}>
                <Text size="xs" fw={600} c="dimmed" mb={6}>
                  Choose your avatar
                </Text>
                <div className={styles.avatarPresetsRow}>
                  {SIGNUP_AVATAR_PRESETS.map((preset) => {
                    const isActive = selectedAvatarUrl === preset.url;
                    return (
                      <Tooltip label={preset.label} key={preset.id} withArrow>
                        <button
                          type="button"
                          onClick={() => handleSelectPreset(preset.url)}
                          className={`${styles.avatarPresetButton} ${isActive ? styles.avatarPresetButtonActive : ""}`}
                          aria-label={preset.label}
                        >
                          <Avatar src={preset.url} size={36} radius="50%" alt={preset.label} />
                          {isActive && (
                            <span className={styles.presetCheckBadge}>
                              <IconCheck size={11} stroke={3} />
                            </span>
                          )}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              <Group gap="xs" justify="center">
                <Button
                  type="button"
                  variant="subtle"
                  size="xs"
                  leftSection={<IconPhoto size={14} />}
                  onClick={handleUploadCustomPhoto}
                >
                  {customAvatarFile ? "Change custom photo" : "Upload photo"}
                </Button>
                {(selectedAvatarUrl || customAvatarFile) && (
                  <Button
                    type="button"
                    variant="subtle"
                    color="gray"
                    size="xs"
                    leftSection={<IconX size={14} />}
                    onClick={handleClearAvatar}
                  >
                    Reset
                  </Button>
                )}
              </Group>

              {avatarError && (
                <Text size="xs" c="red" ta="center">
                  {avatarError}
                </Text>
              )}
            </div>

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
