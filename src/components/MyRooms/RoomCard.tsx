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
} from "@mantine/core";
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
} from "@tabler/icons-react";
import { type RoomSummary } from "./MyRooms";
import {
  getRoomUrl,
  serverPath,
  addAndSavePasscode,
  getSavedPasscodes,
  removeSavedPasscode,
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
  if (status === "active" && isPermanent) return <Badge color="green" variant="filled" size="sm">● PERMANENT</Badge>;
  if (status === "active") return <Badge color="green" variant="filled" size="sm">● ACTIVE</Badge>;
  if (status === "expiring") return <Badge color="orange" variant="filled" size="sm">● EXPIRING SOON</Badge>;
  if (status === "expired" || status === "ended") return <Badge color="gray" variant="filled" size="sm">● ENDED</Badge>;
  if (status === "scheduled") return <Badge color="blue" variant="filled" size="sm">● SCHEDULED</Badge>;
  return <Badge color="yellow" variant="filled" size="sm">● INACTIVE</Badge>;
};

const formatTimeLeft = (expiresAt: string | null, status: string, isPermanent: boolean) => {
  if (status === "expired" || status === "ended") return <div className={styles.lifecycleText}>Room is no longer active</div>;
  if (isPermanent) return <div className={styles.lifecycleText}>No expiration</div>;
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
  const initialPasscode =
    room.currentPasscode ||
    getSavedPasscodes()[room.roomId] ||
    getSavedPasscodes()[cleanId] ||
    getSavedPasscodes()[`/${cleanId}`] ||
    "";

  const [title, setTitle] = useState(room.roomTitle || "");
  const [description, setDescription] = useState(room.roomDescription || "");
  const [isPermanent, setIsPermanent] = useState(Boolean(room.isPermanent));
  const [isChatDisabled, setIsChatDisabled] = useState(room.isChatDisabled || false);

  // Password management
  const [currentPassword, setCurrentPassword] = useState(initialPasscode);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [copiedCurrentPassword, setCopiedCurrentPassword] = useState(false);
  const [removeProtection, setRemoveProtection] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(room.coverPhoto || null);

  useEffect(() => {
    if (opened) {
      const saved =
        room.currentPasscode ||
        getSavedPasscodes()[room.roomId] ||
        getSavedPasscodes()[cleanId] ||
        getSavedPasscodes()[`/${cleanId}`] ||
        "";
      setCurrentPassword(saved);
      setShowCurrentPassword(false);
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
      setCoverFile(payload);
      setCoverPreview(URL.createObjectURL(payload));
    }
  };

  const handleSave = async () => {
    setError("");
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
        removeSavedPasscode(room.roomId);
        setCurrentPassword("");
      } else if (password) {
        addAndSavePasscode(room.roomId, password.trim());
        setCurrentPassword(password.trim());
      }

      if (coverFile && finalCoverUrl && finalCoverUrl !== room.coverPhoto) {
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

  return (
    <Modal opened={opened} onClose={onClose} title="Edit Room" size="lg" radius="md">
      <Stack gap="xl">
        <Text size="sm" c="dimmed" mt="-md">Update how your room appears and behaves.</Text>
        {error && <Text color="red" size="sm">{error}</Text>}
        
        <Box>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={1} mb="md">Room Identity</Text>
          <Stack gap="md">
            <TextInput label="Room Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={50} required />
            <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} maxLength={500} autosize minRows={2} />
            
            <Box>
              <Text size="sm" fw={500} mb={4}>Cover Photo</Text>
              <Group align="flex-end" gap="md">
                <Box style={{ width: 160, height: 90, borderRadius: 8, overflow: 'hidden', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-subtle)', position: 'relative' }}>
                  {coverPreview ? (
                    <img src={coverPreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Cover Preview" />
                  ) : (
                    <Text size="xs" c="dimmed" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>No cover</Text>
                  )}
                </Box>
                <FileButton onChange={handleFileChange} accept="image/png,image/jpeg,image/webp">
                  {(props) => <Button variant="default" size="sm" {...props}>Change cover</Button>}
                </FileButton>
              </Group>
            </Box>
          </Stack>
        </Box>

        <Divider />

        <Box>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={1} mb="md">Room Behavior</Text>
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Box>
                <Text fw={500}>Permanent Room</Text>
                <Text size="sm" c="dimmed">No automatic expiration</Text>
              </Box>
              <Switch checked={isPermanent} onChange={(e) => setIsPermanent(e.currentTarget.checked)} color="violet" size="lg" />
            </Group>
            
            <Group justify="space-between" align="center">
              <Box>
                <Text fw={500}>Chat Enabled</Text>
              </Box>
              <Switch checked={!isChatDisabled} onChange={(e) => setIsChatDisabled(!e.currentTarget.checked)} color="violet" size="lg" />
            </Group>
          </Stack>
        </Box>

        <Divider />

        <Box>
          <Group justify="space-between" align="center" mb="md">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={1}>Password Protection</Text>
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
          </Group>

          <Stack gap="md">
            {room.isPasscodeProtected && (
              <Box
                style={{
                  padding: "14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-surface)",
                }}
              >
                {currentPassword ? (
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Text size="xs" fw={600} c="dimmed" tt="uppercase">Current Password</Text>
                      <Button
                        variant="subtle"
                        color={removeProtection ? "violet" : "red"}
                        size="xs"
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
                          <Tooltip label={showCurrentPassword ? "Hide password" : "Show password"} withArrow>
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
                          <Tooltip label={copiedCurrentPassword ? "Copied!" : "Copy password"} withArrow>
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
                        <Text size="sm" fw={500}>Room is password-protected</Text>
                      </Group>
                      <Button
                        variant="subtle"
                        color={removeProtection ? "violet" : "red"}
                        size="xs"
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
              </Box>
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
                />
                {password.length > 0 && (
                  <PasswordInput
                    label="Confirm password"
                    placeholder="Confirm new password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.currentTarget.value)}
                  />
                )}
              </Stack>
            )}
          </Stack>
        </Box>
        
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} loading={isSaving} color="violet">Save Changes</Button>
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const history = useHistory();

  const handleCopy = () => {
    navigator.clipboard.writeText(getRoomUrl(room.roomId)).catch(console.error);
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this room?")) {
      setIsDeleting(true);
      await onDelete(room.roomId);
      setIsDeleting(false);
    }
  };

  const handlePlaceholder = (action: string) => {
    alert(`${action} is currently available in Room Details view.`);
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
      alert(e.message || "Failed to upload cover photo.");
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
    items.push(
      <Menu.Item key="copy" leftSection={<IconCopy size={14} />} onClick={handleCopy}>
        Copy Room Link
      </Menu.Item>
    );

    if (computedState !== 'Expired' && computedState !== 'Ended') {
      items.push(<Menu.Divider key="div1" />);
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
        <Menu.Item key="settings" leftSection={<IconSettings size={14} />} onClick={() => setEditModalOpened(true)}>
          Edit Room
        </Menu.Item>
      );
      items.push(
        <Menu.Item key="end" leftSection={<IconPlayerStop size={14} />} onClick={() => handlePlaceholder('End Room')}>
          End Room
        </Menu.Item>
      );
    }

    items.push(<Menu.Divider key="div2" />);
    items.push(
      <Menu.Item key="delete" color="red" leftSection={<IconTrash size={14} />} onClick={handleDelete}>
        Delete Room
      </Menu.Item>
    );
    return items;
  };

  return { isUploading, fileInputRef, handleFileUpload, renderPrimary, renderSecondary, renderMenuItems, editModalOpened, setEditModalOpened };
};

// --- View Components ---

const GridRoomCard = ({ room, onDelete, onUpdateCover }: { room: RoomSummary, onDelete: (id: string) => void, onUpdateCover?: (id: string, url: string) => void }) => {
  const actions = useRoomActions(room, onDelete, undefined, onUpdateCover);
  const isPermanent = Boolean(room.isPermanent);
  const creationDate = new Date(room.creationTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className={styles.gridCard}>
      <div className={styles.gridCardCover}>
        {room.coverPhoto ? (
          <img src={room.coverPhoto} alt="Room Cover" className={styles.cover} />
        ) : (
          <div className={styles.coverPlaceholder}>WATCH PARTY</div>
        )}

        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10 }}>
          <RoomStatusBadge status={room.status} isPermanent={isPermanent} />
        </div>

        {onUpdateCover && (
          <>
            <ActionIcon
              variant="filled" color="dark" size="sm" radius="md" loading={actions.isUploading}
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.6)' }}
              onClick={(e) => { e.stopPropagation(); actions.fileInputRef.current?.click(); }}
            >
              <IconPhotoPlus size={14} color="white" />
            </ActionIcon>
            <input type="file" accept="image/*" ref={actions.fileInputRef} style={{ display: 'none' }} onChange={actions.handleFileUpload} />
          </>
        )}
      </div>

      <div className={styles.gridCardBody}>
        <h3 className={styles.roomTitle} title={room.roomTitle || "Watch Party Room"}>
          {room.roomTitle || "Watch Party Room"}
        </h3>
        <div className={styles.roomDescription}>
          {room.roomDescription || "No description provided."}
        </div>

        <div className={styles.roomMetadata}>
          <div className={styles.metaItemValue}>
            {room.isPasscodeProtected ? (
              <>
                <IconLock size={14} />
                Protected
              </>
            ) : (
              <>
                <IconLockOpen size={14} />
                Public
              </>
            )}
          </div>
          <div className={styles.metaItemValue}>
            <IconMessage size={14} />
            {room.isChatDisabled ? 'Chat disabled' : 'Chat'}
          </div>
          <div className={styles.metaItemValue}>{creationDate}</div>
        </div>

        <div className={styles.roomLifecycle}>
          {formatTimeLeft(room.expiresAt, room.status, isPermanent)}
        </div>
      </div>

      <div className={styles.roomActionsBar}>
        <div className={styles.actionButtons}>
          {actions.renderPrimary()}
          {actions.renderSecondary()}
        </div>
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

      <EditRoomModal 
        room={room}
        opened={actions.editModalOpened} 
        onClose={() => actions.setEditModalOpened(false)} 
        onSuccess={() => window.location.reload()} 
      />
    </div>
  );
};

