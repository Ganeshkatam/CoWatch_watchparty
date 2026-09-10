import React, { useContext, useEffect, useState } from "react";
import { Redirect, useHistory, useLocation } from "react-router-dom";
import {
  Modal,
  Button,
  Avatar,
  Switch,
  Group,
  Text,
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

  // Route determinations
  const pathname = location.pathname;
  const isPreferences = pathname === "/account/preferences";
  const isSecurity = pathname === "/account/security";
  const isProfile = pathname === "/account/profile";

  // Redirect invalid or root /account URLs to /account/profile
  const shouldRedirectToProfile = !isProfile && !isPreferences && !isSecurity;

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
  const handleTabChange = (val: string) => {
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
          from { opacity: 0; transform: translateY(16px); }
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
          border-radius: 20px;
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
        title="Avatar Notice"
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
            background: "radial-gradient(circle at 40% 0%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        {/* Page Header */}
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Account Settings</h1>
          <p className={styles.pageSubtitle}>
            Manage your personal profile, viewing preferences, and security settings.
          </p>
        </header>

        {/* Mobile Navigation Tabs (visible only on mobile and small screens) */}
        <nav className={styles.mobileNav} aria-label="Mobile account navigation">
          <button
            type="button"
            className={`${styles.mobileNavItem} ${isProfile ? styles.activeMobileNavItem : ""}`}
            onClick={() => handleTabChange("profile")}
            aria-current={isProfile ? "page" : undefined}
          >
            <IconUser size={16} stroke={isProfile ? 2.2 : 1.6} />
            <span>Profile</span>
          </button>

          <button
            type="button"
            className={`${styles.mobileNavItem} ${isPreferences ? styles.activeMobileNavItem : ""}`}
            onClick={() => handleTabChange("preferences")}
            aria-current={isPreferences ? "page" : undefined}
          >
            <IconSettings size={16} stroke={isPreferences ? 2.2 : 1.6} />
            <span>Preferences</span>
          </button>

          <button
            type="button"
            className={`${styles.mobileNavItem} ${isSecurity ? styles.activeMobileNavItem : ""}`}
            onClick={() => handleTabChange("security")}
            aria-current={isSecurity ? "page" : undefined}
          >
            <IconLock size={16} stroke={isSecurity ? 2.2 : 1.6} />
            <span>Security</span>
          </button>
        </nav>

        {/* Side Panel Nav & Main Content Layout */}
        <div className={styles.layout}>
          {/* Left Side Panel Navigation (laptops, desktops, and large screens only) */}
          <aside className={styles.sideNav} aria-label="Desktop account navigation">
            {/* User Identity Snippet */}
            <div className={styles.userBadge}>
              <Avatar
                src={context.avatarUrl}
                size={38}
                radius="xl"
                className={styles.avatar}
              />
              <div className={styles.userBadgeDetails}>
                <span className={styles.userBadgeName}>
                  {originalDisplayName || context.displayName || context.user?.email?.split("@")[0]}
                  {context.user?.user_metadata?.email_verified && (
                    <IconCircleCheckFilled title="Verified" color="var(--color-success)" size={15} />
                  )}
                </span>
                <span className={styles.userBadgeEmail}>
                  {context.user?.email}
                </span>
              </div>
            </div>

            {/* Nav Item: Profile */}
            <button
              type="button"
              className={`${styles.navItem} ${isProfile ? styles.activeNavItem : ""}`}
              onClick={() => handleTabChange("profile")}
              aria-current={isProfile ? "page" : undefined}
            >
              <div className={`${styles.navIconWrapper} ${isProfile ? styles.activeNavIconWrapper : ""}`}>
                <IconUser size={18} stroke={isProfile ? 2.2 : 1.6} />
              </div>
              <div className={styles.navLabelWrapper}>
                <span className={`${styles.navLabelTitle} ${isProfile ? styles.activeNavLabelTitle : ""}`}>
                  Profile
                </span>
                <span className={styles.navLabelSubtitle}>Identity and photo</span>
              </div>
            </button>

            {/* Nav Item: Preferences */}
            <button
              type="button"
              className={`${styles.navItem} ${isPreferences ? styles.activeNavItem : ""}`}
              onClick={() => handleTabChange("preferences")}
              aria-current={isPreferences ? "page" : undefined}
            >
              <div className={`${styles.navIconWrapper} ${isPreferences ? styles.activeNavIconWrapper : ""}`}>
                <IconSettings size={18} stroke={isPreferences ? 2.2 : 1.6} />
              </div>
              <div className={styles.navLabelWrapper}>
                <span className={`${styles.navLabelTitle} ${isPreferences ? styles.activeNavLabelTitle : ""}`}>
                  Preferences
                </span>
                <span className={styles.navLabelSubtitle}>Media, chat, theme</span>
              </div>
            </button>

            {/* Nav Item: Security */}
            <button
              type="button"
              className={`${styles.navItem} ${isSecurity ? styles.activeNavItem : ""}`}
              onClick={() => handleTabChange("security")}
              aria-current={isSecurity ? "page" : undefined}
            >
              <div className={`${styles.navIconWrapper} ${isSecurity ? styles.activeNavIconWrapper : ""}`}>
                <IconLock size={18} stroke={isSecurity ? 2.2 : 1.6} />
              </div>
              <div className={styles.navLabelWrapper}>
                <span className={`${styles.navLabelTitle} ${isSecurity ? styles.activeNavLabelTitle : ""}`}>
                  Security
                </span>
                <span className={styles.navLabelSubtitle}>Password and session</span>
              </div>
            </button>

            <div className={styles.sideNavDivider} />

            <button
              type="button"
              className={styles.sideNavSignOut}
              onClick={onSignOut}
            >
              <IconLogout size={16} stroke={1.6} />
              <span>Sign Out</span>
            </button>
          </aside>

          {/* Right Main Content Area */}
          <main className={styles.mainPanel}>
            {/* View: Profile */}
            {isProfile && (
              <>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>Public Profile</h2>
                  <p className={styles.sectionSubtitle}>
                    Manage your display name, profile avatar, and account credentials.
                  </p>
                </div>

                {/* Profile Photo Banner */}
                <div className={styles.profileBanner}>
                  <Avatar
                    className={styles.avatar}
                    size={90}
                    src={context.avatarUrl}
                  />
                  <div className={styles.identity}>
                    <div className={styles.identityName}>
                      <span style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-primary)" }}>
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

                {/* Display Name Card */}
                <div className={styles.contentCard}>
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}
                  >
                    Display Name
                  </Text>
                  <Text size="xs" c="dimmed" mb="xs">
                    This is the name other participants will see in watch parties and live chats.
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
                            backgroundColor: "var(--bg-elevated)",
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
                          backgroundColor: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-primary)",
                          height: "45px",
                          cursor: "pointer",
                        },
                      }}
                    />
                  )}
                </div>

                {/* Account Details Card */}
                <div className={styles.contentCard}>
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}
                  >
                    Account Information
                  </Text>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
                    <Group justify="space-between">
                      <Text size="sm" c="var(--text-secondary)">Registered Email</Text>
                      <Text size="sm" fw={500} c="var(--text-primary)">{context.user?.email}</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="var(--text-secondary)">Email Verification Status</Text>
                      <Badge color="green" variant="light">Verified</Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="var(--text-secondary)">Account ID</Text>
                      <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>{context.user?.id}</Text>
                    </Group>
                  </div>
                </div>
              </>
            )}

            {/* View: Preferences */}
            {isPreferences && (
              <>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>Preferences</h2>
                  <p className={styles.sectionSubtitle}>
                    Customize media defaults, room interfaces, and appearance themes.
                  </p>
                </div>

                <div className={styles.contentCard}>
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "-4px" }}
                  >
                    Media Defaults
                  </Text>
                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">
                        Camera on by default
                      </Text>
                      <Text size="xs" c="dimmed">
                        Start your video automatically when joining a watch party room.
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
                        Start your microphone automatically when joining a watch party room.
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
                    style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "-4px", marginTop: "8px" }}
                  >
                    Room Interface
                  </Text>
                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">
                        Show Chat Column
                      </Text>
                      <Text size="xs" c="dimmed">
                        Display the room chat sidebar by default.
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
                        Display the room participant list by default.
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
                        Mute sound notifications when new chat messages arrive.
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
                        Appearance Theme
                      </Text>
                      <Text size="xs" c="dimmed">
                        Select your preferred visual interface theme.
                      </Text>
                    </div>
                    <AppearanceSelector />
                  </Group>
                </div>
              </>
            )}

            {/* View: Security */}
            {isSecurity && (
              <>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>Security & Login</h2>
                  <p className={styles.sectionSubtitle}>
                    Manage your credentials, active browser session, and account deletion.
                  </p>
                </div>

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
                <div className={styles.contentCard}>
                  <Text
                    size="sm"
                    fw={600}
                    c="dimmed"
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                      marginBottom: "-4px",
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
                        Active Browser Session
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
                    borderRadius: "16px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                    boxShadow: "var(--shadow-sm)",
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
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};
