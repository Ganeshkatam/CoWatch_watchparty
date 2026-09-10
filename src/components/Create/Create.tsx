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
  IconSparkles,
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

        {/* Hero Cinema Banner Header */}
        <div className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.heroBadge}>
              <IconSparkles size={13} />
              <span>Host a Watch Party</span>
            </div>
            <h1 className={styles.heroTitle}>Create a New Room</h1>
            <p className={styles.heroSubtitle}>
              Set up your room details, upload a custom cover photo, configure secure access, and set participant permissions.
            </p>
          </div>
        </div>

        {error && (
          <Alert color="red" title="Unable to create room">
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Card 1: Room Details */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardIconBadge}>
                <IconPhoto size={18} />
              </div>
              <div className={styles.cardHeaderMeta}>
                <span className={styles.cardTitle}>Room Details</span>
                <span className={styles.cardSubtitle}>
                  Basic information and visual cover shown to party participants.
                </span>
              </div>
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
                placeholder="e.g. Streaming movies, music videos, and browsing together"
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                maxLength={120}
                size="md"
              />

              <div>
                <Text size="sm" fw={500} mb={6}>
                  Cover Photo
                </Text>
                <div className={styles.coverContainer}>
                  <div className={styles.coverPreview}>
                    {coverPreview ? (
                      <img
                        src={coverPreview}
                        alt="Cover Preview"
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
                      placeholder="Choose image (JPG, PNG, WebP)"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={setCoverPhotoFile}
                      value={coverPhotoFile}
                      clearable
                      leftSection={<IconPhoto size={16} />}
                      size="sm"
                      styles={{ root: { width: "100%", maxWidth: 300 } }}
                    />
                    <Text size="xs" c="dimmed">
                      Recommended aspect ratio 16:9, max file size 5MB.
                    </Text>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Access & Security */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardIconBadge}>
                <IconShieldCheck size={18} />
              </div>
              <div className={styles.cardHeaderMeta}>
                <span className={styles.cardTitle}>Access & Security</span>
                <span className={styles.cardSubtitle}>
                  Protect your room with a custom passcode so only invited friends can enter.
                </span>
              </div>
            </div>

            <div className={styles.passcodeRow}>
              <div className={styles.passcodeField}>
                <PasswordInput
                  label="Room Passcode"
                  description="Participants must enter this passcode to join (minimum 8 characters)"
                  placeholder="Passcode"
                  value={passcode}
                  required
                  withAsterisk
                  minLength={8}
                  onChange={(e) => setPasscode(e.target.value)}
                  size="md"
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
                  title="Generate a new random passcode"
                >
                  Regenerate
                </Button>
              </div>
            </div>
          </div>

          {/* Card 3: Controls & Permissions */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardIconBadge}>
                <IconSettings size={18} />
              </div>
              <div className={styles.cardHeaderMeta}>
                <span className={styles.cardTitle}>Controls & Permissions</span>
                <span className={styles.cardSubtitle}>
                  Configure participant playback privileges, chat access, and room lifecycle.
                </span>
              </div>
            </div>

            <div className={styles.togglesList}>
              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Lock Room Controls</span>
                  <span className={styles.settingDescription}>
                    Only room hosts can control media playback and manage the playlist queue.
                  </span>
                </div>
                <Switch
                  checked={lock}
                  onChange={(e) => setLock(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  aria-label="Lock Room Controls"
                />
              </div>

              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Disable Chat</span>
                  <span className={styles.settingDescription}>
                    Turn off the live text chat sidebar for all participants in this room.
                  </span>
                </div>
                <Switch
                  checked={isChatDisabled}
                  onChange={(e) => setIsChatDisabled(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  aria-label="Disable Chat"
                />
              </div>

              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Permanent Room</span>
                  <span className={styles.settingDescription}>
                    Keep this room active permanently instead of automatically expiring after 3 hours.
                  </span>
                </div>
                <Switch
                  checked={isPermanent}
                  onChange={(e) => setIsPermanent(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  aria-label="Permanent Room"
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