const StackRoomCard = ({ room, onDelete, onUpdateCover }: { room: RoomSummary, onDelete: (id: string) => void, onUpdateCover?: (id: string, url: string) => void }) => {
  const actions = useRoomActions(room, onDelete, undefined, onUpdateCover);
  const isPermanent = Boolean(room.isPermanent);
  const creationDate = new Date(room.creationTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className={styles.stackCard}>
      <div className={styles.stackCardCover}>
        {room.coverPhoto ? (
          <img src={room.coverPhoto} alt="Room Cover" className={styles.cover} />
        ) : (
          <div className={styles.coverPlaceholder}>WATCH PARTY</div>
        )}

        {onUpdateCover && (
          <>
            <ActionIcon
              variant="filled" color="dark" size="sm" radius="md" loading={actions.isUploading}
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.6)' }}
              onClick={(e) => { e.stopPropagation(); actions.fileInputRef.current?.click(); }}
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
            <h3 className={styles.roomTitle} title={room.roomTitle || "Watch Party Room"}>
              {room.roomTitle || "Watch Party Room"}
            </h3>
            <div className={styles.roomDescription}>
              {room.roomDescription || "No description provided."}
            </div>
          </div>

          <div className={styles.stackCardLifecycleBox}>
            <RoomStatusBadge status={room.status} isPermanent={isPermanent} />
            {formatTimeLeft(room.expiresAt, room.status, isPermanent)}
          </div>
        </div>

        <div className={styles.stackCardBottom}>
          <div className={styles.roomMetadata} style={{ marginBottom: 0 }}>
            <div className={styles.metaItemValue}>
              {room.isPasscodeProtected ? (
                <>
                  <IconLock size={14} /> Protected
                </>
              ) : (
                <>
                  <IconLockOpen size={14} /> Public
                </>
              )}
            </div>
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
      </div>

      <EditRoomModal 
        room={room}
        opened={actions.editModalOpened} 
        onClose={() => actions.setEditModalOpened(false)} 
        onSuccess={() => window.location.reload()} 
      />
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
