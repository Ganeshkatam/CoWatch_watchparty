import React, { useContext, useState, useEffect } from "react";
import { useHistory, Link } from "react-router-dom";
import {
  TextInput,
  PasswordInput,
  Button,
  Switch,
  Alert,
  Loader,
  FileInput,
  Text,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconCirclePlusFilled,
  IconArrowLeft,
  IconRefresh,
  IconPhoto,
  IconCopy,
  IconCheck,
  IconShieldCheck,
  IconSettings,
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
  const [showPasscode, setShowPasscode] = useState(true);
  const [copiedPasscode, setCopiedPasscode] = useState(false);

  const [isChatDisabled, setIsChatDisabled] = useState(false);
  const [lock, setLock] = useState(false);
  const [isPermanent, setIsPermanent] = useState(false);
  const [coverPhotoFile, setCoverPhotoFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!coverPhotoFile) {
      setCoverPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(coverPhotoFile);
    setCoverPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverPhotoFile]);

  const handleRegeneratePasscode = () => {
    setPasscode(generatePasscode());
  };

  const handleCopyPasscode = () => {
    if (!passcode) return;
    navigator.clipboard.writeText(passcode);
    setCopiedPasscode(true);
    setTimeout(() => setCopiedPasscode(false), 2000);
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
        {/* Breadcrumb navigation */}
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link to="/" className={styles.breadcrumbLink}>
            <IconArrowLeft size={14} />
            <span>Home</span>
          </Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>Create Room</span>
        </nav>


        {error && (
          <Alert color="red" title="Unable to create room">
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} id="create-room-form" className={styles.form}>
          {/* Card 1: Room Details */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardIconBadge}>
                <IconPhoto size={18} />
              </div>
              <div className={styles.cardHeaderMeta}>
                <span className={styles.cardTitle}>Room Details</span>
                <span className={styles.cardSubtitle}>
                  Enter a room name, optional description, and cover picture.
                </span>
              </div>
            </div>

            <div className={styles.fieldsStack}>
              <TextInput
                label="Room name"
                required
                withAsterisk
                placeholder="e.g. Movie night with friends"
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                maxLength={50}
                size="md"
              />

              <TextInput
                label="Description"
                placeholder="e.g. Watching movies, videos, and music together"
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                maxLength={120}
                size="md"
              />

              <div>
                <Text size="sm" fw={500} mb={6}>
                  Cover picture
                </Text>
                <div className={styles.coverContainer}>
                  <div className={styles.coverPreview}>
                    {coverPreview ? (
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        className={styles.coverImg}
                      />
                    ) : (
                      <div className={styles.coverPlaceholder}>
                        <IconPhoto size={22} />
                        <span>16:9 Banner</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.coverActions}>
                    <FileInput
                      placeholder="Choose picture (JPG, PNG, WebP)"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={setCoverPhotoFile}
                      value={coverPhotoFile}
                      clearable
                      leftSection={<IconPhoto size={16} />}
                      size="sm"
                      styles={{ root: { width: "100%", maxWidth: 300 } }}
                    />
                    <Text size="xs" c="dimmed">
                      Recommended 16:9 ratio, max 5 MB.
                    </Text>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Passcode & Access */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardIconBadge}>
                <IconShieldCheck size={18} />
              </div>
              <div className={styles.cardHeaderMeta}>
                <span className={styles.cardTitle}>Passcode & Access</span>
                <span className={styles.cardSubtitle}>
                  Set a passcode to keep your room private for invited friends.
                </span>
              </div>
            </div>

            <div className={styles.passcodeRow}>
              <div className={styles.passcodeField}>
                <PasswordInput
                  label="Room passcode"
                  description="Friends enter this passcode to join (at least 8 characters)"
                  placeholder="Passcode"
                  value={passcode}
                  required
                  withAsterisk
                  minLength={8}
                  onChange={(e) => setPasscode(e.target.value)}
                  size="md"
                  visible={showPasscode}
                  onVisibilityChange={setShowPasscode}
                />
              </div>
              <div className={styles.passcodeControls}>
                <Tooltip label={copiedPasscode ? "Copied!" : "Copy passcode"}>
                  <ActionIcon
                    size={38}
                    variant="default"
                    onClick={handleCopyPasscode}
                    aria-label="Copy passcode"
                  >
                    {copiedPasscode ? (
                      <IconCheck size={16} color="var(--mantine-color-teal-5)" />
                    ) : (
                      <IconCopy size={16} />
                    )}
                  </ActionIcon>
                </Tooltip>
                <Button
                  type="button"
                  variant="default"
                  onClick={handleRegeneratePasscode}
                  leftSection={<IconRefresh size={15} />}
                  className={styles.regenerateButton}
                  title="Make a new random passcode"
                >
                  New passcode
                </Button>
              </div>
            </div>
          </div>

          {/* Card 3: Room Settings */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardIconBadge}>
                <IconSettings size={18} />
              </div>
              <div className={styles.cardHeaderMeta}>
                <span className={styles.cardTitle}>Room Settings</span>
                <span className={styles.cardSubtitle}>
                  Choose who can control videos, chat, and room duration.
                </span>
              </div>
            </div>

            <div className={styles.togglesList}>
              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Lock video controls</span>
                  <span className={styles.settingDescription}>
                    Only room hosts can play, pause, or change videos.
                  </span>
                </div>
                <Switch
                  checked={lock}
                  onChange={(e) => setLock(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  aria-label="Lock video controls"
                />
              </div>

              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Turn off chat</span>
                  <span className={styles.settingDescription}>
                    Turn off the text chat sidebar for everyone in this room.
                  </span>
                </div>
                <Switch
                  checked={isChatDisabled}
                  onChange={(e) => setIsChatDisabled(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  aria-label="Turn off chat"
                />
              </div>

              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Keep room permanent</span>
                  <span className={styles.settingDescription}>
                    Keep this room open permanently instead of closing after 3 hours.
                  </span>
                </div>
                <Switch
                  checked={isPermanent}
                  onChange={(e) => setIsPermanent(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  aria-label="Keep room permanent"
                />
              </div>
            </div>
          </div>

          {/* Sticky Actions Bar - Always accessible while scrolling */}
          <div className={styles.actionsRow}>
            <div className={styles.actionsRowMeta}>
              <Text size="xs" c="dimmed">
                You can change room settings anytime.
              </Text>
            </div>
            <div className={styles.actionsRowButtons}>
              <Button
                type="button"
                variant="default"
                size="md"
                onClick={() => history.goBack()}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="md"
                color="violet"
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
          </div>
        </form>
      </div>
    </div>
  );
};
