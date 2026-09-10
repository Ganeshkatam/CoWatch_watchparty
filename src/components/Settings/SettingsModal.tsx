import React, { useState, useEffect, useContext } from "react";
import {
  Button,
  Modal,
  Switch,
  Text,
  Stack,
  Divider,
} from "@mantine/core";
import { getCurrentSettings, updateSettings } from "./LocalSettings";
import { Socket } from "socket.io-client";
import { MetadataContext } from "../../MetadataContext";
import { supabase } from "../../utils/supabaseClient";

interface SettingsModalProps {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  roomLock: string;
  setRoomLock: (lock: boolean) => Promise<void>;
  socket: Socket;
  roomId: string;
  owner: string | undefined;
  setOwner?: (owner: string) => void;
  inviteLink?: string;
  passcode?: string | undefined;
  setPasscode?: (passcode: string) => void;
  isChatDisabled?: boolean;
  setIsChatDisabled?: (disabled: boolean) => void;
  clearChat?: () => void;
  roomTitle?: string;
  setRoomTitle?: (title: string) => void;
  roomDescription?: string | undefined;
  setRoomDescription?: (desc: string) => void;
  mediaPath?: string | undefined;
  setMediaPath?: (path: string) => void;
}

export const SettingsModal = ({
  modalOpen,
  setModalOpen,
  roomLock,
  setRoomLock,
  owner,
}: SettingsModalProps) => {
  const { user, profile } = useContext(MetadataContext);
  
  // -- DRAFT STATE --
  const [draftLock, setDraftLock] = useState(Boolean(roomLock));
  
  // Local settings draft
  const [draftNotif, setDraftNotif] = useState(Boolean(getCurrentSettings().disableChatSound));
  const [draftCamera, setDraftCamera] = useState(profile?.pref_camera_on ?? false);
  const [draftMic, setDraftMic] = useState(profile?.pref_mic_on ?? false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Sync draft from props when modal opens
  useEffect(() => {
    if (modalOpen) {
      setDraftLock(Boolean(roomLock));
      setDraftNotif(Boolean(getCurrentSettings().disableChatSound));
      setDraftCamera(profile?.pref_camera_on ?? false);
      setDraftMic(profile?.pref_mic_on ?? false);
      setError("");
    }
  }, [modalOpen, roomLock, profile]);

  const handleSave = async () => {
    setIsLoading(true);
    setError("");

    try {
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

  const isOwner = Boolean(owner && user && owner === user.id);

  return (
    <Modal
      opened={modalOpen}
      onClose={() => setModalOpen(false)}
      centered
      title="Settings"
      radius="md"
      size={520}
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
          padding: "18px 22px",
        },
        body: { padding: "0" },
        title: {
          fontWeight: 700,
          fontSize: "20px",
        }
      }}
    >
      <div style={{ padding: "20px 22px" }}>
        <Text size="sm" c="dimmed" mb="lg">
          Manage playback permissions and your personal watch preferences.
        </Text>

        {error && (
          <Text color="red" size="sm" mb="md" fw={500}>
            {error}
          </Text>
        )}

        <Stack gap="xl">
          {/* ROOM PLAYBACK CONTROLS */}
          <div>
            <Text fw={700} size="xs" mb="sm" c="dimmed" style={{ letterSpacing: "0.08em" }}>
              ROOM CONTROLS
            </Text>
            <Stack gap="md">
              <Switch
                label="Lock Playback Controls"
                description={
                  isOwner
                    ? "Only you (the room host) can play, pause, seek, and change media."
                    : "Only the room host can modify playback lock permissions."
                }
                checked={draftLock}
                onChange={(e) => setDraftLock(e.currentTarget.checked)}
                disabled={!isOwner}
                size="md"
              />
            </Stack>
          </div>

          <Divider />

          {/* LOCAL PREFERENCES */}
          <div>
            <Text fw={700} size="xs" mb="sm" c="dimmed" style={{ letterSpacing: "0.08em" }}>
              LOCAL PREFERENCES
            </Text>
            <Stack gap="md">
              <Switch
                label="Chat Notifications"
                description="Play an audible sound when new chat messages arrive."
                checked={draftNotif}
                onChange={(e) => setDraftNotif(e.currentTarget.checked)}
                size="md"
              />
              <Switch
                label="Camera Default"
                description="Automatically join rooms with your camera enabled."
                checked={draftCamera}
                onChange={(e) => setDraftCamera(e.currentTarget.checked)}
                size="md"
              />
              <Switch
                label="Microphone Default"
                description="Automatically join rooms with your microphone enabled."
                checked={draftMic}
                onChange={(e) => setDraftMic(e.currentTarget.checked)}
                size="md"
              />
            </Stack>
          </div>
        </Stack>
      </div>
      
      {/* FOOTER */}
      <div style={{
        padding: "14px 22px",
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        display: "flex",
        justifyContent: "flex-end",
        gap: "10px",
        borderBottomLeftRadius: "8px",
        borderBottomRightRadius: "8px"
      }}>
        <Button variant="default" onClick={() => setModalOpen(false)}>
          Cancel
        </Button>
        <Button color="violet" onClick={handleSave} loading={isLoading}>
          Save Changes
        </Button>
      </div>
    </Modal>
  );
};
