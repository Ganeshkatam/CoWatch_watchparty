import React, { useState, useEffect } from "react";
import { useParams, useHistory } from "react-router-dom";
import { Title, Text, Badge, Button, Group, Modal, Loader, Paper, Stack, Grid, Divider, ActionIcon, Tooltip } from "@mantine/core";
import { IconArrowLeft, IconPlayerPlayFilled, IconCopy, IconSettings, IconLock, IconLockOpen, IconEye, IconEyeOff, IconCheck } from "@tabler/icons-react";
import { serverPath, getRoomUrl, addAndSavePasscode, getSavedPasscodes } from "../../utils/utils";
import { getAccessToken, supabase } from "../../utils/supabaseClient";
import styles from "./MyRooms.module.css";
import { EditRoomModal } from "./RoomCard";

interface LifecycleEvent {
  id: string;
  actor: string;
  event: string;
  previousStatus: string | null;
  newStatus: string | null;
  previousExpiresAt: string | null;
  newExpiresAt: string | null;
  reason: string | null;
  timestamp: string;
}

interface RoomDetailsData {
  roomId: string;
  isPasscodeProtected: boolean;
  currentPasscode?: string | null;
  creationTime: string;
  roomTitle: string;
  roomDescription: string | null;
  coverPhoto: string | null;
  isChatDisabled: boolean;
  isSubRoom: boolean;
  status: "scheduled" | "active" | "inactive" | "expiring" | "expired" | "ended";
  startedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  isPermanent: boolean;
  owner_id?: string;
  lifecycleEvents: LifecycleEvent[];
  chatSummary?: {
    messagesCount: number;
    lastMessageAt: string | null;
  };
}

const RoomStatusBadge = ({ status }: { status: RoomDetailsData['status'] }) => {
  if (status === 'active') return <Badge color="violet" variant="light">Active</Badge>;
  if (status === 'inactive') return <Badge color="yellow" variant="light">Inactive</Badge>;
  if (status === 'expiring') return <Badge color="orange" variant="light">Expiring Soon</Badge>;
  if (status === 'expired') return <Badge color="gray" variant="light">Expired</Badge>;
  if (status === 'ended') return <Badge color="gray" variant="light">Ended</Badge>;
  if (status === 'scheduled') return <Badge color="blue" variant="light">Scheduled</Badge>;
  return null;
};

