import React, { useContext, useEffect, useState } from "react";
import { Link, Redirect, useHistory, useLocation } from "react-router-dom";
import {
  Modal,
  Button,
  Avatar,
  Switch,
  Group,
  TextInput,
  SegmentedControl,
  Alert,
  Loader,
  Badge,
} from "@mantine/core";
import { supabase } from "../../utils/supabaseClient";
import { serverPath, openFileSelector } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import { MODAL_SIZES } from "../../utils/designSystem";
import {
  IconArrowLeft,
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
  IconCamera,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useAppearance } from "../../theme/ThemeProvider";
import { setDocumentMetadata } from "../../utils/useDocumentMetadata";
import { NotificationPreferencesSection } from "./NotificationPreferencesSection";
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
      profile: "Your profile | Settings",
      preferences: "Preferences | Settings",
      security: "Login & security | Settings",
    };
    const descriptions: Record<string, string> = {
      profile: "Manage your CoWatch profile identity and display name.",
      preferences: "Customize room, media, and appearance preferences.",
      security: "Manage your account authentication, password, and session.",
    };

    const cleanup = setDocumentMetadata({
      title: titles[activeTab] || "Settings",
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
          Please sign in to view your account settings.
        </h2>
      </div>
    );
  }

  const effectiveDisplayName =
    originalDisplayName || context.displayName || context.user?.email?.split("@")[0] || "User";

  return (
    <div className={styles.page}>
      {/* Account Deletion Confirmation Modal */}
      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Your Account"
        centered
        size={MODAL_SIZES.sm}
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
        size={MODAL_SIZES.sm}
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

      <div className={styles.container}>
        {/* Left Sidebar Navigation */}
        <aside className={styles.sidebar}>
          <Link to="/" className={styles.backButton}>
            <IconArrowLeft size={16} stroke={2} />
            <span>Back to Home</span>
          </Link>

          <h1 className={styles.pageTitle}>Settings</h1>

          {/* Navigation Sections */}
          <div className={styles.navSections}>
            <div className={styles.navSection}>
              <span className={styles.navSectionTitle}>ACCOUNT</span>
              <button
                type="button"
                className={`${styles.navItem} ${isProfile ? styles.activeNavItem : ""}`}
                onClick={() => handleTabChange("profile")}
                aria-current={isProfile ? "page" : undefined}
              >
                <IconUser size={18} stroke={1.8} />
                <span>Your profile</span>
              </button>
            </div>

            <div className={styles.navSection}>
              <span className={styles.navSectionTitle}>APP EXPERIENCE</span>
              <button
                type="button"
                className={`${styles.navItem} ${isPreferences ? styles.activeNavItem : ""}`}
                onClick={() => handleTabChange("preferences")}
                aria-current={isPreferences ? "page" : undefined}
              >
                <IconSettings size={18} stroke={1.8} />
                <span>Preferences</span>
              </button>
            </div>

            <div className={styles.navSection}>
              <span className={styles.navSectionTitle}>SECURITY & SIGN IN</span>
              <button
                type="button"
                className={`${styles.navItem} ${isSecurity ? styles.activeNavItem : ""}`}
                onClick={() => handleTabChange("security")}
                aria-current={isSecurity ? "page" : undefined}
              >
                <IconLock size={18} stroke={1.8} />
                <span>Login & security</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile Navigation Tabs (visible only on mobile/small screens) */}
        <nav className={styles.mobileNav} aria-label="Mobile account navigation">
          <button
            type="button"
            className={`${styles.mobileNavItem} ${isProfile ? styles.activeMobileNavItem : ""}`}
            onClick={() => handleTabChange("profile")}
            aria-current={isProfile ? "page" : undefined}
          >
            <IconUser size={15} stroke={isProfile ? 2.2 : 1.8} />
            <span>Profile</span>
          </button>

          <button
            type="button"
            className={`${styles.mobileNavItem} ${isPreferences ? styles.activeMobileNavItem : ""}`}
            onClick={() => handleTabChange("preferences")}
            aria-current={isPreferences ? "page" : undefined}
          >
            <IconSettings size={15} stroke={isPreferences ? 2.2 : 1.8} />
            <span>Preferences</span>
          </button>

          <button
            type="button"
            className={`${styles.mobileNavItem} ${isSecurity ? styles.activeMobileNavItem : ""}`}
            onClick={() => handleTabChange("security")}
            aria-current={isSecurity ? "page" : undefined}
          >
            <IconLock size={15} stroke={isSecurity ? 2.2 : 1.8} />
            <span>Security</span>
          </button>
        </nav>

        {/* Main Content Card */}
        <main className={styles.mainCard}>
          {/* Header Banner */}
          <div className={styles.cardHeader}>
            <span className={styles.categoryTag}>
              {isProfile ? "YOUR PROFILE" : isPreferences ? "APP EXPERIENCE" : "SECURITY & SIGN IN"}
            </span>
            <h2 className={styles.cardTitle}>
              {isProfile ? "Your profile" : isPreferences ? "Preferences" : "Login & security"}
            </h2>
            <p className={styles.cardSubtitle}>
              {isProfile
                ? "Manage how you appear across CoWatch rooms and conversations."
                : isPreferences
                ? "Customize your playback, room interface, and appearance."
                : "Manage your account password, sessions, and credentials."}
            </p>
          </div>

          <div className={styles.cardBody}>
            {/* View: Profile */}
            {isProfile && (
              <>
                {/* Profile Identity Card */}
                <div className={styles.profileBox}>
                  <div className={styles.profileBoxHeader}>
                    <h3 className={styles.profileBoxTitle}>Your CoWatch profile</h3>
                    <p className={styles.profileBoxSubtitle}>
                      Your identity across watch rooms and conversations.
                    </p>
                  </div>

                  <div className={styles.profileBoxContent}>
                    <div className={styles.identityWrapper}>
                      <div className={styles.avatarWrapper}>
                        <Avatar
                          className={styles.avatar}
                          size={64}
                          radius="xl"
                          src={context.avatarUrl}
                        />
                        <button
                          type="button"
                          className={styles.avatarCameraBadge}
                          onClick={uploadAvatar}
                          aria-label="Upload profile picture"
                        >
                          <IconCamera size={12} stroke={2.2} />
                        </button>
                      </div>

                      <div className={styles.identityInfo}>
                        <div className={styles.identityName}>
                          <span>{effectiveDisplayName}</span>
                          {context.user?.user_metadata?.email_verified && (
                            <IconCircleCheckFilled title="Verified" color="var(--color-success)" size={16} />
                          )}
                        </div>
                        <span className={styles.identityEmail}>{context.user?.email}</span>
                      </div>
                    </div>

                    <Button
                      leftSection={isUploadingAvatar ? <Loader size="xs" color="violet" /> : <IconUpload size={14} />}
                      onClick={uploadAvatar}
                      disabled={isUploadingAvatar}
                      variant="light"
                      color="violet"
                      className={styles.changePictureBtn}
                    >
                      Change picture
                    </Button>
                  </div>
                </div>

                {/* Profile Settings Section */}
                <div className={styles.settingsSection}>
                  <h3 className={styles.settingsSectionTitle}>Profile</h3>

                  {/* Row: Display Name */}
                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Display name</span>
                      <span className={styles.settingDescription}>
                        This name is visible to participants in watch rooms and chat.
                      </span>
                    </div>

                    <div className={styles.settingAction}>
                      {isEditingName ? (
                        <Group align="center" gap="xs">
                          <TextInput
                            autoFocus
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
                            size="sm"
                            placeholder="Enter your display name"
                          />
                          <Button
                            size="sm"
                            color="violet"
                            onClick={saveDisplayName}
                            className={styles.actionButton}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="subtle"
                            color="gray"
                            onClick={() => {
                              setDisplayName(originalDisplayName);
                              setIsEditingName(false);
                            }}
                            className={styles.actionButton}
                          >
                            Cancel
                          </Button>
                        </Group>
                      ) : (
                        <>
                          <span className={styles.settingValue}>{effectiveDisplayName}</span>
                          <Button
                            variant="subtle"
                            color="violet"
                            size="sm"
                            leftSection={<IconPencil size={14} stroke={1.8} />}
                            onClick={() => setIsEditingName(true)}
                            className={styles.actionButton}
                          >
                            Edit
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Row: Email */}
                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Email</span>
                      <span className={styles.settingDescription}>
                        Your primary email address for signing in and notifications.
                      </span>
                    </div>

                    <div className={styles.settingAction}>
                      <span className={styles.settingValue}>{context.user?.email}</span>
                      <Badge
                        color="green"
                        variant="light"
                        leftSection={<IconCircleCheckFilled size={12} />}
                      >
                        Verified
                      </Badge>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* View: Preferences */}
            {isPreferences && (
              <>
                {/* Media Defaults Section */}
                <div className={styles.settingsSection}>
                  <h3 className={styles.settingsSectionTitle}>Media defaults</h3>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Camera on by default</span>
                      <span className={styles.settingDescription}>
                        Start your video automatically when joining a watch party room.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Switch
                        size="md"
                        color="violet"
                        checked={prefCameraOn}
                        onChange={(e) => updatePreference("pref_camera_on", e.currentTarget.checked)}
                      />
                    </div>
                  </div>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Microphone on by default</span>
                      <span className={styles.settingDescription}>
                        Start your microphone automatically when joining a watch party room.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Switch
                        size="md"
                        color="violet"
                        checked={prefMicOn}
                        onChange={(e) => updatePreference("pref_mic_on", e.currentTarget.checked)}
                      />
                    </div>
                  </div>
                </div>

                {/* Room Interface Section */}
                <div className={styles.settingsSection}>
                  <h3 className={styles.settingsSectionTitle}>Room interface</h3>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Show chat column</span>
                      <span className={styles.settingDescription}>
                        Display the room chat sidebar by default.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Switch
                        size="md"
                        color="violet"
                        checked={prefShowChatColumn}
                        onChange={(e) => updatePreference("pref_show_chat_column", e.currentTarget.checked)}
                      />
                    </div>
                  </div>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Show people column</span>
                      <span className={styles.settingDescription}>
                        Display the room participant list by default.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Switch
                        size="md"
                        color="violet"
                        checked={prefShowPeopleColumn}
                        onChange={(e) => updatePreference("pref_show_people_column", e.currentTarget.checked)}
                      />
                    </div>
                  </div>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Disable chat sound</span>
                      <span className={styles.settingDescription}>
                        Mute sound notifications when new chat messages arrive.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Switch
                        size="md"
                        color="violet"
                        checked={prefDisableChatSound}
                        onChange={(e) => updatePreference("pref_disable_chat_sound", e.currentTarget.checked)}
                      />
                    </div>
                  </div>
                </div>

                {/* Appearance Section */}
                <div className={styles.settingsSection}>
                  <h3 className={styles.settingsSectionTitle}>Appearance theme</h3>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Theme mode</span>
                      <span className={styles.settingDescription}>
                        Select your preferred visual interface appearance.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <AppearanceSelector />
                    </div>
                  </div>
                </div>

                {/* Email Notification Preferences Section */}
                <NotificationPreferencesSection />
              </>
            )}

            {/* View: Security */}
            {isSecurity && (
              <>
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

                {/* Authentication Section */}
                <div className={styles.settingsSection}>
                  <h3 className={styles.settingsSectionTitle}>Authentication</h3>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Password</span>
                      <span className={styles.settingDescription}>
                        Send a secure password reset link to {context.user?.email || "your email"}.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Button
                        disabled={resetDisabled}
                        leftSection={<IconKeyFilled size={14} />}
                        variant="light"
                        color="violet"
                        size="sm"
                        onClick={resetPassword}
                        className={styles.actionButton}
                      >
                        {resetDisabled ? "Link Sent" : "Reset Password"}
                      </Button>
                    </div>
                  </div>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Active browser session</span>
                      <span className={styles.settingDescription}>
                        Sign out of your active CoWatch account on this browser.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Button
                        leftSection={<IconLogout size={14} stroke={1.8} />}
                        variant="outline"
                        color="gray"
                        size="sm"
                        onClick={onSignOut}
                        className={styles.actionButton}
                      >
                        Sign Out
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Danger Zone Section */}
                <div className={styles.settingsSection}>
                  <h3 className={styles.settingsSectionTitle} style={{ color: "var(--color-danger)" }}>
                    Danger zone
                  </h3>

                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <span className={styles.settingLabel}>Delete account</span>
                      <span className={styles.settingDescription}>
                        Permanently delete your account, saved preferences, rooms, and profile picture.
                      </span>
                    </div>
                    <div className={styles.settingAction}>
                      <Button
                        leftSection={<IconTrashFilled size={14} />}
                        color="red"
                        variant="filled"
                        size="sm"
                        onClick={() => setDeleteConfirmOpen(true)}
                        className={styles.actionButton}
                      >
                        Delete Account
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
