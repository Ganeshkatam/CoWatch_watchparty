import React from "react";
import { Modal, Button, Avatar, Switch, Group, Text, Tabs, TextInput, SegmentedControl } from "@mantine/core";
import { supabase } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
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
} from "@tabler/icons-react";
import { openFileSelector } from "../../utils/utils";
import { useAppearance } from "../../theme/ThemeProvider";
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

export class Profile extends React.Component<{}> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = {
    resetDisabled: false,
    deleteConfirmOpen: false,
    display_name: "",
    original_display_name: "",
    pref_show_chat_column: true,
    pref_show_people_column: false,
    pref_disable_chat_sound: false,
    pref_camera_on: false,
    pref_mic_on: false,
    has_loaded_profile: false,
    isEditingName: false,
  };

  componentDidMount() {
    this.syncProfile();
  }

  componentDidUpdate() {
    this.syncProfile();
  }

  syncProfile = () => {
    if (this.context.user) {
      const effectiveName =
        this.context.displayName && this.context.displayName !== "Guest"
          ? this.context.displayName
          : (this.context.profile?.display_name || this.context.user.email?.split("@")[0] || "");

      if (!this.state.has_loaded_profile || (!this.state.display_name && effectiveName)) {
        this.setState({
          display_name: this.state.display_name || effectiveName,
          original_display_name: this.state.original_display_name || effectiveName,
          pref_show_chat_column: this.context.profile?.pref_show_chat_column ?? true,
          pref_show_people_column: this.context.profile?.pref_show_people_column ?? false,
          pref_disable_chat_sound: this.context.profile?.pref_disable_chat_sound ?? false,
          pref_camera_on: this.context.profile?.pref_camera_on ?? false,
          pref_mic_on: this.context.profile?.pref_mic_on ?? false,
          has_loaded_profile: !!this.context.profile,
        });
      }
    }
  };

  onSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  resetPassword = async () => {
    try {
      if (this.context.user?.email) {
        await supabase.auth.resetPasswordForEmail(this.context.user.email);
        this.setState({ resetDisabled: true });
      }
    } catch (e) {
      console.warn(e);
    }
  };

  uploadAvatar = async () => {
    const user = this.context.user;
    if (!user) return;
    const prevAvatarUrl = this.context.avatarUrl;
    try {
      const files = await openFileSelector("image/*");
      if (!files || files.length === 0) return;
      const file = files[0];
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert("Only JPG, PNG, and WebP images are allowed.");
        return;
      }
      // 1MB limit (matches Supabase bucket configuration)
      if (file.size > 1 * 1024 * 1024) {
        alert("Image must be smaller than 1MB.");
        return;
      }
      
      const uniqueTimestamp = Date.now();
      const filePath = `${user.id}/profile_${uniqueTimestamp}.${fileExt}`;

      // Optimistically update the UI with a local preview instantly
      const previewUrl = URL.createObjectURL(file);
      this.context.setMetadata({ avatarUrl: previewUrl });

      // Clean up ALL previous avatars in the user's folder so we don't leak storage.
      const { data: existingFiles } = await supabase.storage.from('avatars').list(user.id);
      if (existingFiles && existingFiles.length > 0) {
        const filesToRemove = existingFiles.map(x => `${user.id}/${x.name}`);
        const { error: removeError } = await supabase.storage.from('avatars').remove(filesToRemove);
        if (removeError) {
          console.warn("Avatar cleanup warning:", removeError);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600"
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      // Update public.profiles authoritative source FIRST
      const { error: dbError } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        });
        
      if (dbError) {
        console.error("DB update failed:", dbError);
        throw dbError;
      }

      // Update auth.users metadata SECOND (this triggers onAuthStateChange in index.tsx)
      await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      });
      // Update Context locally with the final public URL
      this.context.setMetadata({ avatarUrl: publicUrl });
    } catch (e: any) {
      console.error("Avatar upload failed:", e);
      alert("Failed to upload avatar: " + (e.message || e));
      // Revert optimistic preview on failure
      this.context.setMetadata({ avatarUrl: prevAvatarUrl });
    }
  };

  saveDisplayName = async () => {
    if (!this.context.user) return;
    const displayName = this.state.display_name.trim();
    if (displayName.length > 50) return;

    const fallbackName =
      this.context.user?.user_metadata?.display_name?.trim() ||
      this.context.user?.user_metadata?.full_name?.trim() ||
      this.context.user?.user_metadata?.name?.trim() ||
      this.context.profile?.username ||
      this.context.user?.email?.split("@")[0] ||
      "User";
    const finalDisplayName = displayName || fallbackName;

    // Optimistically update UI immediately
    const prevName = this.context.displayName;
    this.setState({
      display_name: finalDisplayName,
      original_display_name: finalDisplayName,
      isEditingName: false,
    });
    this.context.setMetadata({ displayName: finalDisplayName });

    const { error } = await supabase
      .from("profiles")
      .upsert({
        id: this.context.user.id,
        display_name: finalDisplayName,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error("Failed to save display name:", error);
      // Revert on failure
      this.setState({
        display_name: prevName,
        original_display_name: prevName,
        isEditingName: true,
      });
      this.context.setMetadata({ displayName: prevName });
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

  updatePreference = async (key: string, value: boolean) => {
    this.setState({ [key]: value } as any);
    if (!this.context.user) return;

    // Save to DB via upsert
    await supabase
      .from("profiles")
      .upsert({
        id: this.context.user.id,
        [key]: value,
        updated_at: new Date().toISOString(),
      });

    // Update local storage so it applies immediately next reload
    if (key === "pref_show_chat_column") window.localStorage.setItem("cowatch-showchatcolumn", value ? "1" : "0");
    if (key === "pref_show_people_column") window.localStorage.setItem("cowatch-showpeoplecolumn", value ? "1" : "0");
    if (key === "pref_disable_chat_sound") {
      const settingsStr = window.localStorage.getItem("cowatch-setting") || "{}";
      try {
        const settings = JSON.parse(settingsStr);
        settings.disableChatSound = value;
        window.localStorage.setItem("cowatch-setting", JSON.stringify(settings));
      } catch (e) { }
    }
  };

  deleteAccountConfirm = () => {
    this.setState({ deleteConfirmOpen: true });
  };

  deleteAccount = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    await fetch(serverPath + "/api/account/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    });
    await supabase.auth.signOut({ scope: "local" });
    window.location.href = "/";
  };

  render() {

    if (!this.context.user) {
      return (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
          <h2 style={{ fontFamily: "Inter, sans-serif", fontWeight: 300, color: "var(--text-secondary)" }}>Please sign in to view your profile.</h2>
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

        <Modal
          opened={this.state.deleteConfirmOpen}
          onClose={() => this.setState({ deleteConfirmOpen: false })}
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
              <Button variant="subtle" color="gray" onClick={() => this.setState({ deleteConfirmOpen: false })}>
                Cancel
              </Button>
              <Button color="red" onClick={this.deleteAccount}>
                Yes, Delete My Account
              </Button>
            </div>
          </div>
        </Modal>

        <div className={`glass-card ${styles.card}`}>
          {/* Decorative background glow */}
          <div style={{
            position: "absolute",
            top: "-50%",
            left: "-50%",
            width: "200%",
            height: "200%",
            background: "radial-gradient(circle at 50% 0%, rgba(66, 133, 244, 0.1) 0%, transparent 50%)",
            pointerEvents: "none",
            zIndex: 0
          }} />

          <div className={styles.content}>
            <h1 style={{
              margin: "0 0 30px 0",
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
              fontSize: "1.8rem",
              background: "linear-gradient(90deg, var(--text-primary), var(--text-muted))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>Account Settings</h1>

            {/* Profile Header */}
            <div className={styles.profileHeader}>
              <Avatar
                className={styles.avatar}
                size={120}
                src={this.context.avatarUrl}
                style={{
                  border: "2px solid var(--border-subtle)",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.3)"
                }}
              />
              <div className={styles.identity}>
                <div className={styles.identityName}>
                  <span style={{ fontSize: "1.2rem", fontWeight: 500, color: "var(--text-primary)" }}>
                    {this.state.original_display_name || this.context.displayName || this.context.user?.email?.split('@')[0]}
                  </span>
                  {this.context.user?.user_metadata?.email_verified && (
                    <IconCircleCheckFilled title="Verified" color="var(--color-success)" size={18} />
                  )}
                </div>
                <span className={styles.identityEmail} style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{this.context.user?.email}</span>
              </div>

              <Button
                leftSection={<IconUpload size={16} />}
                onClick={this.uploadAvatar}
                variant="light"
                color="violet"
                className={`profile-btn ${styles.uploadButton}`}
              >
                {this.context.avatarUrl ? "Change Picture" : "Upload Picture"}
              </Button>
            </div>

            <Tabs 
              defaultValue={window.localStorage.getItem("cowatch-profile-tab") || "general"} 
              onChange={(value) => {
                if (value) window.localStorage.setItem("cowatch-profile-tab", value);
              }}
              color="violet"
            >
              <Tabs.List className={styles.tabsList} mb="xl">
                <Tabs.Tab value="general" leftSection={<IconUser size={16} />}>General</Tabs.Tab>
                <Tabs.Tab value="preferences" leftSection={<IconSettings size={16} />}>Preferences</Tabs.Tab>
                <Tabs.Tab value="security" leftSection={<IconLock size={16} />}>Security</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="general">
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} mb={5} c="var(--text-secondary)" style={{ textTransform: "uppercase", letterSpacing: "1px" }}>Display name</Text>
                    <Text size="xs" c="dimmed" mb="sm">This is the name other people see in CoWatch.</Text>
                    {this.state.isEditingName ? (
                      <TextInput
                        autoFocus
                        value={this.state.display_name}
                        onChange={(e) => this.setState({ display_name: e.target.value })}
                        onBlur={() => {
                          this.setState({ isEditingName: false });
                          this.saveDisplayName();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            this.setState({ isEditingName: false });
                            this.saveDisplayName();
                          }
                        }}
                        maxLength={50}
                        placeholder="Enter a display name"
                        styles={{
                          input: { backgroundColor: "var(--bg-surface)", border: "1px solid var(--color-violet)", color: "var(--text-primary)", height: "45px" }
                        }}
                      />
                    ) : (
                      <TextInput
                        readOnly
                        value={this.state.display_name || this.state.original_display_name || this.context.displayName || ""}
                        placeholder="Enter a display name"
                        onClick={() => this.setState({ isEditingName: true })}
                        rightSection={<IconPencil size={16} stroke={1.5} color="var(--text-muted)" />}
                        styles={{
                          input: { backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", height: "45px", cursor: "pointer" }
                        }}
                      />
                    )}
                  </div>
                </div>
              </Tabs.Panel>

              <Tabs.Panel value="preferences">
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px", background: "var(--bg-elevated)", borderRadius: "12px", border: "1px solid var(--border-subtle)" }}>
                  <Text size="sm" fw={600} c="dimmed" style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "-8px" }}>Media</Text>
                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">Camera on by default</Text>
                      <Text size="xs" c="dimmed">Start video automatically when joining a room.</Text>
                    </div>
                    <Switch
                      size="lg"
                      className="custom-switch"
                      color="violet"
                      checked={this.state.pref_camera_on}
                      onChange={(e) => this.updatePreference("pref_camera_on", e.currentTarget.checked)}
                    />
                  </Group>

                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap" style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">Microphone on by default</Text>
                      <Text size="xs" c="dimmed">Start microphone automatically when joining a room.</Text>
                    </div>
                    <Switch
                      size="lg"
                      className="custom-switch"
                      color="violet"
                      checked={this.state.pref_mic_on}
                      onChange={(e) => this.updatePreference("pref_mic_on", e.currentTarget.checked)}
                    />
                  </Group>

                  <Text size="sm" fw={600} c="dimmed" style={{ textTransform: "uppercase", letterSpacing: "1px", marginBottom: "-8px", marginTop: "8px" }}>General</Text>
                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">Show Chat Column</Text>
                      <Text size="xs" c="dimmed">Display the chat sidebar by default when joining rooms.</Text>
                    </div>
                    <Switch
                      size="lg"
                      className="custom-switch"
                      color="violet"
                      checked={this.state.pref_show_chat_column}
                      onChange={(e) => this.updatePreference("pref_show_chat_column", e.currentTarget.checked)}
                    />
                  </Group>

                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">Show People Column</Text>
                      <Text size="xs" c="dimmed">Display the participant list by default.</Text>
                    </div>
                    <Switch
                      size="lg"
                      className="custom-switch"
                      color="violet"
                      checked={this.state.pref_show_people_column}
                      onChange={(e) => this.updatePreference("pref_show_people_column", e.currentTarget.checked)}
                    />
                  </Group>

                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">Disable Chat Sound</Text>
                      <Text size="xs" c="dimmed">Mute notification sounds for new chat messages.</Text>
                    </div>
                    <Switch
                      size="lg"
                      className="custom-switch"
                      color="violet"
                      checked={this.state.pref_disable_chat_sound}
                      onChange={(e) => this.updatePreference("pref_disable_chat_sound", e.currentTarget.checked)}
                    />
                  </Group>

                  <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "16px", marginTop: "8px" }}>
                    <div>
                      <Text size="md" fw={500} c="var(--text-primary)">Appearance</Text>
                      <Text size="xs" c="dimmed">Customize your visual interface theme.</Text>
                    </div>
                    <AppearanceSelector />
                  </Group>
                </div>
              </Tabs.Panel>

              <Tabs.Panel value="security">
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
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

                    <Group className={styles.mobileStackRow} justify="space-between" wrap="nowrap" style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                        <Text size="md" fw={500} c="var(--text-primary)">
                          Password
                        </Text>
                        <Text size="xs" c="dimmed">
                          Send a secure password reset link to {this.context.user?.email || "your registered email"}.
                        </Text>
                      </div>
                      <Button
                        disabled={this.state.resetDisabled}
                        leftSection={<IconKeyFilled size={15} />}
                        variant="light"
                        color="violet"
                        size="sm"
                        style={{ flexShrink: 0 }}
                        onClick={this.resetPassword}
                      >
                        Reset Password
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
                        onClick={this.onSignOut}
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
                        onClick={this.deleteAccountConfirm}
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
  }
}
