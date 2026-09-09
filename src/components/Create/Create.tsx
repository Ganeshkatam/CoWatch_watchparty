import React, { useContext, useState } from "react";
import { createRoom } from "../TopBar/TopBar";
import {
  TextInput,
  PasswordInput,
  Button,
  Switch,
  Container,
  Paper,
  Title,
  Text,
  Alert,
  Loader,
  FileInput,
} from "@mantine/core";
import { supabase, getAccessToken } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import { useHistory } from "react-router-dom";
import { IconCirclePlusFilled } from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

export const Create = () => {
  const { user } = useContext(MetadataContext);
  const history = useHistory();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useDocumentMetadata({
    title: "Create a Room",
    description: "Create a new watch party room to stream movies, YouTube videos, and browse together.",
  });

  // Form states
  const [roomTitle, setRoomTitle] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const generatePasscode = () => Math.random().toString(36).substring(2, 10).padEnd(8, '0');
  const [passcode, setPasscode] = useState(generatePasscode());

  const [isChatDisabled, setIsChatDisabled] = useState(false);
  const [lock, setLock] = useState(false);
  const [isPermanent, setIsPermanent] = useState(false);
  const [coverPhotoFile, setCoverPhotoFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomTitle.trim()) {
      setError("Room title is required.");
      return;
    }
    if (passcode.length < 8) {
      setError("Passcode must be at least 8 characters long.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const roomName = await createRoom(
        user,
        false,
        new URLSearchParams(window.location.search).get("video") ?? "",
        {
          roomTitle: roomTitle.trim(),
          roomDescription: roomDescription || undefined,
          passcode: passcode || undefined,
          isPermanent,
          isChatDisabled,
          lock,
          noRedirect: true,
        }
      );

      if (coverPhotoFile && user) {
        if (coverPhotoFile.size > 5 * 1024 * 1024) {
          console.error("Cover photo too large (max 5MB).");
        } else {
          const fileExt = coverPhotoFile.name.split('.').pop();
          const safeRoomId = roomName.startsWith("/") ? roomName.substring(1) : roomName;
          const filePath = `${user.id}/${safeRoomId}/cover.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('room_covers')
            .upload(filePath, coverPhotoFile);
            
          if (!uploadError) {
            const { data: publicUrlData } = supabase.storage.from('room_covers').getPublicUrl(filePath);
            await fetch(`${serverPath}/updateRoomCover`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                uid: user.id,
                token: await getAccessToken(),
                roomId: roomName,
                coverPhoto: publicUrlData.publicUrl
              })
            }).catch(e => console.error("Failed to update room cover", e));
          } else {
            console.error("Cover upload failed", uploadError);
          }
        }
      }

      const finalRoomId = roomName.startsWith("/") ? roomName.substring(1) : roomName;
      window.location.assign(`/watch/${finalRoomId}`);
    } catch (err: any) {
      console.error("Room creation error:", err);
      setError(err.message || "Failed to create room.");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "var(--bg-app)",
        padding: "20px",
      }}
    >
      <Container size="sm" style={{ width: "100%", maxWidth: "540px" }}>
        <Paper
          withBorder
          p={30}
          radius="lg"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
            backdropFilter: "blur(20px)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <Title order={2} ta="center" mb="xs" fw={800} style={{ color: "var(--text-primary)" }}>
            Create a New Room
          </Title>
          <Text size="sm" c="dimmed" ta="center" mb="lg">
            Configure your room settings below. These settings cannot be changed once the room is active.
          </Text>

          {error && (
            <Alert color="red" mb="md" title="Error">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <TextInput
              label="Room Title"
              required
              withAsterisk
              placeholder="e.g. Movie Night with Friends"
              value={roomTitle}
              onChange={(e) => setRoomTitle(e.target.value)}
              maxLength={50}
            />

            <TextInput
              label="Room Description"
              placeholder="e.g. Watching some movies together!"
              value={roomDescription}
              onChange={(e) => setRoomDescription(e.target.value)}
              maxLength={120}
            />



            <PasswordInput
              label="Room Passcode (Required)"
              description="Users must enter this passcode to join (min 8 characters)"
              placeholder="Passcode"
              value={passcode}
              required
              minLength={8}
              onChange={(e) => setPasscode(e.target.value)}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
              <Switch
                label="Disable Chat"
                description="Prevent users from sending chat messages"
                checked={isChatDisabled}
                onChange={(e) => setIsChatDisabled(e.currentTarget.checked)}
                size="md"
              />

              <Switch
                label="Lock Room Controls"
                description="Only room creators/hosts can control playback"
                checked={lock}
                onChange={(e) => setLock(e.currentTarget.checked)}
                size="md"
              />

              <Switch
                label="Permanent Room"
                description="Keep this room saved permanently (by default, temporary rooms expire after 3 hours)"
                checked={isPermanent}
                onChange={(e) => setIsPermanent(e.currentTarget.checked)}
                size="md"
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <Text size="sm" fw={500}>Cover Photo</Text>
              <FileInput
                placeholder="Upload cover photo (JPG, PNG, WebP)"
                accept="image/jpeg,image/png,image/webp"
                onChange={setCoverPhotoFile}
                value={coverPhotoFile}
                clearable
                description="Max 5 MB"
              />
            </div>

            <Button
              type="submit"
              size="lg"
              variant="gradient"
              disabled={loading}
              leftSection={loading ? <Loader size={20} color="white" /> : <IconCirclePlusFilled size={20} />}
              style={{ marginTop: "10px" }}
            >
              {loading ? "Creating Room..." : "Create Room"}
            </Button>
          </form>
        </Paper>
      </Container>
    </div>
  );
};
