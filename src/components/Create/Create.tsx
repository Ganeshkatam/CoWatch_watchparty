import React, { useContext, useState, useEffect } from "react";
import { useHistory, Link } from "react-router-dom";
import {
  TextInput,
  PasswordInput,
  Button,
  Switch,
  Alert,
  Loader,
  FileButton,
  Text,
  ActionIcon,
  Tooltip,
  Textarea,
  Select,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCirclePlusFilled,
  IconArrowLeft,
  IconRefresh,
  IconPhoto,
  IconCopy,
  IconCheck,
  IconShieldCheck,
  IconSettings,
  IconPlus,
  IconClock,
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
  const [showDescription, setShowDescription] = useState(false);
  const generatePasscode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };
  const [passcode, setPasscode] = useState(generatePasscode());
  const [passcodeError, setPasscodeError] = useState("");
  const [checkingPasscode, setCheckingPasscode] = useState(false);
  const [showPasscode, setShowPasscode] = useState(true);
  const [copiedPasscode, setCopiedPasscode] = useState(false);

  const [isChatDisabled, setIsChatDisabled] = useState(false);
  const [lock, setLock] = useState(false);
  const [isPermanent, setIsPermanent] = useState(false);
  const [durationHours, setDurationHours] = useState<string>("3");

  const DURATION_OPTIONS = [
    { value: "1", label: "1 hour" },
    { value: "2", label: "2 hours" },
    { value: "3", label: "3 hours (Standard)" },
    { value: "4", label: "4 hours" },
    { value: "5", label: "5 hours" },
    { value: "6", label: "6 hours (Maximum)" },
  ];

  // Cover picture states
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

  useEffect(() => {
    if (passcode.length !== 8) {
      setPasscodeError("Passcode must be strictly 8 characters long.");
      return;
    }
    setPasscodeError("");
    let isCancelled = false;
    const timer = setTimeout(async () => {
      setCheckingPasscode(true);
      try {
        const resp = await fetch(`${serverPath}/checkPasscodeAvailability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode }),
        });
        if (isCancelled) return;
        const data = await resp.json();
        if (data.available === false) {
          setPasscodeError("This passcode is already taken. Each room passcode must be unique.");
        } else {
          setPasscodeError("");
        }
      } catch {
        // network or offline
      } finally {
        if (!isCancelled) setCheckingPasscode(false);
      }
    }, 200);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [passcode]);

  const handleCoverPhotoChange = (file: File | null) => {
    if (!file) {
      setCoverPhotoFile(null);
      setCoverPreview(null);
      return;
    }
    if (file.size >= 1 * 1024 * 1024) {
      notifications.show({
        title: "File Too Large",
        message: "Room picture must be less than 1MB.",
        color: "red",
        autoClose: 4000,
      });
      return;
    }
    setCoverPhotoFile(file);
  };

  const handleClearAvatar = () => {
    setCoverPhotoFile(null);
    setCoverPreview(null);
  };

  const handleRegeneratePasscode = () => {
    setPasscode(generatePasscode());
    setPasscodeError("");
  };

  const handleCopyPasscode = () => {
    if (!passcode) return;
    navigator.clipboard.writeText(passcode);
    setCopiedPasscode(true);
    setTimeout(() => setCopiedPasscode(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError("An account is required to create a room. If you do not have an account, kindly create an account to get started.");
      return;
    }
    if (!roomTitle.trim()) {
      setError("Room title is required.");
      return;
    }
    if (passcode.length !== 8) {
      setError("Passcode must be strictly 8 characters long.");
      return;
    }
    if (passcodeError) {
      setError(passcodeError);
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
          durationHours: isPermanent ? undefined : parseInt(durationHours, 10) || 3,
          isChatDisabled,
          lock,
          noRedirect: true,
        }
      );

      if (coverPhotoFile && user) {
        if (coverPhotoFile.size >= 1 * 1024 * 1024) {
          setError("Room picture must be less than 1MB.");
          setLoading(false);
          return;
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
      const msg = err.message || "Failed to create room.";
      setError(msg);
      if (msg.toLowerCase().includes("passcode") || msg.toLowerCase().includes("taken")) {
        setPasscodeError(msg);
      }
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


        {!user && (
          <Alert
            color="violet"
            mb="lg"
            title="Account Required"
            styles={{
              root: {
                border: "1px solid var(--border-subtle)",
                background: "var(--color-violet-light, rgba(139, 92, 246, 0.08))",
              },
            }}
          >
            <Text size="sm">
              An account is required to create and host watch party rooms. If you do not have an account, kindly create an account to get started.
            </Text>
            <div style={{ marginTop: "12px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Button
                component={Link}
                to="/signup?redirect=%2Fcreate"
                size="xs"
                variant="filled"
                color="violet"
              >
                Create an account
              </Button>
              <Button
                component={Link}
                to="/login?redirect=%2Fcreate"
                size="xs"
                variant="light"
                color="violet"
              >
                Sign in
              </Button>
            </div>
          </Alert>
        )}

        {error && (
          <Alert color="red" mb="md" title="Unable to create room">
            <div>{error}</div>
            {error.includes("create an account") && (
              <div style={{ marginTop: "10px" }}>
                <Button
                  component={Link}
                  to="/signup?redirect=%2Fcreate"
                  size="xs"
                  variant="filled"
                  color="violet"
                >
                  Create an account
                </Button>
              </div>
            )}
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
                  Enter a room name, optional description, cover picture, and session duration.
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

              {!showDescription && !roomDescription ? (
                <div className={styles.addDescriptionRow}>
                  <button
                    type="button"
                    className={styles.addDescriptionBtn}
                    onClick={() => setShowDescription(true)}
                  >
                    <IconPlus size={14} />
                    <span>Add room description (optional)</span>
                  </button>
                </div>
              ) : (
                <div className={styles.descriptionContainer}>
                  <div className={styles.descriptionHeader}>
                    <Text size="sm" fw={500} c="var(--text-primary)">
                      Description
                    </Text>
                    <button
                      type="button"
                      className={styles.removeDescriptionBtn}
                      onClick={() => {
                        setRoomDescription("");
                        setShowDescription(false);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <Textarea
                    placeholder="e.g. Watching movies, videos, and music together"
                    value={roomDescription}
                    onChange={(e) => setRoomDescription(e.target.value)}
                    maxLength={500}
                    size="md"
                    minRows={2}
                    maxRows={4}
                    autosize
                    autoFocus
                  />
                </div>
              )}

              <div>
                <Text size="sm" fw={500} mb={6}>
                  Room Picture (optional)
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
                      <div className={styles.coverButtonRow}>
                        <FileButton
                          onChange={handleCoverPhotoChange}
                          accept="image/jpeg,image/png,image/webp"
                        >
                          {(props) => (
                            <Button
                              {...props}
                              variant="default"
                              size="sm"
                              leftSection={<IconPhoto size={16} />}
                              className={styles.uploadBtn}
                            >
                              {coverPreview ? "Change picture" : "Upload picture"}
                            </Button>
                          )}
                        </FileButton>
                        {coverPreview && (
                          <Button
                            variant="subtle"
                            color="red"
                            size="sm"
                            onClick={handleClearAvatar}
                            className={styles.removeCoverBtn}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <Text size="xs" c="dimmed">
                        {coverPhotoFile ? coverPhotoFile.name : "Recommended: JPG, PNG, or WebP (less than 1MB)"}
                      </Text>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.settingCard}>
                <div className={styles.settingMeta}>
                  <span className={styles.settingLabel}>Keep room permanent</span>
                  <span className={styles.settingDescription}>
                    Keep this room open indefinitely without automatic expiration.
                  </span>
                </div>
                <Switch
                  checked={isPermanent}
                  onChange={(e) => setIsPermanent(e.currentTarget.checked)}
                  size="md"
                  color="violet"
                  withThumbIndicator={false}
                  aria-label="Keep room permanent"
                />
              </div>

              {!isPermanent && (
                <div className={styles.settingCard}>
                  <div className={styles.settingMeta}>
                    <span className={styles.settingLabel}>Session duration</span>
                    <span className={styles.settingDescription}>
                      Choose how long this temporary watch room remains active before closing (max 6 hours).
                    </span>
                  </div>
                  <Select
                    value={durationHours}
                    onChange={(val) => {
                      if (val) {
                        setDurationHours(val);
                      }
                    }}
                    leftSection={<IconClock size={16} />}
                    data={DURATION_OPTIONS}
                    size="sm"
                    styles={{
                      root: { minWidth: 190, maxWidth: 220 },
                      input: { fontWeight: 500 },
                    }}
                    aria-label="Select session duration"
                  />
                </div>
              )}
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
                  description="Friends enter this passcode to join (strictly 8 characters, must be unique)"
                  placeholder="8-character passcode"
                  value={passcode}
                  required
                  withAsterisk
                  minLength={8}
                  maxLength={8}
                  error={passcodeError || undefined}
                  onChange={(e) => {
                    setPasscode(e.target.value.slice(0, 8));
                    if (error) setError("");
                  }}
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
                  Choose who can control videos and text chat.
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
                  withThumbIndicator={false}
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
                  withThumbIndicator={false}
                  aria-label="Turn off chat"
                />
              </div>
            </div>
          </div>

          {/* Sticky Actions Bar - Always accessible while scrolling */}
          <div className={styles.actionsRow}>
            <div className={styles.actionsRowMeta}>
              <Text size="xs" c="dimmed">
                Room settings can be adjusted in My Rooms when no session is active.
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
                Create Room
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
