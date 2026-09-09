import React, { useContext, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  TextInput,
  PasswordInput,
  Button,
  Switch,
  Alert,
  Loader,
  FileInput,
  Text,
} from "@mantine/core";
import {
  IconCirclePlusFilled,
  IconArrowLeft,
  IconRefresh,
  IconPhoto,
} from "@tabler/icons-react";
import { createRoom } from "../TopBar/TopBar";
import { supabase, getAccessToken } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Create.module.css";

export const Create = () => {
  const { user } = useContext(MetadataContext);
  const history = useHistory();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useDocumentMetadata({
    title: "Create a Room",
    description:
      "Create a new watch party room to stream movies, YouTube videos, and browse together.",
  });

  // Form states
  const [roomTitle, setRoomTitle] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const generatePasscode = () =>
    Math.random().toString(36).substring(2, 10).padEnd(8, "0");
  const [passcode, setPasscode] = useState(generatePasscode());

  const [isChatDisabled, setIsChatDisabled] = useState(false);
  const [lock, setLock] = useState(false);
  const [isPermanent, setIsPermanent] = useState(false);
  const [coverPhotoFile, setCoverPhotoFile] = useState<File | null>(null);

  const handleRegeneratePasscode = () => {
    setPasscode(generatePasscode());
  };

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
          const fileExt = coverPhotoFile.name.split(".").pop();
          const safeRoomId = roomName.startsWith("/")
            ? roomName.substring(1)
            : roomName;
          const filePath = `${user.id}/${safeRoomId}/cover.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from("room_covers")
            .upload(filePath, coverPhotoFile);

          if (!uploadError) {
            const { data: publicUrlData } = supabase.storage
              .from("room_covers")
              .getPublicUrl(filePath);
            await fetch(`${serverPath}/updateRoomCover`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                uid: user.id,
                token: await getAccessToken(),
                roomId: roomName,
                coverPhoto: publicUrlData.publicUrl,
              }),
            }).catch((err) =>
              console.error("Failed to update room cover", err)
            );
          } else {
            console.error("Cover upload failed", uploadError);
          }
        }
      }

      const finalRoomId = roomName.startsWith("/")
        ? roomName.substring(1)
        : roomName;
      window.location.assign(`/watch/${finalRoomId}`);
    } catch (err: any) {
      console.error("Room creation error:", err);
      setError(err.message || "Failed to create room.");
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header Section */}
        <div className={styles.header}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => history.goBack()}
          >
            <IconArrowLeft size={16} />
            <span>Back</span>
          </button>
          <h1 className={styles.title}>Create a Room</h1>
          <p className={styles.subtitle}>
            Set up your watch party details, security passcode, and permissions.
          </p>
        </div>

        {error && (
          <Alert color="red" title="Unable to create room">
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Section 1: Room Details */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Room Details</span>
              <span className={styles.sectionDescription}>
                Basic information displayed to participants in your party.
              </span>
            </div>

            <div className={styles.fieldsStack}>
              <TextInput
                label="Room Title"
                required
                withAsterisk
                placeholder="e.g. Movie Night with Friends"
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                maxLength={50}
                size="md"
              />

              <TextInput
                label="Room Description"
                placeholder="e.g. Streaming high-quality movies and music together"
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                maxLength={120}
                size="md"
              />

              <div>
                <Text size="sm" fw={500} mb={4}>
                  Cover Photo
                </Text>
                <FileInput
                  placeholder="Upload cover image (JPG, PNG, WebP)"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={setCoverPhotoFile}
                  value={coverPhotoFile}
                  clearable
                  leftSection={<IconPhoto size={16} />}
                  description="Optional banner image up to 5 MB"
                  size="md"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Access & Security */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Access & Security</span>
              <span className={styles.sectionDescription}>
                Protect your room from unwanted access.
              </span>
            </div>

            <div className={styles.passcodeRow}>
              <div className={styles.passcodeField}>
                <PasswordInput
                  label="Room Passcode"
                  description="Participants must enter this passcode to enter (min 8 characters)"
                  placeholder="Passcode"
                  value={passcode}
                  required
                  withAsterisk
                  minLength={8}
                  onChange={(e) => setPasscode(e.target.value)}
                  size="md"
                />
              </div>
              <Button
                type="button"
                variant="default"
                onClick={handleRegeneratePasscode}
                leftSection={<IconRefresh size={15} />}
                className={styles.regenerateButton}
                title="Generate a new random passcode"
              >
                Regenerate
              </Button>
            </div>
          </div>

          {/* Section 3: Room Controls & Features */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>
                Controls & Permissions
              </span>
              <span className={styles.sectionDescription}>
                Manage permissions and room lifespan.
              </span>
            </div>

            <div className={styles.togglesList}>
              <div className={styles.toggleRow}>
                <div className={styles.toggleMeta}>
                  <span className={styles.toggleTitle}>
                    Lock Room Controls
                  </span>
                  <span className={styles.toggleDescription}>
                    Only room hosts can control media playback and queue items.
                  </span>
                </div>
                <Switch
                  checked={lock}
                  onChange={(e) => setLock(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                />
              </div>

              <div className={styles.toggleRow}>
                <div className={styles.toggleMeta}>
                  <span className={styles.toggleTitle}>Disable Chat</span>
                  <span className={styles.toggleDescription}>
                    Turn off the text chat sidebar for all participants.
                  </span>
                </div>
                <Switch
                  checked={isChatDisabled}
                  onChange={(e) =>
                    setIsChatDisabled(e.currentTarget.checked)
                  }
                  size="md"
                  color="violet"
                />
              </div>

              <div className={styles.toggleRow}>
                <div className={styles.toggleMeta}>
                  <span className={styles.toggleTitle}>Permanent Room</span>
                  <span className={styles.toggleDescription}>
                    Keep this room active permanently instead of expiring
                    after 3 hours.
                  </span>
                </div>
                <Switch
                  checked={isPermanent}
                  onChange={(e) =>
                    setIsPermanent(e.currentTarget.checked)
                  }
                  size="md"
                  color="violet"
                />
              </div>
            </div>
          </div>

          {/* Actions Footer */}
          <div className={styles.actionsRow}>
            <Button
              type="button"
              variant="subtle"
              color="gray"
              size="md"
              onClick={() => history.goBack()}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="md"
              variant="gradient"
              gradient={{ from: "violet", to: "indigo", deg: 135 }}
              disabled={loading}
              loading={loading}
              leftSection={
                loading ? (
                  <Loader size={18} color="white" />
                ) : (
                  <IconCirclePlusFilled size={18} />
                )
              }
              className={styles.submitButton}
            >
              {loading ? "Creating Room..." : "Create Room"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