export const RoomDetails = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const history = useHistory();
  const [room, setRoom] = useState<RoomDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const [editModalOpened, setEditModalOpened] = useState(false);

  const fetchRoomDetails = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const user = await supabase.auth.getUser();
      if (!user.data.user) throw new Error("Not authenticated");

      const response = await fetch(`${serverPath}/roomDetails?uid=${user.data.user.id}&token=${token}&roomId=${roomId}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error("Room not found or unauthorized");
        throw new Error("Failed to fetch room details");
      }
      const data = await response.json();
      if (data && data.currentPasscode) {
        addAndSavePasscode(data.roomId, data.currentPasscode);
      }
      setRoom(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentPasscode =
    room?.currentPasscode ||
    (room?.roomId && getSavedPasscodes()[room.roomId]) ||
    (room?.roomId && getSavedPasscodes()[room.roomId.startsWith("/") ? room.roomId.substring(1) : room.roomId]) ||
    "";

  useEffect(() => {
    fetchRoomDetails();
  }, [roomId]);

  const handleCopy = () => {
    if (!room) return;
    const url = getRoomUrl(room.roomId);
    navigator.clipboard.writeText(url).catch(console.error);
  };

  const handleDelete = async () => {
    if (!room) return;
    setIsDeleting(true);
    try {
      const token = await getAccessToken();
      const user = await supabase.auth.getUser();
      const response = await fetch(`${serverPath}/deleteRoom?uid=${user.data.user?.id}&token=${token}&roomId=${room.roomId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        history.push("/rooms");
      } else {
        throw new Error("Failed to delete room");
      }
    } catch (e) {
      console.error(e);
      setIsDeleting(false);
      setDeleteConfirm(false);
    }
  };

  const handleExtend = async () => {
    if (!room) return;
    setIsExtending(true);
    try {
      const token = await getAccessToken();
      const user = await supabase.auth.getUser();
      const durationSeconds = 3600; // 1 hour
      const response = await fetch(`${serverPath}/extendRoom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user.data.user?.id, token, roomId: room.roomId, durationSeconds })
      });
      if (response.ok) {
        await fetchRoomDetails();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsExtending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Loader size="lg" color="violet" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div style={{ maxWidth: '1440px', width: '100%', margin: '0 auto', padding: '24px' }}>
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => history.push("/rooms")} mb="xl">
          Back to My Rooms
        </Button>
        <Paper withBorder p="xl" radius="md" style={{ textAlign: 'center' }}>
          <Title order={3} c="red" mb="sm">Error</Title>
          <Text>{error || "Could not load room details."}</Text>
        </Paper>
      </div>
    );
  }

  const isOpenable = room.status === 'active' || room.status === 'expiring' || room.status === 'scheduled' || room.status === 'inactive';
  const urlPath = `/watch/${room.roomId.replace(/^\//, '')}`;

  // Time remaining calculator
  const getExpiresIn = () => {
    if (!room.expiresAt) return null;
    const diff = new Date(room.expiresAt).getTime() - Date.now();
    if (diff <= 0) return null;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `Expires in ${hours}h ${mins}m`;
    return `Expires in ${mins}m`;
  };

  const getStartedAgo = () => {
    if (!room.startedAt) return null;
    const diff = Date.now() - new Date(room.startedAt).getTime();
    if (diff <= 0) return null;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `Started ${hours}h ${mins}m ago`;
    return `Started ${mins}m ago`;
  };

  const expiresInText = getExpiresIn();
  const startedAgoText = getStartedAgo();

  return (
    <div style={{ maxWidth: '1500px', width: 'calc(100vw - 48px)', margin: '0 auto', padding: '32px 0' }}>
      
      <div className={styles.cinematicShell}>
        
        {/* HERO SECTION */}
        <div style={{ 
          position: 'relative', 
          borderRadius: '18px', 
          overflow: 'hidden', 
          marginBottom: '32px',
          minHeight: '320px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '40px',
          border: '1px solid var(--border-subtle)'
        }}>
          {room.coverPhoto ? (
            <>
              <img src={room.coverPhoto} alt="Room Cover" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }} />
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(to right, rgba(15,15,18,0.95) 0%, rgba(15,15,18,0.6) 50%, rgba(15,15,18,0.2) 100%), linear-gradient(to top, rgba(15,15,18,0.95) 0%, transparent 50%)', zIndex: 1 }} />
            </>
          ) : (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'var(--bg-surface)', zIndex: 0 }} />
          )}

          <Group justify="space-between" align="flex-start" style={{ position: 'relative', zIndex: 10 }}>
            <Button variant="transparent" leftSection={<IconArrowLeft size={16} />} onClick={() => history.push("/rooms")} pl={0} color="gray" style={{ color: 'rgba(255,255,255,0.7)' }}>
              My Rooms
            </Button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ 
                width: '10px', height: '10px', borderRadius: '50%', 
                backgroundColor: room.status === 'active' ? 'var(--mantine-color-green-5)' :
                                 room.status === 'inactive' ? 'var(--mantine-color-yellow-5)' :
                                 room.status === 'expiring' ? 'var(--mantine-color-orange-5)' :
                                 room.status === 'scheduled' ? 'var(--mantine-color-blue-5)' :
                                 'var(--mantine-color-gray-5)' 
              }} />
              <Text fw={800} lts={1} tt="uppercase" size="xs" style={{ 
                color: room.status === 'active' ? 'var(--mantine-color-green-5)' :
                       room.status === 'inactive' ? 'var(--mantine-color-yellow-5)' :
                       room.status === 'expiring' ? 'var(--mantine-color-orange-5)' :
                       room.status === 'scheduled' ? 'var(--mantine-color-blue-5)' :
                       'var(--mantine-color-gray-5)' 
              }}>
                {room.status === 'expiring' ? 'Expiring Soon' : room.status}
              </Text>
            </div>
          </Group>

          <Group justify="space-between" align="flex-end" style={{ position: 'relative', zIndex: 10, marginTop: '40px' }}>
            <div>
              <Title order={1} fw={800} style={{ color: '#fff', fontSize: '42px', letterSpacing: '-0.5px' }}>
                {room.roomTitle}
              </Title>
              <Text mt={4} size="lg" fw={500}>
                <a href={urlPath} onClick={(e) => { e.preventDefault(); history.push(urlPath); }} style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>
                  /watch/{room.roomId.replace(/^\//, '')}
                </a>
              </Text>
            </div>
            
            <Group>
              {isOpenable && (
                <Button size="md" color="violet" onClick={() => history.push(urlPath)} leftSection={<IconPlayerPlayFilled size={16} />}>
                  Open Room
                </Button>
              )}
              <Button size="md" variant="default" onClick={() => setEditModalOpened(true)} leftSection={<IconSettings size={16} />} style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
                Edit Room
              </Button>
              <Button size="md" variant="default" onClick={handleCopy} leftSection={<IconCopy size={16} />} style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
                Copy Link
              </Button>
            </Group>
          </Group>
        </div>

        <div className={styles.cinematicSeparator} />

        {/* MAIN CONTENT GRID */}
        <Grid gutter={64}>
          <Grid.Col span={{ base: 12, md: 7.5 }}>
            
            {/* ROOM INFORMATION */}
            <div>
              <div className={styles.cinematicSectionHeader}>Room Information</div>
              <div className={styles.cinematicGrid}>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Created</div>
                  <div className={styles.cinematicValue}>{new Date(room.creationTime).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Room ID</div>
                  <div className={styles.cinematicValue}>{room.roomId}</div>
                </div>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Password</div>
                  <div className={styles.cinematicValue}>
                    {room.isPasscodeProtected ? (
                      currentPasscode ? (
                        <Group gap={6} align="center">
                          <Text size="sm" fw={500} style={{ fontFamily: showPassword ? "inherit" : "monospace", letterSpacing: showPassword ? "normal" : "2px" }}>
                            {showPassword ? currentPasscode : "••••••••"}
                          </Text>
                          <Tooltip label={showPassword ? "Hide password" : "Show password"} withArrow>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="gray"
                              onClick={() => setShowPassword(!showPassword)}
                              aria-label="Toggle password visibility"
                            >
                              {showPassword ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={copiedPassword ? "Copied!" : "Copy password"} withArrow>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color={copiedPassword ? "green" : "gray"}
                              onClick={() => {
                                navigator.clipboard.writeText(currentPasscode);
                                setCopiedPassword(true);
                                setTimeout(() => setCopiedPassword(false), 2000);
                              }}
                              aria-label="Copy password"
                            >
                              {copiedPassword ? <IconCheck size={14} /> : <IconCopy size={14} />}
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      ) : (
                        <Badge color="violet" variant="light" size="sm" leftSection={<IconLock size={12} />}>
                          Protected
                        </Badge>
                      )
                    ) : (
                      <Badge color="gray" variant="light" size="sm" leftSection={<IconLockOpen size={12} />}>
                        None
                      </Badge>
                    )}
                  </div>
                </div>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Chat</div>
                  <div className={styles.cinematicValue}>{room.isChatDisabled ? "Disabled" : "Enabled"}</div>
                </div>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Type</div>
                  <div className={styles.cinematicValue}>{room.isPermanent ? "Permanent" : "Temporary"}</div>
                </div>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Sub-room</div>
                  <div className={styles.cinematicValue}>{room.isSubRoom ? "Yes" : "No"}</div>
                </div>
              </div>
            </div>

            <div className={styles.cinematicSeparator} />

            {/* ROOM SETTINGS */}
            <div>
              <div className={styles.cinematicSectionHeader}>Room Settings</div>
              <div className={styles.cinematicGrid}>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Chat</div>
                  <div className={styles.cinematicValue}>{room.isChatDisabled ? "Disabled" : "Enabled"}</div>
                </div>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Room Controls</div>
                  <div className={styles.cinematicValue}>Host only</div>
                </div>
              </div>
            </div>

            <div className={styles.cinematicSeparator} />

            {/* CHAT HISTORY */}
            <div>
              <div className={styles.cinematicSectionHeader}>Chat History</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
                <Text fw={600} size="xl" c="var(--text-primary)">
                  {room.chatSummary ? room.chatSummary.messagesCount : 0} messages
                </Text>
                
                {(room.chatSummary && room.chatSummary.messagesCount > 0) ? (
                  <div className={styles.cinematicGridItem}>
                    <div className={styles.cinematicLabel}>Last message</div>
                    <div className={styles.cinematicValue}>{new Date(room.chatSummary.lastMessageAt!).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                ) : (
                  <Text c="dimmed">No messages yet</Text>
                )}
              </div>
            </div>

          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4.5 }}>
            
            {/* LIFECYCLE PANEL */}
            <div>
              <div className={styles.cinematicSectionHeader}>Lifecycle</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ 
                  width: '10px', height: '10px', borderRadius: '50%', 
                  backgroundColor: room.status === 'active' ? 'var(--mantine-color-green-5)' :
                                   room.status === 'inactive' ? 'var(--mantine-color-yellow-5)' :
                                   room.status === 'expiring' ? 'var(--mantine-color-orange-5)' :
                                   room.status === 'scheduled' ? 'var(--mantine-color-blue-5)' :
                                   'var(--mantine-color-gray-5)' 
                }} />
                <Text fw={800} lts={1} tt="uppercase" size="sm" style={{ 
                  color: room.status === 'active' ? 'var(--mantine-color-green-5)' :
                         room.status === 'inactive' ? 'var(--mantine-color-yellow-5)' :
                         room.status === 'expiring' ? 'var(--mantine-color-orange-5)' :
                         room.status === 'scheduled' ? 'var(--mantine-color-blue-5)' :
                         'var(--mantine-color-gray-5)' 
                }}>
                  {room.status === 'expiring' ? 'Expiring Soon' : room.status}
                </Text>
              </div>

              {room.status === 'inactive' && (
                <Text size="md" mb="xl" c="dimmed">Room is currently dormant</Text>
              )}

              {room.status === 'active' && !room.isPermanent && room.expiresAt && (
                <div style={{ marginBottom: '32px' }}>
                  <div className={styles.cinematicCountdown}>
                    {expiresInText?.replace('Expires in ', '') || '—'}
                  </div>
                  <div className={styles.cinematicCountdownLabel}>remaining</div>
                </div>
              )}

              <div className={styles.cinematicGrid} style={{ marginBottom: '32px' }}>
                <div className={styles.cinematicGridItem}>
                  <div className={styles.cinematicLabel}>Participants</div>
                  <div className={styles.cinematicValue}>{room.status === 'inactive' ? '0' : '—'}</div>
                </div>
                
                {room.status === 'active' && !room.isPermanent && room.expiresAt && (
                  <div className={styles.cinematicGridItem}>
                    <div className={styles.cinematicLabel}>Expires</div>
                    <div className={styles.cinematicValue}>{new Date(room.expiresAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                )}
                
                {(room.status === 'inactive' || room.isPermanent) && (
                  <div className={styles.cinematicGridItem}>
                    <div className={styles.cinematicLabel}>Last activity</div>
                    <div className={styles.cinematicValue}>
                      {room.lifecycleEvents.length > 0 ? 
                        new Date(room.lifecycleEvents[0].timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                        : '—'}
                    </div>
                  </div>
                )}
              </div>

              {room.status === 'inactive' && (
                <div className={styles.cinematicGridItem} style={{ marginBottom: '32px' }}>
                  <div className={styles.cinematicLabel}>Reactivation</div>
                  <div className={styles.cinematicValue}>Automatically when someone joins</div>
                </div>
              )}

              {room.isPermanent && (
                <div className={styles.cinematicGridItem} style={{ marginBottom: '32px' }}>
                  <div className={styles.cinematicLabel}>Permanent room</div>
                  <div className={styles.cinematicValue}>No expiration scheduled.</div>
                </div>
              )}

              {isOpenable && !room.isPermanent && (
                <Button
                  variant="light"
                  color="violet"
                  size="md"
                  fullWidth
                  mb="xl"
                  onClick={handleExtend}
                  loading={isExtending}
                >
                  Extend Room
                </Button>
              )}

              <div className={styles.cinematicSeparator} style={{ margin: '24px 0' }} />

              {/* ACTIVITY TIMELINE */}
              <div className={styles.cinematicSectionHeader}>Activity</div>
              
              {room.lifecycleEvents && room.lifecycleEvents.length > 0 ? (
                <div className={styles.cinematicTimeline}>
                  {room.lifecycleEvents.slice(0, 6).map((event, index) => (
                    <div key={event.id} className={styles.cinematicTimelineItem}>
                      <div className={styles.cinematicTimelineBullet}>●</div>
                      <div className={styles.cinematicTimelineContent}>
                        <div className={styles.cinematicTimelineTitle}>{event.event}</div>
                        <div className={styles.cinematicTimelineMeta}>
                          {new Date(event.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      {index < Math.min(room.lifecycleEvents.length, 6) - 1 && <div className={styles.cinematicTimelineLine} />}
                    </div>
                  ))}
                </div>
              ) : (
                <Text size="sm" c="dimmed">No activity recorded.</Text>
              )}
            </div>

          </Grid.Col>
        </Grid>

        <div className={styles.cinematicSeparator} />

        {/* DANGER ZONE */}
        <Group justify="space-between" align="center" wrap="wrap">
          <div>
            <Title order={6} c="red" mb="xs" tt="uppercase" lts={1} style={{ fontSize: '13px' }}>Danger Zone</Title>
            <Text size="sm" c="dimmed">Delete this room and permanently remove its associated data.</Text>
          </div>
          <Button color="red" variant="subtle" onClick={() => setDeleteConfirm(true)}>
            Delete Room
          </Button>
        </Group>

      </div>

      <Modal opened={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Confirm Deletion" centered>
        <Text size="sm" mb="lg">
          Are you sure you want to delete <strong>{room.roomTitle || room.roomId}</strong>? This action cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
          <Button color="red" onClick={handleDelete} loading={isDeleting}>Delete Room</Button>
        </Group>
      </Modal>

      <EditRoomModal
        room={{
          roomId: room.roomId,
          creationTime: room.creationTime,
          roomTitle: room.roomTitle,
          roomDescription: room.roomDescription,
          coverPhoto: room.coverPhoto,
          isChatDisabled: room.isChatDisabled,
          isPasscodeProtected: room.isPasscodeProtected,
          currentPasscode: room.currentPasscode,
          isSubRoom: room.isSubRoom,
          status: room.status,
          startedAt: room.startedAt,
          endedAt: room.endedAt,
          expiresAt: room.expiresAt,
        }}
        opened={editModalOpened}
        onClose={() => setEditModalOpened(false)}
        onSuccess={fetchRoomDetails}
      />
    </div>
  );
};
