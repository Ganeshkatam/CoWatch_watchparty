import React, { useState, useRef } from "react";
import { useHistory } from "react-router-dom";
import { Badge, Button, ActionIcon, Menu, Modal, TextInput, Textarea, Switch, PasswordInput, Divider, Group, Stack, Text, Box, FileButton } from "@mantine/core";
import {
  IconTrash, IconCopy, IconPlayerPlayFilled, IconSettings,
  IconLock, IconLockOpen, IconMessage,
  IconPhotoPlus, IconDots, IconPlayerStop, IconHourglassHigh
} from "@tabler/icons-react";
import { type RoomSummary } from "./MyRooms";
import { getRoomUrl, serverPath } from "../../utils/utils";
import { supabase, getAccessToken } from "../../utils/supabaseClient";
import styles from "./MyRooms.module.css";

// --- Pure Helpers ---

const getComputedState = (room: RoomSummary) => {
  const isPermanent = room.isSubRoom || !room.expiresAt;
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
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return <div className={styles.lifecycleText}>Room is no longer active</div>;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (status === "expiring") {
    return (
      <div className={styles.lifecycleExpiring}>
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
  const [title, setTitle] = useState(room.roomTitle || "");
  const [description, setDescription] = useState(room.roomDescription || "");
  const [isPermanent, setIsPermanent] = useState(room.isSubRoom || !room.expiresAt);
  const [isChatDisabled, setIsChatDisabled] = useState(room.isChatDisabled || false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(room.coverPhoto || null);

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
    if (password && password !== passwordConfirm) {
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
          password: password || undefined,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to save room settings");

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
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={1} mb="md">Password Protection</Text>
          <Stack gap="md">
            <Box>
              <Text fw={500}>{room.isPasscodeProtected ? "🔒 Protected" : "🔓 Unprotected"}</Text>
              <Text size="sm" c="dimmed">Enter a new password to change or set protection. Leave blank to keep current settings.</Text>
            </Box>
            <PasswordInput label="New password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <PasswordInput label="Confirm password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.currentTarget.value)} />
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
        <Button variant="default" onClick={() => history.push(detailsPath)}>
          Details
        </Button>
      );
    }
    return (
      <Button variant="white" color="dark" onClick={() => history.push(urlPath)} leftSection={<IconPlayerPlayFilled size={14} />}>
        Open Room
      </Button>
    );
  };

  const renderSecondary = () => {
    if (computedState === 'Expired' || computedState === 'Ended') return null;
    return (
      <Button variant="subtle" color="gray" onClick={() => history.push(detailsPath)}>
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
  const isPermanent = room.isSubRoom || !room.expiresAt;
  const creationDate = new Date(room.creationTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className={styles.gridCard}>
      <div className={styles.gridCardCover}>
        {room.coverPhoto ? (
          <img src={room.coverPhoto} alt="Room Cover" className={styles.cover} />
        ) : (
          <div className={styles.coverPlaceholder}>WATCH PARTY</div>
        )}

        <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10 }}>
          <RoomStatusBadge status={room.status} isPermanent={isPermanent} />
        </div>

        {onUpdateCover && (
          <>
            <ActionIcon
              variant="filled" color="dark" size="md" radius="md" loading={actions.isUploading}
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.6)' }}
              onClick={(e) => { e.stopPropagation(); actions.fileInputRef.current?.click(); }}
            >
              <IconPhotoPlus size={16} color="white" />
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
            {room.isPasscodeProtected ? <IconLock size={16} /> : <IconLockOpen size={16} />}
            Protected
          </div>
          <div className={styles.metaItemValue}>
            <IconMessage size={16} />
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
            <ActionIcon variant="subtle" color="gray" size="lg" radius="md">
              <IconDots size={18} />
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
  const isPermanent = room.isSubRoom || !room.expiresAt;
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
              {room.isPasscodeProtected ? <IconLock size={14} /> : <IconLockOpen size={14} />} Protected
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
                <ActionIcon variant="subtle" color="gray" size="lg" radius="md">
                  <IconDots size={18} />
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
