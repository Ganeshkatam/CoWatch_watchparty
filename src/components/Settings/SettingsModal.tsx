import React, { useState, useEffect, useContext } from "react";
import {
  Button,
  Modal,
  Switch,
  Text,
  Stack,
  SimpleGrid,
  TextInput,
  PasswordInput,
  FileButton,
  Image,
  Group,
  Divider,
  Badge,
  ActionIcon,
  Tooltip,
  Alert,
} from "@mantine/core";
import {
  IconLock,
  IconLockOpen,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { getCurrentSettings, updateSettings } from "./LocalSettings";
import { Socket } from "socket.io-client";
import { MetadataContext } from "../../MetadataContext";
import { supabase, getAccessToken } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";

interface SettingsModalProps {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  roomLock: string;
  setRoomLock: (lock: boolean) => Promise<void>;
  socket: Socket;
  roomId: string;
  owner: string | undefined;
  setOwner: (owner: string) => void;
  inviteLink: string;
  passcode: string | undefined;
  setPasscode: (passcode: string) => void;
  isChatDisabled: boolean;
  setIsChatDisabled: (disabled: boolean) => void;
  clearChat: () => void;
  roomTitle: string;
  setRoomTitle: (title: string) => void;
  roomDescription: string | undefined;
  setRoomDescription: (desc: string) => void;
  mediaPath: string | undefined;
  setMediaPath: (path: string) => void;
}

export const SettingsModal = ({
  modalOpen,
  setModalOpen,
  roomLock,
  setRoomLock,
  socket,
  owner,
  roomId,
  passcode,
  setPasscode,
  isChatDisabled,
  setIsChatDisabled,
  clearChat,
  roomTitle,
  setRoomTitle,
  roomDescription,
  setRoomDescription,
}: SettingsModalProps) => {
  const { user, profile } = useContext(MetadataContext);
  
  // -- DRAFT STATE --
  const [draftTitle, setDraftTitle] = useState(roomTitle || "");
  const [draftDescription, setDraftDescription] = useState(roomDescription || "");
  const [draftLock, setDraftLock] = useState(Boolean(roomLock));
  const [draftPermanent, setDraftPermanent] = useState(false);
  const [draftChatEnabled, setDraftChatEnabled] = useState(!isChatDisabled);
  
  // Local settings draft
  const [draftNotif, setDraftNotif] = useState(Boolean(getCurrentSettings().disableChatSound));
  const [draftCamera, setDraftCamera] = useState(profile?.pref_camera_on ?? false);
  const [draftMic, setDraftMic] = useState(profile?.pref_mic_on ?? false);
  
  // Password draft
  const [passwordAction, setPasswordAction] = useState<"keep" | "change" | "clear">("keep");
  const [draftPassword, setDraftPassword] = useState("");
  const [draftPasswordConfirm, setDraftPasswordConfirm] = useState("");

  // Cover draft
  const [originalCoverUrl, setOriginalCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [clearCover, setClearCover] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Sync draft from props/DB when modal opens
  useEffect(() => {
    if (modalOpen) {
      setDraftTitle(roomTitle || "");
      setDraftDescription(roomDescription || "");
      setDraftLock(Boolean(roomLock));
      setDraftChatEnabled(!isChatDisabled);
      
      setDraftNotif(Boolean(getCurrentSettings().disableChatSound));
      setDraftCamera(profile?.pref_camera_on ?? false);
      setDraftMic(profile?.pref_mic_on ?? false);

      setPasswordAction("keep");
      setDraftPassword("");
      setDraftPasswordConfirm("");
      setShowCurrentPassword(false);
      setCopiedCurrentPassword(false);
      
      setCoverFile(null);
      setClearCover(false);
      setError("");

      // Fetch current permanent status & cover
      const fetchRoomData = async () => {
        const { data } = await supabase
          .from("rooms")
          .select("isPermanent, isSubRoom, expiresAt, coverPhoto")
          .eq("roomId", roomId)
          .single();
        if (data) {
          const isPerm = Boolean(data.isPermanent);
          setDraftPermanent(isPerm);
          setOriginalCoverUrl(data.coverPhoto);
          setCoverPreview(data.coverPhoto);
        }
      };
      fetchRoomData();
    }
  }, [modalOpen, roomTitle, roomDescription, roomLock, isChatDisabled, profile, roomId]);

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [copiedCurrentPassword, setCopiedCurrentPassword] = useState(false);

  const cleanRoomId = roomId.startsWith("/") ? roomId.substring(1) : roomId;
  const currentSavedPasscode = (passcode && passcode !== "true" ? passcode : "");

  const handleFileChange = (payload: File | null) => {
    if (payload) {
      if (payload.size > 5 * 1024 * 1024) {
        setError("Cover photo too large (max 5MB).");
        return;
      }
      setCoverFile(payload);
      setCoverPreview(URL.createObjectURL(payload));
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    setError("");

    try {
      const token = await getAccessToken();
      if (!user) throw new Error("Not logged in");

      // 1. Live Runtime Lock (in-memory control for active playback)
      if (draftLock !== Boolean(roomLock)) {
        await setRoomLock(draftLock);
      }

      // 2. Save Local Settings
      updateSettings(
        JSON.stringify({
          ...getCurrentSettings(),
          disableChatSound: !draftNotif,
        })
      );
      
      const { error: prefError } = await supabase
        .from("profiles")
        .update({
          pref_camera_on: draftCamera,
          pref_mic_on: draftMic,
        })
        .eq("id", user.id);
      
      if (prefError) throw prefError;

      setModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to save settings");
    } finally {
      setIsLoading(false);
    }
  };

  const hasPasscodeCurrently = Boolean(passcode);
  const willHavePasscode = passwordAction === "keep" ? hasPasscodeCurrently : passwordAction === "change";

  return (
    <Modal
      opened={modalOpen}
      onClose={() => setModalOpen(false)}
      centered
      title="Settings"
      radius="md"
      size={850}
      styles={{
        content: {
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
          boxShadow: "var(--shadow-md)",
        },
        header: {
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "20px 24px",
        },
        body: { padding: "0" },
        title: {
          fontWeight: 700,
          fontSize: "22px",
        }
      }}
    >
      <div style={{ padding: "24px 24px" }}>
        <Text size="sm" c="dimmed" mb="md">Manage your room and personal preferences</Text>
        
        <Alert
          color="yellow"
          variant="light"
          mb="xl"
          icon={<IconAlertTriangle size={18} />}
          title="Room Details Locked"
        >
          Room details (title, description, cover photo, behavior, and password) cannot be modified while this watch party is actively running. You can manage live room lock and your personal local preferences below.
        </Alert>

        {error && <Text color="red" size="sm" mb="md" fw={500}>{error}</Text>}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={40}>
          {/* LEFT COLUMN */}
          <div>
            <Text fw={700} size="sm" mb="md" c="dimmed" style={{ letterSpacing: "1px" }}>ROOM SETTINGS</Text>
            <Stack gap="xl">
              <Switch
                label="Lock Room"
                description="Only the person who locked the room can control playback."
                checked={draftLock}
                onChange={(e) => setDraftLock(e.currentTarget.checked)}
                disabled={owner !== user?.id}
                size="md"
              />
              <Switch
                label="Permanent Room"
                description="Room does not automatically expire."
                checked={draftPermanent}
                onChange={(e) => setDraftPermanent(e.currentTarget.checked)}
                disabled={true}
                size="md"
              />
              <Switch
                label="Chat Enabled"
                description="Allow participants to send messages."
                checked={draftChatEnabled}
                onChange={(e) => setDraftChatEnabled(e.currentTarget.checked)}
                disabled={true}
                size="md"
              />
            </Stack>

            <Divider my="xl" />

            <Text fw={700} size="sm" mb="md" c="dimmed" style={{ letterSpacing: "1px" }}>LOCAL SETTINGS</Text>
            <Stack gap="xl">
              <Switch
                label="Chat Notifications"
                description="Play a sound for new messages."
                checked={draftNotif}
                onChange={(e) => setDraftNotif(e.currentTarget.checked)}
                size="md"
              />
              <Switch
                label="Camera Default"
                description="Join rooms with camera on."
                checked={draftCamera}
                onChange={(e) => setDraftCamera(e.currentTarget.checked)}
                size="md"
              />
              <Switch
                label="Microphone Default"
                description="Join rooms with microphone on."
                checked={draftMic}
                onChange={(e) => setDraftMic(e.currentTarget.checked)}
                size="md"
              />
            </Stack>
          </div>

          {/* RIGHT COLUMN */}
          <div>
            <Text fw={700} size="sm" mb="md" c="dimmed" style={{ letterSpacing: "1px" }}>ROOM DETAILS</Text>
            <Stack gap="md">
              <TextInput
                label="Room Title"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.currentTarget.value)}
                disabled={true}
              />
              <TextInput
                label="Description"
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.currentTarget.value)}
                placeholder="No description set"
                disabled={true}
              />

              <div>
                <Text size="sm" fw={500} mb={4}>Password Protection</Text>
                {passwordAction !== "change" ? (
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Group gap={6}>
                        <Badge
                          color={willHavePasscode ? "violet" : "gray"}
                          variant="light"
                          size="sm"
                          leftSection={willHavePasscode ? <IconLock size={12} /> : <IconLockOpen size={12} />}
                        >
                          {willHavePasscode ? "Protected" : "Unprotected"}
                        </Badge>
                      </Group>
                      <Group>
                        {willHavePasscode && (
                          <Button variant="subtle" color="red" size="xs" onClick={() => setPasswordAction("clear")} disabled={true}>
                            Clear Password
                          </Button>
                        )}
                        <Button variant="light" size="xs" onClick={() => setPasswordAction("change")} disabled={true}>
                          {willHavePasscode ? "Change Password" : "Set Password"}
                        </Button>
                      </Group>
                    </Group>

                    {willHavePasscode && currentSavedPasscode && (
                      <TextInput
                        readOnly
                        size="xs"
                        label="Current Password"
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentSavedPasscode}
                        rightSection={
                          <Group gap={4} pr={4}>
                            <Tooltip label={showCurrentPassword ? "Hide password" : "Show password"} withArrow>
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                color="gray"
                                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                aria-label="Toggle password visibility"
                              >
                                {showCurrentPassword ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={copiedCurrentPassword ? "Copied!" : "Copy password"} withArrow>
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                color={copiedCurrentPassword ? "green" : "gray"}
                                onClick={() => {
                                  navigator.clipboard.writeText(currentSavedPasscode);
                                  setCopiedCurrentPassword(true);
                                  setTimeout(() => setCopiedCurrentPassword(false), 2000);
                                }}
                                aria-label="Copy password"
                              >
                                {copiedCurrentPassword ? <IconCheck size={14} /> : <IconCopy size={14} />}
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        }
                        styles={{
                          input: {
                            fontFamily: showCurrentPassword ? "inherit" : "monospace",
                            letterSpacing: showCurrentPassword ? "normal" : "2px",
                          },
                        }}
                      />
                    )}
                  </Stack>
                ) : (
                  <Stack gap="xs">
                    <PasswordInput
                      placeholder="New Password"
                      value={draftPassword}
                      onChange={(e) => setDraftPassword(e.currentTarget.value)}
                      disabled={true}
                    />
                    <PasswordInput
                      placeholder="Confirm Password"
                      value={draftPasswordConfirm}
                      onChange={(e) => setDraftPasswordConfirm(e.currentTarget.value)}
                      disabled={true}
                    />
                    <Group justify="flex-end">
                      <Button variant="subtle" size="xs" onClick={() => setPasswordAction("keep")}>Cancel Password Change</Button>
                    </Group>
                  </Stack>
                )}
              </div>
            </Stack>

            <Divider my="xl" />

            <Text fw={700} size="sm" mb="md" c="dimmed" style={{ letterSpacing: "1px" }}>COVER</Text>
            <Stack gap="md">
              <div style={{
                height: "140px",
                width: "100%",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                background: "var(--bg-elevated)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                {coverPreview ? (
                  <Image src={coverPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <Text c="dimmed" size="sm">No cover photo</Text>
                )}
              </div>
              
              <Group>
                <FileButton onChange={handleFileChange} accept="image/png,image/jpeg,image/webp">
                  {(props) => <Button {...props} variant="light" size="xs" disabled={true}>Change Cover</Button>}
                </FileButton>
                {coverPreview && (
                  <Button variant="subtle" color="red" size="xs" onClick={() => { setCoverFile(null); setCoverPreview(null); setClearCover(true); }} disabled={true}>
                    Remove
                  </Button>
                )}
              </Group>
            </Stack>
          </div>
        </SimpleGrid>
      </div>
      
      {/* FOOTER */}
      <div style={{
        padding: "16px 24px",
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        display: "flex",
        justifyContent: "flex-end",
        gap: "12px",
        borderBottomLeftRadius: "8px",
        borderBottomRightRadius: "8px"
      }}>
        <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
        <Button onClick={handleSave} loading={isLoading}>Save Changes</Button>
      </div>
    </Modal>
  );
};
