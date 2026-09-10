import React, { useState, useRef, useEffect } from "react";
import { useHistory } from "react-router-dom";
import {
  Badge,
  Button,
  ActionIcon,
  Menu,
  Modal,
  TextInput,
  Textarea,
  Switch,
  PasswordInput,
  Divider,
  Group,
  Stack,
  Text,
  Box,
  FileButton,
  Tooltip,
  Alert,
} from "@mantine/core";
import editModalStyles from "./EditRoomModal.module.css";
import {
  IconTrash,
  IconCopy,
  IconPlayerPlayFilled,
  IconSettings,
  IconLock,
  IconLockOpen,
  IconMessage,
  IconPhotoPlus,
  IconDots,
  IconPlayerStop,
  IconHourglassHigh,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconAlertTriangle,
  IconKey,
  IconInfoCircle,
  IconUserPlus,
} from "@tabler/icons-react";
import { InviteModal } from "../Modal/InviteModal";
import { type RoomSummary } from "./MyRooms";
import {
  getRoomUrl,
  serverPath,
} from "../../utils/utils";
import { supabase, getAccessToken } from "../../utils/supabaseClient";
import styles from "./MyRooms.module.css";

// --- Pure Helpers ---

const getComputedState = (room: RoomSummary) => {
  const isPermanent = Boolean(room.isPermanent);
  if (room.status === 'expired') return 'Expired';
  if (room.status === 'ended') return 'Ended';
  if (room.status === 'active' && isPermanent) return 'Permanent';
  if (room.status === 'active') return 'Active';
  if (room.status === 'expiring') return 'Expiring';
  return 'Inactive';
};

const RoomStatusBadge = ({ status, isPermanent }: { status: RoomSummary["status"], isPermanent: boolean }) => {
  const badgeStyle = { fontWeight: 700, letterSpacing: '0.04em', backdropFilter: 'blur(8px)' };
  if (status === "active" && isPermanent) return <Badge color="green" variant="filled" size="sm" radius="xl" style={badgeStyle}>● PERMANENT</Badge>;
  if (status === "active") return <Badge color="green" variant="filled" size="sm" radius="xl" style={badgeStyle}>● ACTIVE</Badge>;
  if (status === "expiring") return <Badge color="orange" variant="filled" size="sm" radius="xl" style={badgeStyle}>● EXPIRING SOON</Badge>;
  if (status === "expired" || status === "ended") return <Badge color="gray" variant="filled" size="sm" radius="xl" style={badgeStyle}>● ENDED</Badge>;
  if (status === "scheduled") return <Badge color="blue" variant="filled" size="sm" radius="xl" style={badgeStyle}>● SCHEDULED</Badge>;
  return <Badge color="yellow" variant="filled" size="sm" radius="xl" style={badgeStyle}>● INACTIVE</Badge>;
};

const formatTimeLeft = (expiresAt: string | null, status: string, isPermanent: boolean) => {
  if (status === "expired" || status === "ended") return <div className={styles.lifecycleText}>Room is no longer active</div>;
  if (isPermanent) return <div className={styles.lifecycleText}>Permanent</div>;
  if (status !== "active" && status !== "expiring") return <div className={styles.lifecycleText}>Reactivates when someone joins</div>;

  if (!expiresAt) return null;

  const now = Date.now();
  const diff = new Date(expiresAt).getTime() - now;

  if (diff <= 0) return <div className={styles.lifecycleText}>Expired</div>;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (status === "expiring") {
    return (
      <div className={styles.expiringText}>
        <IconHourglassHigh size={14} />
        {minutes}m remaining
      </div>
    );
  }

  return (
    <div className={styles.lifecycleText}>
      Expires in {hours > 0 ? `${hours}h ` : ''}{minutes}m
    </div>
  );
};

