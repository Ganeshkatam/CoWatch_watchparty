import React, { useContext, useEffect, useState } from "react";
import { Redirect, useHistory, useLocation } from "react-router-dom";
import {
  Modal,
  Button,
  Avatar,
  Switch,
  Group,
  Text,
  Tabs,
  TextInput,
  SegmentedControl,
  Alert,
  Loader,
  Badge,
} from "@mantine/core";
import { supabase } from "../../utils/supabaseClient";
import { serverPath, openFileSelector } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import {
  IconAlertTriangle,
  IconCircleCheckFilled,
  IconKeyFilled,
  IconLogout,
  IconTrashFilled,
  IconUpload,
  IconSettings,
  IconUser,
  IconLock,
  IconPencil,
  IconCheck,
} from "@tabler/icons-react";
import { useAppearance } from "../../theme/ThemeProvider";
import { setDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Profile.module.css";

const AppearanceSelector = () => {
  const { appearance, setAppearance } = useAppearance();
  return (
    <SegmentedControl
      value={appearance}
      onChange={(value) => setAppearance(value as any)}
      data={[
        { label: "Light", value: "light" },
        { label: "Mantine", value: "mantine" },
        { label: "System", value: "system" },
      ]}
      color="violet"
    />
  );
};

export const Profile: React.FC = () => {
  const context = useContext(MetadataContext);
  const location = useLocation();
  const history = useHistory();

  // Tab routing determination
  const pathname = location.pathname;
  const isPreferences = pathname === "/account/preferences";
  const isSecurity = pathname === "/account/security";
  const isProfile = pathname === "/account/profile";

  // Redirect invalid or root /account URLs to /account/profile
  const shouldRedirectToProfile =
    !isProfile && !isPreferences && !isSecurity;

  const activeTab = isPreferences
    ? "preferences"
    : isSecurity
    ? "security"
    : "profile";

  // Form & UI States
  const [displayName, setDisplayName] = useState("");
  const [originalDisplayName, setOriginalDisplayName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);

  // Preference switches
  const [prefShowChatColumn, setPrefShowChatColumn] = useState(true);
  const [prefShowPeopleColumn, setPrefShowPeopleColumn] = useState(false);
  const [prefDisableChatSound, setPrefDisableChatSound] = useState(false);
  const [prefCameraOn, setPrefCameraOn] = useState(false);
  const [prefMicOn, setPrefMicOn] = useState(false);

  // Modals & alerts
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetDisabled, setResetDisabled] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Set document metadata based on active sub-route
  useEffect(() => {
    const titles: Record<string, string> = {
      profile: "Profile | Account Settings",
      preferences: "Preferences | Account Settings",
      security: "Security | Account Settings",
    };
    const descriptions: Record<string, string> = {
      profile: "Manage your CoWatch profile identity and display name.",
      preferences: "Customize room, media, and appearance preferences.",
      security: "Manage your account authentication, password, and session.",
    };

    const cleanup = setDocumentMetadata({
      title: titles[activeTab] || "Account Settings",
      description: descriptions[activeTab] || "Manage your account settings.",
      noIndex: true,
    });
    return () => cleanup?.();
  }, [activeTab]);

  // Sync profile data from context
  useEffect(() => {
    if (context.user) {
      const effectiveName =
        context.displayName && context.displayName !== "Guest"
          ? context.displayName
          : context.profile?.display_name ||
            context.user.email?.split("@")[0] ||
            "";

      if (!hasLoadedProfile || (!displayName && effectiveName)) {
        setDisplayName(displayName || effectiveName);
        setOriginalDisplayName(originalDisplayName || effectiveName);
        setPrefShowChatColumn(context.profile?.pref_show_chat_column ?? true);
        setPrefShowPeopleColumn(context.profile?.pref_show_people_column ?? false);
        setPrefDisableChatSound(context.profile?.pref_disable_chat_sound ?? false);
        setPrefCameraOn(context.profile?.pref_camera_on ?? false);
        setPrefMicOn(context.profile?.pref_mic_on ?? false);
        setHasLoadedProfile(Boolean(context.profile));
      }
    }
  }, [context.user, context.profile, context.displayName, hasLoadedProfile, displayName, originalDisplayName]);

  // Tab change pushes to router history for full URL navigation
  const handleTabChange = (val: string | null) => {
    if (!val) return;
    if (val !== activeTab) {
      history.push(`/account/${val}`);
    }
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const resetPassword = async () => {
    try {
      if (context.user?.email) {
        await supabase.auth.resetPasswordForEmail(context.user.email);
        setResetDisabled(true);
        setResetSuccessMessage(`Password reset link sent to ${context.user.email}. Please check your inbox.`);
      }
    } catch (e: any) {
      console.warn("Reset password error:", e);
      setAvatarError(e?.message || "Failed to send password reset email.");
    }
  };

  const uploadAvatar = async () => {
    const user = context.user;
    if (!user) return;
    const prevAvatarUrl = context.avatarUrl;
    setAvatarError(null);

    try {
      const files = await openFileSelector("image/*");
      if (!files || files.length === 0) return;
      const file = files[0];
      const fileExt = file.name.split(".").pop()?.toLowerCase();
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

      if (!allowedTypes.includes(file.type)) {
        setAvatarError("Only JPG, PNG, and WebP images are allowed.");
        return;
      }
      if (file.size > 1 * 1024 * 1024) {
        setAvatarError("Image must be smaller than 1MB.");
        return;
      }

      setIsUploadingAvatar(true);
      const uniqueTimestamp = Date.now();
      const filePath = `${user.id}/profile_${uniqueTimestamp}.${fileExt}`;

      // Optimistically update preview
      const previewUrl = URL.createObjectURL(file);
      context.setMetadata({ avatarUrl: previewUrl });

      // Clean up previous avatars
      const { data: existingFiles } = await supabase.storage.from("avatars").list(user.id);
      if (existingFiles && existingFiles.length > 0) {
        const filesToRemove = existingFiles.map((x) => `${user.id}/${x.name}`);
        const { error: removeError } = await supabase.storage.from("avatars").remove(filesToRemove);
        if (removeError) {
          console.warn("Avatar cleanup warning:", removeError);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      // Update public.profiles
      const { error: dbError } = await supabase.from("profiles").upsert({
        id: user.id,
        avatar_url: publicUrl,
        updated_at: new Date().toISOString(),
      });

      if (dbError) throw dbError;

      // Update auth.users metadata
      await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });

      context.setMetadata({ avatarUrl: publicUrl });
    } catch (e: any) {
      console.error("Avatar upload failed:", e);
      setAvatarError("Failed to upload avatar: " + (e.message || e));
      context.setMetadata({ avatarUrl: prevAvatarUrl });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const saveDisplayName = async () => {
    if (!context.user) return;
    const trimmed = displayName.trim();
    if (trimmed.length > 50) return;

    const fallbackName =
      context.user?.user_metadata?.display_name?.trim() ||
      context.user?.user_metadata?.full_name?.trim() ||
      context.user?.user_metadata?.name?.trim() ||
      context.profile?.username ||
      context.user?.email?.split("@")[0] ||
      "User";
    const finalDisplayName = trimmed || fallbackName;

    const prevName = context.displayName;
    setDisplayName(finalDisplayName);
    setOriginalDisplayName(finalDisplayName);
    setIsEditingName(false);
    context.setMetadata({ displayName: finalDisplayName });

    const { error } = await supabase.from("profiles").upsert({
      id: context.user.id,
      display_name: finalDisplayName,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Failed to save display name:", error);
      setDisplayName(prevName || "");
      setOriginalDisplayName(prevName || "");
      setIsEditingName(true);
      context.setMetadata({ displayName: prevName });
    } else {
      try {
        await supabase.auth.updateUser({
          data: { display_name: finalDisplayName },
        });
      } catch (authErr) {
        console.warn("Failed to sync auth display name:", authErr);
      }
    }
  };

  const updatePreference = async (key: string, value: boolean) => {
    if (key === "pref_show_chat_column") setPrefShowChatColumn(value);
    if (key === "pref_show_people_column") setPrefShowPeopleColumn(value);
    if (key === "pref_disable_chat_sound") setPrefDisableChatSound(value);
    if (key === "pref_camera_on") setPrefCameraOn(value);
    if (key === "pref_mic_on") setPrefMicOn(value);

    if (!context.user) return;

    await supabase.from("profiles").upsert({
      id: context.user.id,
      [key]: value,
      updated_at: new Date().toISOString(),
    });

    if (key === "pref_show_chat_column") {
      window.localStorage.setItem("cowatch-showchatcolumn", value ? "1" : "0");
    }
    if (key === "pref_show_people_column") {
      window.localStorage.setItem("cowatch-showpeoplecolumn", value ? "1" : "0");
    }
    if (key === "pref_disable_chat_sound") {
      const settingsStr = window.localStorage.getItem("cowatch-setting") || "{}";
      try {
        const settings = JSON.parse(settingsStr);
        settings.disableChatSound = value;
        window.localStorage.setItem("cowatch-setting", JSON.stringify(settings));
      } catch (e) {}
    }
  };

  const deleteAccount = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    await fetch(serverPath + "/api/account/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    await supabase.auth.signOut({ scope: "local" });
    window.location.href = "/";
  };

  if (shouldRedirectToProfile) {
    return <Redirect to="/account/profile" />;
  }

  if (!context.user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontWeight: 300, color: "var(--text-secondary)" }}>
          Please sign in to view your account.
        </h2>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .profile-btn {
          transition: all 0.2s ease;
        }
        .profile-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
        }
        .glass-card {
          background: var(--glass-bg);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--glass-border);
          border-radius: 16px;
          box-shadow: 0 8px 32px var(--glass-shadow);
        }
      `}</style>

      {/* Account Deletion Confirmation Modal */}
      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Your Account"
        centered
        overlayProps={{ blur: 5, color: "var(--overlay-scrim)", opacity: 1 }}
      >
        <div style={{ padding: "10px 0" }}>
          <p style={{ color: "var(--text-primary)", marginBottom: "10px" }}>
            Are you sure you want to delete your account? This action is permanent and cannot be undone.
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9em", marginBottom: "20px" }}>
            This permanently deletes your CoWatch account, profile, preferences, and uploaded profile picture.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <Button variant="subtle" color="gray" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={deleteAccount}>
              Yes, Delete My Account
            </Button>
          </div>
        </div>
      </Modal>

      {/* Avatar Error Modal */}
      <Modal
        opened={Boolean(avatarError)}
        onClose={() => setAvatarError(null)}
        title="Avatar Upload Notice"
        centered
        overlayProps={{ blur: 5, color: "var(--overlay-scrim)", opacity: 1 }}
      >
        <div style={{ padding: "10px 0" }}>
          <p style={{ color: "var(--text-primary)", marginBottom: "20px" }}>
            {avatarError}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button color="violet" onClick={() => setAvatarError(null)}>
              Understood
            </Button>
          </div>
        </div>
      </Modal>

      <div className={`glass-card ${styles.card}`}>
        {/* Decorative background glow */}
        <div
          style={{
            position: "absolute",
            top: "-50%",
            left: "-50%",
            width: "200%",
            height: "200%",
            background: "radial-gradient(circle at 50% 0%, rgba(66, 133, 244, 0.1) 0%, transparent 50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        <div className={styles.content}>
          <h1
            style={{
              margin: "0 0 8px 0",
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
              fontSize: "1.8rem",
              background: "linear-gradient(90deg, var(--text-primary), var(--text-muted))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Account Settings
          </h1>
          <p style={{ margin: "0 0 28px 0", color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            Manage your profile, watching preferences, and security settings.
          </p>

          {/* Profile Header Summary */}
          <div className={styles.profileHeader}>
            <Avatar
              className={styles.avatar}
              size={120}
              src={context.avatarUrl}
              style={{
                border: "2px solid var(--border-subtle)",
                boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
              }}
            />
            <div className={styles.identity}>
              <div className={styles.identityName}>
                <span style={{ fontSize: "1.2rem", fontWeight: 500, color: "var(--text-primary)" }}>
                  {originalDisplayName || context.displayName || context.user?.email?.split("@")[0]}
                </span>
                {context.user?.user_metadata?.email_verified && (
                  <IconCircleCheckFilled title="Verified" color="var(--color-success)" size={18} />
                )}
              </div>
              <span className={styles.identityEmail} style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                {context.user?.email}
              </span>
            </div>

            <Button
              leftSection={isUploadingAvatar ? <Loader size="xs" color="violet" /> : <IconUpload size={16} />}
              onClick={uploadAvatar}
              disabled={isUploadingAvatar}
              variant="light"
              color="violet"
              className={`profile-btn ${styles.uploadButton}`}
            >
              {isUploadingAvatar
                ? "Uploading..."
                : context.avatarUrl
                ? "Change Picture"
                : "Upload Picture"}
            </Button>
          </div>

          {/* Navigation Tabs with URL routing under /account/* */}
          <Tabs value={activeTab} onChange={handleTabChange} color="violet">
            <Tabs.List className={styles.tabsList} mb="xl">
              <Tabs.Tab value="profile" leftSection={<IconUser size={16} />}>
                Profile
              </Tabs.Tab>
              <Tabs.Tab value="preferences" leftSection={<IconSettings size={16} />}>
                Preferences
              </Tabs.Tab>
              <Tabs.Tab value="security" leftSection={<IconLock size={16} />}>
                Security
              </Tabs.Tab>
            </Tabs.List>

            {/* Profile Sub-navigation View (/account/profile) */}
            <Tabs.Panel value="profile">
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div
                  style={{
                    padding: "20px",
                    background: "var(--bg-elevated)",
                    borderRadius: "12px",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}
                  >
                    Display Name
                  </Text>
                  <Text size="xs" c="dimmed" mb="md">
                    This is the name other participants will see in watch parties and chats.
                  </Text>

                  {isEditingName ? (
                    <Group align="flex-end" gap="sm">
                      <TextInput
                        autoFocus
                        style={{ flex: 1 }}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            saveDisplayName();
                          } else if (e.key === "Escape") {
                            setDisplayName(originalDisplayName);
                            setIsEditingName(false);
                          }
                        }}
                        maxLength={50}
                        placeholder="Enter your display name"
                        styles={{
                          input: {
                            backgroundColor: "var(--bg-surface)",
                            border: "1px solid var(--color-violet)",
                            color: "var(--text-primary)",
                            height: "45px",
                          },
                        }}
                      />
                      <Button
                        leftSection={<IconCheck size={16} />}
                        color="violet"
                        style={{ height: "45px" }}
                        onClick={saveDisplayName}
                      >
                        Save
                      </Button>
                      <Button
                        variant="subtle"
                        color="gray"
                        style={{ height: "45px" }}
                        onClick={() => {
                          setDisplayName(originalDisplayName);
                          setIsEditingName(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </Group>
                  ) : (
                    <TextInput
                      readOnly
                      value={displayName || originalDisplayName || context.displayName || ""}
                      placeholder="Enter a display name"
                      onClick={() => setIsEditingName(true)}
                      rightSection={<IconPencil size={16} stroke={1.5} color="var(--text-muted)" />}
                      styles={{
                        input: {
                          backgroundColor: "var(--bg-surface)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                          height: "45px",
                          cursor: "pointer",
                        },
                      }}
                    />
                  )}
                </div>

                <div
                  style={{
                    padding: "20px",
                    background: "var(--bg-elevated)",
                    borderRadius: "12px",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}
                  >
                    Account Details
                  </Text>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                    <Group justify="space-between">
                      <Text size="sm" c="var(--text-secondary)">Registered Email</Text>
                      <Text size="sm" fw={500} c="var(--text-primary)">{context.user?.email}</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="var(--text-secondary)">Email Verification</Text>
                      <Badge color="green" variant="light">Verified</Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="var(--text-secondary)">Account ID</Text>
                      <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>{context.user?.id}</Text>
                    </Group>
                  </div>
                </div>
              </div>
            </Tabs.Panel>

            {/* Preferences Sub-navigation View (/account/preferences) */}
            <Tabs.Panel value="preferences">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  padding: "20px",
                  background: "var(--bg-elevated)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <Text
                  size="sm"
                  fw={600}
                  c="dimmed"
                  style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "-8px" }}
                >
                  Media
                </Text>
                <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                  <div>
                    <Text size="md" fw={500} c="var(--text-primary)">
                      Camera on by default
                    </Text>
                    <Text size="xs" c="dimmed">
                      Start video automatically when joining a room.
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    className="custom-switch"
                    color="violet"
                    checked={prefCameraOn}
                    onChange={(e) => updatePreference("pref_camera_on", e.currentTarget.checked)}
                  />
                </Group>

                <Group
                  className={styles.mobileStackRow}
                  justify="space-between"
                  wrap="nowrap"
                  style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <div>
                    <Text size="md" fw={500} c="var(--text-primary)">
                      Microphone on by default
                    </Text>
                    <Text size="xs" c="dimmed">
                      Start microphone automatically when joining a room.
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    className="custom-switch"
                    color="violet"
                    checked={prefMicOn}
                    onChange={(e) => updatePreference("pref_mic_on", e.currentTarget.checked)}
                  />
                </Group>

                <Text
                  size="sm"
                  fw={600}
                  c="dimmed"
                  style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "-8px", marginTop: "8px" }}
                >
                  General
                </Text>
                <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                  <div>
                    <Text size="md" fw={500} c="var(--text-primary)">
                      Show Chat Column
                    </Text>
                    <Text size="xs" c="dimmed">
                      Display the chat sidebar by default when joining rooms.
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    className="custom-switch"
                    color="violet"
                    checked={prefShowChatColumn}
                    onChange={(e) => updatePreference("pref_show_chat_column", e.currentTarget.checked)}
                  />
                </Group>

                <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                  <div>
                    <Text size="md" fw={500} c="var(--text-primary)">
                      Show People Column
                    </Text>
                    <Text size="xs" c="dimmed">
                      Display the participant list by default.
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    className="custom-switch"
                    color="violet"
                    checked={prefShowPeopleColumn}
                    onChange={(e) => updatePreference("pref_show_people_column", e.currentTarget.checked)}
                  />
                </Group>

                <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                  <div>
                    <Text size="md" fw={500} c="var(--text-primary)">
                      Disable Chat Sound
                    </Text>
                    <Text size="xs" c="dimmed">
                      Mute notification sounds for new chat messages.
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    className="custom-switch"
                    color="violet"
                    checked={prefDisableChatSound}
                    onChange={(e) => updatePreference("pref_disable_chat_sound", e.currentTarget.checked)}
                  />
                </Group>

                <Group
                  className={styles.mobileStackRow}
                  justify="space-between"
                  wrap="nowrap"
                  style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "16px", marginTop: "8px" }}
                >
                  <div>
                    <Text size="md" fw={500} c="var(--text-primary)">
                      Appearance
                    </Text>
                    <Text size="xs" c="dimmed">
                      Customize your visual interface theme.
                    </Text>
                  </div>
                  <AppearanceSelector />
                </Group>
              </div>
            </Tabs.Panel>

            {/* Security Sub-navigation View (/account/security) */}
            <Tabs.Panel value="security">
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {resetSuccessMessage && (
                  <Alert
                    icon={<IconCheck size={16} />}
                    title="Password Reset Email Sent"
                    color="green"
                    withCloseButton
                    onClose={() => setResetSuccessMessage(null)}
                  >
                    {resetSuccessMessage}
                  </Alert>
                )}

                {/* Authentication & Session Card */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    padding: "20px",
                    background: "var(--bg-elevated)",
                    borderRadius: "12px",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                      marginBottom: "-8px",
                    }}
                  >
                    Authentication & Session
                  </Text>

                  <Group
                    className={styles.mobileStackRow}
                    justify="space-between"
                    wrap="nowrap"
                    style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                      <Text size="md" fw={500} c="var(--text-primary)">
                        Password
                      </Text>
                      <Text size="xs" c="dimmed">
                        Send a secure password reset link to {context.user?.email || "your registered email"}.
                      </Text>
                    </div>
                    <Button
                      disabled={resetDisabled}
                      leftSection={<IconKeyFilled size={15} />}
                      variant="light"
                      color="violet"
                      size="sm"
                      style={{ flexShrink: 0 }}
                      onClick={resetPassword}
                    >
                      {resetDisabled ? "Link Sent" : "Reset Password"}
                    </Button>
                  </Group>

                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                      <Text size="md" fw={500} c="var(--text-primary)">
                        Active Session
                      </Text>
                      <Text size="xs" c="dimmed">
                        Sign out of your active CoWatch account on this browser.
                      </Text>
                    </div>
                    <Button
                      leftSection={<IconLogout size={15} stroke={1.5} />}
                      variant="outline"
                      color="gray"
                      size="sm"
                      style={{
                        flexShrink: 0,
                        borderColor: "var(--border-strong)",
                        color: "var(--text-secondary)",
                      }}
                      onClick={onSignOut}
                    >
                      Sign Out
                    </Button>
                  </Group>
                </div>

                {/* Danger Zone Card */}
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.04)",
                    border: "1px solid rgba(239, 68, 68, 0.22)",
                    borderRadius: "12px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "-4px" }}>
                    <IconAlertTriangle size={16} color="var(--color-danger)" />
                    <Text
                      size="sm"
                      fw={600}
                      c="var(--color-danger)"
                      style={{
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                      }}
                    >
                      Danger Zone
                    </Text>
                  </div>

                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                      <Text size="md" fw={500} c="var(--text-primary)">
                        Delete Account
                      </Text>
                      <Text size="xs" c="dimmed">
                        Permanently delete your account, saved preferences, rooms, and profile picture. This action cannot be undone.
                      </Text>
                    </div>
                    <Button
                      leftSection={<IconTrashFilled size={15} />}
                      color="red"
                      variant="filled"
                      size="sm"
                      style={{ flexShrink: 0 }}
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Delete Account
                    </Button>
                  </Group>
                </div>
              </div>
            </Tabs.Panel>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
