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
  Avatar,
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

const PRESET_ROOM_AVATARS = [
  { id: "avatar-1", label: "Neon Pop", url: "/avatars/avatar_1.jpg" },
  { id: "avatar-2", label: "Cosmic", url: "/avatars/avatar_2.jpg" },
  { id: "avatar-3", label: "Cyberpunk", url: "/avatars/avatar_3.jpg" },
  { id: "avatar-4", label: "Anime Chill", url: "/avatars/avatar_4.jpg" },
  { id: "avatar-5", label: "Retro Synth", url: "/avatars/avatar_5.jpg" },
];

export const Create = () => {
  const { user, avatarUrl } = useContext(MetadataContext);
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

  // Avatar & Cover states
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(null);
  const [coverPhotoFile, setCoverPhotoFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!coverPhotoFile) {
      if (!selectedAvatarUrl) {
        setCoverPreview(null);
      }
      return;
    }
    const objectUrl = URL.createObjectURL(coverPhotoFile);
    setCoverPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverPhotoFile, selectedAvatarUrl]);

  const handleSelectPresetAvatar = (url: string) => {
    if (selectedAvatarUrl === url && !coverPhotoFile) {
      setSelectedAvatarUrl(null);
      setCoverPreview(null);
    } else {
      setSelectedAvatarUrl(url);
      setCoverPhotoFile(null);
      setCoverPreview(url);
    }
  };

  const handleSelectOwnAvatar = () => {
    if (!avatarUrl) return;
    if (selectedAvatarUrl === avatarUrl && !coverPhotoFile) {
      setSelectedAvatarUrl(null);
      setCoverPreview(null);
    } else {
      setSelectedAvatarUrl(avatarUrl);
      setCoverPhotoFile(null);
      setCoverPreview(avatarUrl);
    }
  };

  const handleClearAvatar = () => {
    setSelectedAvatarUrl(null);
    setCoverPhotoFile(null);
    setCoverPreview(null);
  };

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
        const finalCoverUrl = selectedAvatarUrl;
        const roomName = await createRoom(
          user,
          false,
          new URLSearchParams(window.location.search).get("video") ?? "",
          {
            roomTitle: roomTitle.trim(),
            roomDescription: roomDescription || undefined,
            coverPhoto: finalCoverUrl || undefined,
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
        } else if (finalCoverUrl && user) {
          await fetch(`${serverPath}/updateRoomCover`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid: user.id,
              token: await getAccessToken(),
              roomId: roomName,
              coverPhoto: finalCoverUrl,
            }),
          }).catch((err) =>
            console.error("Failed to update room cover", err)
          );
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
                  Room Avatar & Picture
                </Text>
                <div className={styles.coverContainer}>
                  <div className={styles.coverHeaderRow}>
                    <div className={styles.coverPreview}>
                      {coverPreview ? (
                        <img
                          src={coverPreview}
                          alt="Cover preview"
                          className={styles.coverImg}
                        />
                      ) : (
                        <div className={styles.coverPlaceholder}>
                          <IconPhoto size={20} />
                          <span>Preview</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.coverMeta}>
                      <Text size="xs" fw={500} c="dimmed">
                        {coverPreview
                          ? selectedAvatarUrl === avatarUrl
                            ? "Using your profile avatar"
                            : selectedAvatarUrl
                            ? "Selected preset avatar"
                            : "Custom uploaded picture"
                          : "Select an avatar below or upload your own"}
                      </Text>
                      {coverPreview && (
                        <Button
                          variant="subtle"
                          color="gray"
                          size="xs"
                          p={0}
                          onClick={handleClearAvatar}
                          style={{ height: "auto", alignSelf: "flex-start" }}
                        >
                          Remove picture
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Preset Avatars Selection */}
                  <div className={styles.coverSelectionTitle}>Choose an avatar</div>
                  <div className={styles.avatarPresetsGrid}>
                    {PRESET_ROOM_AVATARS.map((preset) => {
                      const isSelected =
                        selectedAvatarUrl === preset.url && !coverPhotoFile;
                      return (
                        <Tooltip key={preset.id} label={preset.label} withArrow>
                          <button
                            type="button"
                            className={`${styles.avatarOptionBtn} ${
                              isSelected ? styles.avatarOptionBtnActive : ""
                            }`}
                            onClick={() => handleSelectPresetAvatar(preset.url)}
                            aria-label={`Select ${preset.label} avatar`}
                          >
                            <img
                              src={preset.url}
                              alt={preset.label}
                              className={styles.avatarOptionImg}
                            />
                            {isSelected && (
                              <span className={styles.avatarCheckBadge}>
                                <IconCheck size={10} stroke={3} />
                              </span>
                            )}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>

                  {/* Own Avatar & Custom Upload */}
                  <div className={styles.avatarActionsRow}>
                    {avatarUrl && (
                      <button
                        type="button"
                        className={`${styles.ownAvatarBtn} ${
                          selectedAvatarUrl === avatarUrl && !coverPhotoFile
                            ? styles.ownAvatarBtnActive
                            : ""
                        }`}
                        onClick={handleSelectOwnAvatar}
                        title="Use your profile picture as room cover"
                      >
                        <Avatar src={avatarUrl} size={22} radius="xl" />
                        <span>Use my profile picture</span>
                        {selectedAvatarUrl === avatarUrl && !coverPhotoFile && (
                          <IconCheck size={14} stroke={2.5} />
                        )}
                      </button>
                    )}

                    <FileInput
                      placeholder="Or upload custom picture"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(file) => {
                        setCoverPhotoFile(file);
                        if (file) {
                          setSelectedAvatarUrl(null);
                        }
                      }}
                      value={coverPhotoFile}
                      clearable
                      leftSection={<IconPhoto size={16} />}
                      size="sm"
                      styles={{ root: { maxWidth: 240 } }}
                    />
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