// --- Shared Edit Modal ---
export const EditRoomModal = ({
  room,
  opened,
  onClose,
  onSuccess,
}: {
  room: RoomSummary;
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const cleanId = room.roomId.startsWith("/") ? room.roomId.substring(1) : room.roomId;
  const initialPasscode = room.currentPasscode || "";

  const [title, setTitle] = useState(room.roomTitle || "");
  const [description, setDescription] = useState(room.roomDescription || "");
  const [isPermanent, setIsPermanent] = useState(Boolean(room.isPermanent));
  const [isChatDisabled, setIsChatDisabled] = useState(room.isChatDisabled || false);

  // Password management
  const [currentPassword, setCurrentPassword] = useState(initialPasscode);
  const [showCurrentPassword, setShowCurrentPassword] = useState(true);
  const [copiedCurrentPassword, setCopiedCurrentPassword] = useState(false);
  const [removeProtection, setRemoveProtection] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(room.coverPhoto || null);
  const [removeCover, setRemoveCover] = useState(false);

  useEffect(() => {
    if (opened) {
      const saved = room.currentPasscode || "";
      setCurrentPassword(saved);
      setShowCurrentPassword(true);
      setCopiedCurrentPassword(false);
      setRemoveProtection(false);
      setPassword("");
      setPasswordConfirm("");
      setError("");
      setTitle(room.roomTitle || "");
      setDescription(room.roomDescription || "");
      setIsPermanent(Boolean(room.isPermanent));
      setIsChatDisabled(room.isChatDisabled || false);
      setCoverPreview(room.coverPhoto || null);
      setCoverFile(null);
      setRemoveCover(false);
    }
  }, [opened, room, cleanId]);

  const handleCopyCurrentPassword = () => {
    if (!currentPassword) return;
    navigator.clipboard.writeText(currentPassword);
    setCopiedCurrentPassword(true);
    setTimeout(() => setCopiedCurrentPassword(false), 2000);
  };

  const handleFileChange = (payload: File | null) => {
    if (payload) {
      if (payload.size > 5 * 1024 * 1024) {
        setError("Cover photo too large (max 5MB).");
        return;
      }
      setRemoveCover(false);
      setCoverFile(payload);
      setCoverPreview(URL.createObjectURL(payload));
    }
  };

  const isRoomActive = room.status === "active";

  const handleSave = async () => {
    setError("");
    if (isRoomActive) {
      setError("Cannot modify room details while the room is active. Please end the watch session or wait until all participants leave.");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Room title is required.");
      return;
    }
    if (trimmedTitle.length > 50) {
      setError("Room title must be under 50 characters.");
      return;
    }
    if (description.length > 500) {
      setError("Description must be under 500 characters.");
      return;
    }
    if (!removeProtection && password && password !== passwordConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const token = await getAccessToken();
      if (!user) throw new Error("Not logged in");

      let finalCoverUrl = room.coverPhoto;

      if (coverFile) {
        const fileExt = coverFile.name.split('.').pop();
        const safeRoomId = room.roomId.startsWith("/") ? room.roomId.substring(1) : room.roomId;
        const filePath = `${user.id}/${safeRoomId}/cover.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('room_covers')
          .upload(filePath, coverFile, { upsert: true });

        if (uploadError) {
          throw uploadError;
        }

        const { data: publicUrlData } = supabase.storage.from('room_covers').getPublicUrl(filePath);
        finalCoverUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      }

      const payloadPassword = removeProtection ? "" : (password ? password.trim() : undefined);

      const response = await fetch(`${serverPath}/updateRoomSettings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.id,
          token,
          roomId: room.roomId,
          roomTitle: trimmedTitle,
          roomDescription: description,
          isPermanent,
          isChatDisabled,
          removePassword: removeProtection,
          password: payloadPassword,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to save room settings");

      if (removeProtection) {
        setCurrentPassword("");
      } else if (password) {
        setCurrentPassword(password.trim());
      }

      if (removeCover) {
        await fetch(`${serverPath}/updateRoomCover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: user.id, token, roomId: room.roomId, coverPhoto: null }),
        });
      } else if (coverFile && finalCoverUrl && finalCoverUrl !== room.coverPhoto) {
        await fetch(`${serverPath}/updateRoomCover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: user.id, token, roomId: room.roomId, coverPhoto: finalCoverUrl }),
        });
      }

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to update room settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const displayCover = removeCover ? null : coverPreview;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      className={editModalStyles.modalRoot}
      title={
        <div className={editModalStyles.modalHeader}>
          <div className={editModalStyles.headerIconBadge}>
            <IconSettings size={22} stroke={1.8} />
          </div>
          <div className={editModalStyles.headerMeta}>
            <span className={editModalStyles.headerTitle}>Edit Room</span>
            <span className={editModalStyles.headerSubtitle}>
              Update room identity, cover photo, behavior, and security
            </span>
          </div>
        </div>
      }
    >
      <div className={editModalStyles.modalBodyContent}>
        {isRoomActive && (
          <Alert
            color="yellow"
            variant="light"
            icon={<IconAlertTriangle size={18} />}
            title="Room is Currently Active"
          >
            Room details (title, description, cover photo, behavior, and passcode) cannot be changed while a watch session is actively running. Please end the session or wait until all participants leave before editing.
          </Alert>
        )}

        {error && (
          <Alert color="red" variant="light" title="Unable to save changes">
            {error}
          </Alert>
        )}

        {/* SECTION 1: IDENTITY */}
        <div className={editModalStyles.section}>
          <div className={editModalStyles.sectionHeader}>
            <span className={editModalStyles.sectionTitle}>Room Identity</span>
          </div>
          <Stack gap="md">
            <TextInput
              label="Room Title"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              maxLength={50}
              required
              disabled={isRoomActive || isSaving}
              description={`${title.length}/50 characters`}
            />
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              maxLength={500}
              autosize
              minRows={2}
              disabled={isRoomActive || isSaving}
              description={`${description.length}/500 characters`}
            />

            <div>
              <Text size="sm" fw={500} mb={6}>Cover Photo</Text>
              <div className={editModalStyles.coverContainer}>
                <div className={editModalStyles.coverPreview}>
                  {displayCover ? (
                    <img src={displayCover} className={editModalStyles.coverImg} alt="Cover Preview" />
                  ) : (
                    <span className={editModalStyles.coverPlaceholder}>No cover</span>
                  )}
                </div>
                <div className={editModalStyles.coverActions}>
                  <Group gap="xs">
                    <FileButton onChange={handleFileChange} accept="image/png,image/jpeg,image/webp" disabled={isRoomActive || isSaving}>
                      {(props) => (
                        <Button variant="default" size="xs" disabled={isRoomActive || isSaving} {...props}>
                          Change cover
                        </Button>
                      )}
                    </FileButton>
                    {displayCover && (
                      <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        disabled={isRoomActive || isSaving}
                        onClick={() => {
                          setCoverFile(null);
                          setCoverPreview(null);
                          setRemoveCover(true);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    JPG, PNG, or WEBP (max 5MB). 16:9 recommended.
                  </Text>
                </div>
              </div>
            </div>
          </Stack>
        </div>

        <Divider />

        {/* SECTION 2: BEHAVIOR */}
        <div className={editModalStyles.section}>
          <div className={editModalStyles.sectionHeader}>
            <span className={editModalStyles.sectionTitle}>Room Behavior</span>
          </div>
          <Stack gap="sm">
            <div className={editModalStyles.settingCard}>
              <div className={editModalStyles.settingMeta}>
                <span className={editModalStyles.settingLabel}>Permanent Room</span>
                <span className={editModalStyles.settingDescription}>
                  Keep this room active indefinitely without automatic expiration.
                </span>
              </div>
              <Switch
                checked={isPermanent}
                onChange={(e) => setIsPermanent(e.currentTarget.checked)}
                color="violet"
                size="md"
                disabled={isRoomActive || isSaving}
              />
            </div>

            <div className={editModalStyles.settingCard}>
              <div className={editModalStyles.settingMeta}>
                <span className={editModalStyles.settingLabel}>Chat Enabled</span>
                <span className={editModalStyles.settingDescription}>
                  Allow room participants to exchange real-time messages and reactions.
                </span>
              </div>
              <Switch
                checked={!isChatDisabled}
                onChange={(e) => setIsChatDisabled(!e.currentTarget.checked)}
                color="violet"
                size="md"
                disabled={isRoomActive || isSaving}
              />
            </div>
          </Stack>
        </div>

        <Divider />

        {/* SECTION 3: ACCESS & SECURITY */}
        <div className={editModalStyles.section}>
          <div className={editModalStyles.sectionHeader}>
            <span className={editModalStyles.sectionTitle}>Access & Security</span>
            {room.isPasscodeProtected && !removeProtection ? (
              <Badge color="violet" variant="light" leftSection={<IconLock size={12} />}>
                Protected
              </Badge>
            ) : removeProtection ? (
              <Badge color="red" variant="light" leftSection={<IconLockOpen size={12} />}>
                Will Be Removed
              </Badge>
            ) : (
              <Badge color="gray" variant="light" leftSection={<IconLockOpen size={12} />}>
                Unprotected
              </Badge>
            )}
          </div>

          <Stack gap="md">
            {room.isPasscodeProtected && (
              <div className={editModalStyles.passwordBox}>
                {currentPassword ? (
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                        Current Passcode
                      </Text>
                      <Button
                        variant="subtle"
                        color={removeProtection ? "violet" : "red"}
                        size="xs"
                        disabled={isRoomActive || isSaving}
                        onClick={() => {
                          setRemoveProtection(!removeProtection);
                          if (!removeProtection) {
                            setPassword("");
                            setPasswordConfirm("");
                          }
                        }}
                      >
                        {removeProtection ? "Keep Password Protection" : "Remove Password"}
                      </Button>
                    </Group>
                    <TextInput
                      readOnly
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      rightSection={
                        <Group gap={4} pr={6}>
                          <Tooltip label={showCurrentPassword ? "Hide passcode" : "Show passcode"} withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                              aria-label="Toggle password visibility"
                            >
                              {showCurrentPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={copiedCurrentPassword ? "Copied!" : "Copy passcode"} withArrow>
                            <ActionIcon
                              variant="subtle"
                              color={copiedCurrentPassword ? "green" : "gray"}
                              size="sm"
                              onClick={handleCopyCurrentPassword}
                              aria-label="Copy current password"
                            >
                              {copiedCurrentPassword ? <IconCheck size={16} /> : <IconCopy size={16} />}
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
                  </Stack>
                ) : (
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Group gap={6}>
                        <IconLock size={16} color="var(--mantine-color-violet-6)" />
                        <Text size="sm" fw={500}>Room is passcode protected</Text>
                      </Group>
                      <Button
                        variant="subtle"
                        color={removeProtection ? "violet" : "red"}
                        size="xs"
                        disabled={isRoomActive || isSaving}
                        onClick={() => {
                          setRemoveProtection(!removeProtection);
                          if (!removeProtection) {
                            setPassword("");
                            setPasswordConfirm("");
                          }
                        }}
                      >
                        {removeProtection ? "Keep Protection" : "Remove Password"}
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {removeProtection
                        ? "Password protection will be removed when you save changes."
                        : "Passcode is securely encrypted. Enter a new password below to update and view it, or click Remove Password to disable protection."}
                    </Text>
                  </Stack>
                )}
              </div>
            )}

            {removeProtection ? (
              <Text size="sm" c="red" fw={500}>
                Password protection will be removed when you click Save Changes.
              </Text>
            ) : (
              <Stack gap="sm">
                <Text size="xs" c="dimmed">
                  {room.isPasscodeProtected
                    ? "Enter a new password to change or update protection. Leave blank to keep current settings."
                    : "Enter a password to require guests to enter a passcode before joining. Leave blank for an open room."}
                </Text>
                <PasswordInput
                  label={room.isPasscodeProtected ? "New password" : "Set password"}
                  placeholder={room.isPasscodeProtected ? "Leave blank to keep current" : "Enter password (optional)"}
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  disabled={isRoomActive || isSaving}
                />
                {password.length > 0 && (
                  <PasswordInput
                    label="Confirm password"
                    placeholder="Confirm new password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.currentTarget.value)}
                    disabled={isRoomActive || isSaving}
                  />
                )}
              </Stack>
            )}
          </Stack>
        </div>
      </div>

      {/* FIXED STICKY FOOTER */}
      <div className={editModalStyles.modalFooter}>
        <Button variant="default" onClick={onClose} disabled={isSaving}>
          {isRoomActive ? "Close" : "Cancel"}
        </Button>
        <Button color="violet" onClick={handleSave} loading={isSaving} disabled={isSaving || isRoomActive}>
          Save Changes
        </Button>
      </div>
    </Modal>
  );
};

// --- Delete Confirmation Modal ---
interface DeleteConfirmModalProps {
  room: RoomSummary;
  opened: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

const DeleteConfirmModal = ({
  room,
  opened,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteConfirmModalProps) => {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconAlertTriangle size={18} color="var(--mantine-color-red-6)" />
          <Text fw={600} size="md">Delete Room</Text>
        </Group>
      }
      centered
      radius="md"
      size="sm"
    >
      <Stack gap="md">
        <Text size="sm">
          Are you sure you want to delete <Text span fw={600}>"{room.roomTitle || room.roomId}"</Text>?
        </Text>
        <Text size="xs" c="dimmed">
          This will permanently delete the room and its settings. This action cannot be undone.
        </Text>
        <Group justify="flex-end" mt="md" gap="sm">
          <Button variant="default" onClick={onClose} disabled={isDeleting} size="sm">
            Cancel
          </Button>
          <Button
            color="red"
            onClick={onConfirm}
            loading={isDeleting}
            size="sm"
            leftSection={<IconTrash size={15} />}
          >
            Delete Room
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

// --- Shared Action Hook ---
const useRoomActions = (room: RoomSummary, onDelete: (id: string) => void, onRefresh?: () => void, onUpdateCover?: (id: string, url: string) => void) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [inviteModalOpened, setInviteModalOpened] = useState(false);
  const [stopModalOpened, setStopModalOpened] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [infoModalAction, setInfoModalAction] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const history = useHistory();

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(getRoomUrl(room.roomId)).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }).catch(console.error);
  };

  const handleCopyPasscode = () => {
    if (!room.currentPasscode) return;
    navigator.clipboard.writeText(room.currentPasscode).then(() => {
      setCopiedPasscode(true);
      setTimeout(() => setCopiedPasscode(false), 2000);
    }).catch(console.error);
  };

  const handleCopy = handleCopyUrl;

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(room.roomId);
      setDeleteModalOpened(false);
    } catch (e) {
      console.error("Failed to delete room:", e);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStopSession = async () => {
    setIsStopping(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const token = await getAccessToken();
      if (!user) throw new Error("Not logged in");

      const response = await fetch(`${serverPath}/endRoom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: user.id,
          token,
          roomId: room.roomId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to stop room session");
      }

      setStopModalOpened(false);
      if (onRefresh) {
        onRefresh();
      } else {
        window.location.reload();
      }
    } catch (e: any) {
      console.error("Error stopping room session:", e);
    } finally {
      setIsStopping(false);
    }
  };

  const handlePlaceholder = (action: string) => {
    setInfoModalAction(action);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onUpdateCover) return;

    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");
      if (file.size > 5 * 1024 * 1024) throw new Error("Cover photo too large (max 5MB).");

      const fileExt = file.name.split('.').pop();
      const safeRoomId = room.roomId.startsWith("/") ? room.roomId.substring(1) : room.roomId;
      const filePath = `${user.id}/${safeRoomId}/cover.${fileExt}`;

      const { error: uploadError } = await supabase.storage.from('room_covers').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('room_covers').getPublicUrl(filePath);
      onUpdateCover(room.roomId, `${publicUrlData.publicUrl}?t=${Date.now()}`);
    } catch (e: any) {
      console.error("Failed to upload cover", e);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const computedState = getComputedState(room);
  const isPermanent = computedState === 'Permanent';
  const urlPath = `/watch/${room.roomId.replace(/^\//, '')}`;
  const detailsPath = `/rooms/${room.roomId}`;

  const renderPrimary = () => {
    if (computedState === 'Expired' || computedState === 'Ended') {
      return (
        <Button
          size="xs"
          className={styles.secondaryBtn}
          onClick={() => history.push(detailsPath)}
        >
          Details
        </Button>
      );
    }
    if (computedState === 'Inactive') {
      return (
        <Button
          size="xs"
          className={styles.primaryBtn}
          onClick={() => history.push(urlPath)}
          leftSection={<IconPlayerPlayFilled size={12} />}
        >
          Start Session
        </Button>
      );
    }
    return (
      <Button
        size="xs"
        className={styles.primaryBtn}
        onClick={() => history.push(urlPath)}
        leftSection={<IconPlayerPlayFilled size={12} />}
      >
        Open Room
      </Button>
    );
  };

  const renderSecondary = () => {
    if (computedState === 'Expired' || computedState === 'Ended') return null;
    return (
      <Button
        size="xs"
        className={styles.secondaryBtn}
        onClick={() => history.push(detailsPath)}
      >
        Details
      </Button>
    );
  };

  const renderMenuItems = () => {
    const items = [];

    if (room.currentPasscode) {
      items.push(
        <Menu.Item
          key="copyPasscode"
          leftSection={<IconKey size={14} />}
          onClick={handleCopyPasscode}
        >
          Copy Passcode ({room.currentPasscode})
        </Menu.Item>
      );
    }

    items.push(
      <Menu.Item
        key="details"
        leftSection={<IconInfoCircle size={14} />}
        onClick={() => history.push(detailsPath)}
      >
        Room Details
      </Menu.Item>
    );

    if (computedState !== 'Expired' && computedState !== 'Ended') {
      if (room.currentPasscode) {
        items.push(<Menu.Divider key="div1" />);
      }
      if (computedState === 'Active' && !isPermanent) {
        items.push(
          <Menu.Item key="extend30" leftSection={<IconHourglassHigh size={14} />} onClick={() => handlePlaceholder('Extend +30 min')}>
            Extend +30 min
          </Menu.Item>
        );
        items.push(
          <Menu.Item key="extend60" leftSection={<IconHourglassHigh size={14} />} onClick={() => handlePlaceholder('Extend +1 hour')}>
            Extend +1 hour
          </Menu.Item>
        );
      }
      items.push(
        <Tooltip
          key="settings"
          label="Cannot edit room details while session is active"
          disabled={room.status !== "active"}
          withArrow
        >
          <Menu.Item
            leftSection={<IconSettings size={14} />}
            disabled={room.status === "active"}
            onClick={() => setEditModalOpened(true)}
          >
            {room.status === "active" ? "Edit Room (Active)" : "Edit Room"}
          </Menu.Item>
        </Tooltip>
      );
      items.push(
        <Tooltip
          key="end"
          label={room.status === "active" ? "Stop current watch session" : "No active session to stop"}
          disabled={room.status === "active"}
          withArrow
        >
          <Menu.Item
            leftSection={<IconPlayerStop size={14} />}
            disabled={room.status !== "active"}
            onClick={() => setStopModalOpened(true)}
          >
            {room.status === "active" ? "Stop Session" : "Stop Session (Inactive)"}
          </Menu.Item>
        </Tooltip>
      );
    }

    items.push(<Menu.Divider key="div2" />);
    items.push(
      <Tooltip
        key="delete"
        label="Active rooms cannot be deleted. Stop the session first."
        disabled={room.status !== "active"}
        withArrow
      >
        <Menu.Item
          color={room.status === "active" ? undefined : "red"}
          leftSection={<IconTrash size={14} />}
          disabled={room.status === "active"}
          onClick={() => setDeleteModalOpened(true)}
        >
          {room.status === "active" ? "Delete Room (Active)" : "Delete Room"}
        </Menu.Item>
      </Tooltip>
    );
    return items;
  };

  return {
    isUploading,
    isDeleting,
    isStopping,
    fileInputRef,
    handleFileUpload,
    renderPrimary,
    renderSecondary,
    renderMenuItems,
    editModalOpened,
    setEditModalOpened,
    deleteModalOpened,
    setDeleteModalOpened,
    inviteModalOpened,
    setInviteModalOpened,
    stopModalOpened,
    setStopModalOpened,
    handleConfirmDelete,
    handleStopSession,
    copiedUrl,
    handleCopyUrl,
    copiedPasscode,
    handleCopyPasscode,
    infoModalAction,
    setInfoModalAction,
    handlePlaceholder,
    computedState,
    isPermanent,
    detailsPath,
    urlPath,
  };
};

const StopRoomConfirmModal = ({
  room,
  opened,
  onClose,
  onConfirm,
  isStopping,
}: {
  room: RoomSummary;
  opened: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isStopping: boolean;
}) => {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconPlayerStop size={18} color="var(--mantine-color-orange-6)" />
          <Text fw={600} size="md">Stop Watch Session</Text>
        </Group>
      }
      centered
      radius="md"
      size="sm"
    >
      <Stack gap="md">
        <Text size="sm">
          Are you sure you want to stop the current watch session for <Text span fw={600}>"{room.roomTitle || room.roomId}"</Text>?
        </Text>
        <Text size="xs" c="dimmed">
          This will stop the running session and disconnect active viewers. The room will remain saved and will be set to Inactive, so you can start a new session whenever you or your friends join again.
        </Text>
        <Group justify="flex-end" mt="md" gap="sm">
          <Button variant="default" onClick={onClose} disabled={isStopping} size="sm">
            Cancel
          </Button>
          <Button
            color="orange"
            onClick={onConfirm}
            loading={isStopping}
            size="sm"
            leftSection={<IconPlayerStop size={15} />}
          >
            Stop Session
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};


const InfoActionModal = ({
  action,
  detailsPath,
  onClose,
}: {
  action: string | null;
  detailsPath: string;
  onClose: () => void;
}) => {
  const history = useHistory();
  return (
    <Modal
      opened={Boolean(action)}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconInfoCircle size={18} color="var(--mantine-color-violet-6)" />
          <Text fw={600} size="md">{action}</Text>
        </Group>
      }
      centered
      radius="md"
      size="sm"
    >
      <Stack gap="md">
        <Text size="sm">
          {action} is available from the Room Details page.
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            color="violet"
            size="sm"
            onClick={() => {
              onClose();
              history.push(detailsPath);
            }}
          >
            Go to Details
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};


// --- View Components ---

const GridRoomCard = ({ room, onDelete, onUpdateCover }: { room: RoomSummary, onDelete: (id: string) => void, onUpdateCover?: (id: string, url: string) => void }) => {
  const actions = useRoomActions(room, onDelete, undefined, onUpdateCover);
  const isPermanent = Boolean(room.isPermanent);
  const creationDate = new Date(room.creationTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const history = useHistory();

  return (
    <div className={styles.gridCard}>
      <div className={styles.gridCardCover}>
        {room.coverPhoto ? (
          <img src={room.coverPhoto} alt="Room Cover" className={styles.cover} />
        ) : (
          <div className={styles.coverPlaceholder}>WATCH PARTY</div>
        )}
        <div className={styles.coverOverlay} />

        <div className={styles.statusBadgeContainer}>
          <RoomStatusBadge status={room.status} isPermanent={isPermanent} />
        </div>

        {onUpdateCover && (
          <>
            <ActionIcon
              variant="filled" color="dark" size="sm" radius="xl" loading={actions.isUploading}
              className={styles.updateCoverBtn}
              onClick={(e) => { e.stopPropagation(); actions.fileInputRef.current?.click(); }}
              aria-label="Update cover image"
            >
              <IconPhotoPlus size={14} color="white" />
            </ActionIcon>
            <input type="file" accept="image/*" ref={actions.fileInputRef} style={{ display: 'none' }} onChange={actions.handleFileUpload} />
          </>
        )}
      </div>

      <div className={styles.gridCardBody}>
        <h3
          className={styles.roomTitle}
          title={room.roomTitle || "Watch Party Room"}
          onClick={() => history.push(actions.detailsPath)}
          style={{ cursor: 'pointer' }}
        >
          {room.roomTitle || "Watch Party Room"}
        </h3>
        <div className={styles.roomDescription}>
          {room.roomDescription || "No description provided."}
        </div>

        <div className={styles.roomMetadata}>
          <div className={styles.metaItemValue}>
            {room.isPasscodeProtected ? (
              <>
                <IconLock size={13} />
                {room.currentPasscode ? (
                  <span>Pass: <strong style={{ letterSpacing: '0.5px' }}>{room.currentPasscode}</strong></span>
                ) : (
                  'Protected'
                )}
              </>
            ) : (
              <>
                <IconLockOpen size={13} />
                Public
              </>
            )}
          </div>
          <div className={styles.metaItemValue}>
            <IconMessage size={13} />
            {room.isChatDisabled ? 'Chat off' : 'Chat'}
          </div>
          <div className={styles.metaItemValue}>{creationDate}</div>
        </div>

        <div className={styles.roomLifecycle}>
          {formatTimeLeft(room.expiresAt, room.status, isPermanent)}
        </div>
      </div>

      <div className={styles.roomActionsBar}>
        <div className={styles.primaryActionWrap}>
          {actions.renderPrimary()}
        </div>
        <div className={styles.cardActionsRow}>
          {actions.renderSecondary()}
          <Tooltip label="Invite Friends" withArrow>
            <ActionIcon
              className={styles.actionIconBtn}
              size="sm"
              radius="xl"
              onClick={() => actions.setInviteModalOpened(true)}
              aria-label="Invite Friends"
            >
              <IconUserPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Menu shadow="md" width={220} position="bottom-end">
            <Menu.Target>
              <ActionIcon className={styles.moreBtn} size="sm" radius="md">
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {actions.renderMenuItems()}
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      <EditRoomModal
        room={room}
        opened={actions.editModalOpened}
        onClose={() => actions.setEditModalOpened(false)}
        onSuccess={() => window.location.reload()}
      />

      <DeleteConfirmModal
        room={room}
        opened={actions.deleteModalOpened}
        onClose={() => actions.setDeleteModalOpened(false)}
        onConfirm={actions.handleConfirmDelete}
        isDeleting={actions.isDeleting}
      />

      <StopRoomConfirmModal
        room={room}
        opened={actions.stopModalOpened}
        onClose={() => actions.setStopModalOpened(false)}
        onConfirm={actions.handleStopSession}
        isStopping={actions.isStopping}
      />

      <InfoActionModal
        action={actions.infoModalAction}
        detailsPath={actions.detailsPath}
        onClose={() => actions.setInfoModalAction(null)}
      />

      {actions.inviteModalOpened && (
        <InviteModal
          roomId={room.roomId}
          passcode={room.currentPasscode || undefined}
          closeInviteModal={() => actions.setInviteModalOpened(false)}
        />
      )}
    </div>
  );

};

const StackRoomCard = ({ room, onDelete, onUpdateCover }: { room: RoomSummary, onDelete: (id: string) => void, onUpdateCover?: (id: string, url: string) => void }) => {
  const actions = useRoomActions(room, onDelete, undefined, onUpdateCover);
  const isPermanent = Boolean(room.isPermanent);
  const creationDate = new Date(room.creationTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const isRoomActive = room.status === "active";

  return (
    <div className={styles.stackCard}>
      <div className={styles.stackCardCover}>
        {room.coverPhoto ? (
          <img src={room.coverPhoto} alt="Room Cover" className={styles.cover} />
        ) : (
          <div className={styles.coverPlaceholder}>WATCH PARTY</div>
        )}
        <div className={styles.coverOverlay} />

        {onUpdateCover && (
          <>
            <ActionIcon
              variant="filled" color="dark" size="sm" radius="xl" loading={actions.isUploading}
              style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
              onClick={(e) => { e.stopPropagation(); actions.fileInputRef.current?.click(); }}
              aria-label="Update cover image"
            >
              <IconPhotoPlus size={14} color="white" />
            </ActionIcon>
            <input type="file" accept="image/*" ref={actions.fileInputRef} style={{ display: 'none' }} onChange={actions.handleFileUpload} />
          </>
        )}
      </div>

      <div className={styles.stackCardContent}>
        <div className={styles.stackCardHeader}>
          <div className={styles.stackCardTitleBox}>
            <h3 className={styles.stackRoomTitle} title={room.roomTitle || "Watch Party Room"}>
              {room.roomTitle || "Watch Party Room"}
            </h3>
            <div className={styles.stackRoomDescription}>
              {room.roomDescription || "No description provided."}
            </div>
          </div>

          <div className={styles.stackCardLifecycleBox}>
            <RoomStatusBadge status={room.status} isPermanent={isPermanent} />
            {formatTimeLeft(room.expiresAt, room.status, isPermanent)}
          </div>
        </div>

        <div className={styles.stackCardBottom}>
          <div className={styles.stackMetadata}>
            {room.isPasscodeProtected ? (
              <Tooltip
                label={
                  actions.copiedPasscode
                    ? "Passcode Copied!"
                    : room.currentPasscode
                      ? `Click to copy passcode (${room.currentPasscode})`
                      : "Passcode protected"
                }
                withArrow
              >
                <div
                  className={`${styles.metaItemValue} ${room.currentPasscode ? styles.metaItemClickable : ""}`}
                  onClick={room.currentPasscode ? actions.handleCopyPasscode : undefined}
                >
                  <IconLock size={14} />
                  {room.currentPasscode ? (
                    <span>
                      Passcode: <strong style={{ letterSpacing: '0.5px' }}>{room.currentPasscode}</strong>
                    </span>
                  ) : (
                    "Protected"
                  )}
                  {room.currentPasscode && (
                    actions.copiedPasscode ? (
                      <IconCheck size={13} color="var(--mantine-color-teal-5)" />
                    ) : (
                      <IconCopy size={13} style={{ opacity: 0.7 }} />
                    )
                  )}
                </div>
              </Tooltip>
            ) : (
              <div className={styles.metaItemValue}>
                <IconLockOpen size={14} /> Public
              </div>
            )}
            <div className={styles.metaItemValue}>
              <IconMessage size={14} /> {room.isChatDisabled ? 'Chat disabled' : 'Chat enabled'}
            </div>
            <div className={styles.metaItemValue}>
              Created {creationDate}
            </div>
          </div>

          <div className={styles.actionButtons}>
            {actions.renderPrimary()}
            {actions.renderSecondary()}

            <Tooltip
              label="Cannot edit room details while session is active"
              disabled={!isRoomActive}
              withArrow
            >
              <Button
                size="xs"
                className={styles.secondaryBtn}
                leftSection={<IconSettings size={14} />}
                disabled={isRoomActive}
                onClick={() => actions.setEditModalOpened(true)}
              >
                Edit
              </Button>
            </Tooltip>

            <Tooltip label="Invite Friends" withArrow>
              <ActionIcon
                className={styles.actionIconBtn}
                size="sm"
                radius="xl"
                onClick={() => actions.setInviteModalOpened(true)}
                aria-label="Invite Friends"
              >
                <IconUserPlus size={15} />
              </ActionIcon>
            </Tooltip>

            {room.currentPasscode && (
              <Tooltip
                label={actions.copiedPasscode ? "Passcode Copied!" : `Copy Passcode (${room.currentPasscode})`}
                withArrow
              >
                <ActionIcon
                  className={styles.actionIconBtn}
                  size="sm"
                  radius="xl"
                  onClick={actions.handleCopyPasscode}
                  aria-label="Copy Passcode"
                >
                  {actions.copiedPasscode ? (
                    <IconCheck size={15} color="var(--mantine-color-teal-5)" />
                  ) : (
                    <IconKey size={15} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}

            {isRoomActive && !isPermanent && (
              <Tooltip label="Extend +30 min" withArrow>
                <ActionIcon
                  className={styles.actionIconBtn}
                  size="sm"
                  radius="xl"
                  onClick={() => actions.handlePlaceholder("Extend +30 min")}
                  aria-label="Extend Room"
                >
                  <IconHourglassHigh size={15} />
                </ActionIcon>
              </Tooltip>
            )}

            {room.status !== "expired" && room.status !== "ended" && (
              <Tooltip
                label={
                  isRoomActive
                    ? "Stop current session (room remains saved as Inactive)"
                    : "No active session running (room is Inactive)"
                }
                withArrow
              >
                <ActionIcon
                  className={styles.actionIconBtn}
                  size="sm"
                  radius="xl"
                  disabled={!isRoomActive}
                  onClick={() => actions.setStopModalOpened(true)}
                  aria-label="Stop Session"
                >
                  <IconPlayerStop size={15} />
                </ActionIcon>
              </Tooltip>
            )}

            <Tooltip
              label={isRoomActive ? "Active rooms cannot be deleted. Stop the session first." : "Delete Room"}
              withArrow
            >
              <ActionIcon
                className={isRoomActive ? styles.actionIconBtn : styles.deleteActionIconBtn}
                size="sm"
                radius="xl"
                disabled={isRoomActive}
                onClick={() => actions.setDeleteModalOpened(true)}
                aria-label="Delete Room"
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
          </div>
        </div>
      </div>

      <EditRoomModal
        room={room}
        opened={actions.editModalOpened}
        onClose={() => actions.setEditModalOpened(false)}
        onSuccess={() => window.location.reload()}
      />

      <DeleteConfirmModal
        room={room}
        opened={actions.deleteModalOpened}
        onClose={() => actions.setDeleteModalOpened(false)}
        onConfirm={actions.handleConfirmDelete}
        isDeleting={actions.isDeleting}
      />

      <StopRoomConfirmModal
        room={room}
        opened={actions.stopModalOpened}
        onClose={() => actions.setStopModalOpened(false)}
        onConfirm={actions.handleStopSession}
        isStopping={actions.isStopping}
      />

      <InfoActionModal
        action={actions.infoModalAction}
        detailsPath={actions.detailsPath}
        onClose={() => actions.setInfoModalAction(null)}
      />

      {actions.inviteModalOpened && (
        <InviteModal
          roomId={room.roomId}
          passcode={room.currentPasscode || undefined}
          closeInviteModal={() => actions.setInviteModalOpened(false)}
        />
      )}
    </div>
  );

};

// --- Main Wrapper ---

export const RoomCard = ({
  room,
  onDelete,
  onUpdateCover,
  viewMode
}: {
  room: RoomSummary;
  onDelete: (id: string) => void;
  onUpdateCover?: (id: string, url: string) => void;
  viewMode: 'grid' | 'stack';
}) => {
  if (viewMode === 'stack') {
    return <StackRoomCard room={room} onDelete={onDelete} onUpdateCover={onUpdateCover} />;
  }
  return <GridRoomCard room={room} onDelete={onDelete} onUpdateCover={onUpdateCover} />;
};
