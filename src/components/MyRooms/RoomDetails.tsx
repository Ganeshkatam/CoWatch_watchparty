import React, { useState, useEffect } from "react";
import { useParams, useHistory } from "react-router-dom";
import {
  Title,
  Text,
  Badge,
  Button,
  Group,
  Modal,
  Loader,
  Paper,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconPlayerPlayFilled,
  IconCopy,
  IconSettings,
  IconLock,
  IconLockOpen,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconCalendar,
  IconClock,
  IconUsers,
  IconMessage,
  IconShieldCheck,
  IconAlertTriangle,
  IconInfoCircle,
  IconExternalLink,
  IconActivity,
  IconInfinity,
  IconTrash,
} from "@tabler/icons-react";
import { serverPath, getRoomUrl } from "../../utils/utils";
import { getAccessToken, supabase } from "../../utils/supabaseClient";
import styles from "./RoomDetails.module.css";
import { EditRoomModal } from "./RoomCard";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

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

const getStatusConfig = (status: RoomDetailsData["status"]) => {
  switch (status) {
    case "active":
      return {
        label: "Active",
        color: "green",
        dotClass: styles.active,
        description: "People are watching right now.",
        badgeColor: "green",
      };
    case "inactive":
      return {
        label: "Inactive",
        color: "yellow",
        dotClass: styles.inactive,
        description: "Empty right now. Starts when someone joins.",
        badgeColor: "yellow",
      };
    case "expiring":
      return {
        label: "Closing Soon",
        color: "orange",
        dotClass: styles.expiring,
        description: "This room will close soon unless extended.",
        badgeColor: "orange",
      };
    case "scheduled":
      return {
        label: "Scheduled",
        color: "blue",
        dotClass: styles.scheduled,
        description: "Set up for an upcoming watch party.",
        badgeColor: "blue",
      };
    case "ended":
      return {
        label: "Ended",
        color: "gray",
        dotClass: styles.ended,
        description: "This watch party has finished.",
        badgeColor: "gray",
      };
    default:
      return {
        label: status || "Unknown",
        color: "gray",
        dotClass: styles.inactive,
        description: "Room status.",
        badgeColor: "gray",
      };
  }
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
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedRoomId, setCopiedRoomId] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const [editModalOpened, setEditModalOpened] = useState(false);

  useDocumentMetadata({
    title: room?.roomTitle ? `${room.roomTitle} - Room Details` : "Room Details",
    description: "Manage room preferences, passcode, lifecycle, and view activity statistics.",
    noIndex: true,
  }, [room?.roomTitle]);

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
      setRoom(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentPasscode = room?.currentPasscode || "";

  useEffect(() => {
    fetchRoomDetails();
  }, [roomId]);

  const handleCopyUrl = () => {
    if (!room) return;
    const url = getRoomUrl(room.roomId, currentPasscode);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }).catch(console.error);
  };

  const handleCopyRoomId = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.roomId).then(() => {
      setCopiedRoomId(true);
      setTimeout(() => setCopiedRoomId(false), 2000);
    }).catch(console.error);
  };

  const handleCopyPassword = () => {
    if (!currentPasscode) return;
    navigator.clipboard.writeText(currentPasscode).then(() => {
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    }).catch(console.error);
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
        body: JSON.stringify({ uid: user.data.user?.id, token, roomId: room.roomId, durationSeconds }),
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
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <Loader size="lg" color="violet" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className={styles.container}>
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => history.push("/rooms")} mb="xl">
          Back to My Rooms
        </Button>
        <Paper withBorder p="xl" radius="md" style={{ textAlign: "center" }}>
          <Title order={3} c="red" mb="sm">Something went wrong</Title>
          <Text>{error || "Could not load this room."}</Text>
        </Paper>
      </div>
    );
  }

  const isOpenable = room.status === "active" || room.status === "expiring" || room.status === "scheduled" || room.status === "inactive";
  const urlPath = `/watch/${room.roomId.replace(/^\//, "")}`;
  const statusConfig = getStatusConfig(room.status);

  // Time remaining calculator
  const getExpiresIn = () => {
    if (!room.expiresAt) return null;
    const diff = new Date(room.expiresAt).getTime() - Date.now();
    if (diff <= 0) return null;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  };

  const expiresInText = getExpiresIn();

  return (
    <div className={styles.container}>
      {/* BREADCRUMBS */}
      <div className={styles.breadcrumb}>
        <span className={styles.breadcrumbLink} onClick={() => history.push("/rooms")}>
          <IconArrowLeft size={15} /> My Rooms
        </span>
        <span className={styles.breadcrumbSeparator}>/</span>
        <span className={styles.breadcrumbCurrent}>{room.roomTitle || room.roomId}</span>
      </div>

      {/* HERO SECTION */}
      <div className={styles.hero}>
        {room.coverPhoto ? (
          <>
            <img src={room.coverPhoto} alt="Room Cover" className={styles.heroCover} />
            <div className={styles.heroScrim} />
          </>
        ) : (
          <>
            <div className={styles.heroFallbackBg} />
            <div className={styles.heroScrim} />
          </>
        )}

        <div className={styles.heroContent}>
          {/* Top Bar inside Hero */}
          <div className={styles.heroTopRow}>
            <Button
              variant="transparent"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => history.push("/rooms")}
              pl={0}
              color="gray"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              Back to My Rooms
            </Button>

            <div className={styles.statusPill}>
              <div className={`${styles.pulseDot} ${statusConfig.dotClass}`} />
              <span style={{ color: "rgba(255,255,255,0.9)" }}>{statusConfig.label}</span>
            </div>
          </div>

          {/* Bottom Row inside Hero */}
          <div className={styles.heroBottomRow}>
            <div className={styles.heroMeta}>
              <h1 className={styles.heroTitle}>
                {room.roomTitle || "Watch Party Room"}
              </h1>

              {room.roomDescription && (
                <p className={styles.heroDescription}>
                  {room.roomDescription}
                </p>
              )}

              <Tooltip label={copiedUrl ? "Copied to clipboard!" : "Click to copy invite link"} withArrow>
                <div className={styles.heroUrlBadge} onClick={handleCopyUrl}>
                  {copiedUrl ? <IconCheck size={14} color="var(--color-success)" /> : <IconCopy size={14} />}
                  <span>/watch/{room.roomId.replace(/^\//, "")}</span>
                </div>
              </Tooltip>
            </div>

            <div className={styles.heroActions}>
              {isOpenable && (
                <Button
                  size="md"
                  className={styles.primaryOpenBtn}
                  onClick={() => history.push(urlPath)}
                  leftSection={<IconPlayerPlayFilled size={16} />}
                >
                  Join Room
                </Button>
              )}
              <Button
                size="md"
                className={styles.glassBtn}
                onClick={() => setEditModalOpened(true)}
                leftSection={<IconSettings size={16} />}
              >
                Edit
              </Button>
              <Button
                size="md"
                className={styles.glassBtn}
                onClick={handleCopyUrl}
                leftSection={copiedUrl ? <IconCheck size={16} color="var(--color-success)" /> : <IconCopy size={16} />}
              >
                {copiedUrl ? "Copied!" : "Copy Link"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* QUICK STATS ROW */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ backgroundColor: "var(--status-success-soft)" }}>
            <IconActivity size={22} color="var(--color-success)" />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Room Status</span>
            <span className={styles.statValue}>{statusConfig.label}</span>
            <span className={styles.statSubtitle}>{statusConfig.description}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ backgroundColor: "var(--accent-primary-soft)" }}>
            <IconUsers size={22} color="var(--color-violet)" />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Viewers</span>
            <span className={styles.statValue}>{room.status === "active" ? "Watching Now" : "0"}</span>
            <span className={styles.statSubtitle}>
              {room.status === "active" ? "People in the room" : "No one watching yet"}
            </span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div
            className={styles.statIconWrap}
            style={{
              backgroundColor: room.isPermanent ? "var(--status-success-soft)" : "var(--status-warning-soft)",
            }}
          >
            {room.isPermanent ? <IconInfinity size={22} color="var(--color-teal)" /> : <IconClock size={22} color="var(--color-warning)" />}
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Room Expiry</span>
            <span className={styles.statValue}>
              {room.isPermanent ? "Never Expires" : (expiresInText || "Temporary")}
            </span>
            <span className={styles.statSubtitle}>
              {room.isPermanent ? "Saved forever" : "Renews when used"}
            </span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ backgroundColor: "var(--surface-hover)" }}>
            <IconMessage size={22} color="var(--color-pink)" />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>Chat</span>
            <span className={styles.statValue}>{room.chatSummary ? room.chatSummary.messagesCount : 0} Messages</span>
            <span className={styles.statSubtitle}>
              {room.chatSummary?.lastMessageAt
                ? `Last message: ${new Date(room.chatSummary.lastMessageAt).toLocaleDateString()}`
                : "No messages yet"}
            </span>
          </div>
        </div>
      </div>

      {/* BENTO CONTENT GRID */}
      <div className={styles.bentoGrid}>
        {/* LEFT COLUMN: DETAILS & SETTINGS */}
        <div>
          {/* Card 1: Room Details */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <div className={styles.cardTitleIconWrap}>
                  <IconInfoCircle size={18} />
                </div>
                <span>Room Details</span>
              </div>
            </div>

            <div className={styles.tileGrid}>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Room ID</span>
                <div className={styles.tileValue}>
                  <span className={styles.codeBadge}>{room.roomId}</span>
                  <Tooltip label={copiedRoomId ? "Copied!" : "Copy room ID"} withArrow>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color={copiedRoomId ? "green" : "gray"}
                      onClick={handleCopyRoomId}
                      aria-label="Copy Room ID"
                    >
                      {copiedRoomId ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                </div>
              </div>

              <div className={styles.tile}>
                <span className={styles.tileLabel}>
                  <IconCalendar size={13} />
                  Created
                </span>
                <span className={styles.tileValue}>
                  {new Date(room.creationTime).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <div className={styles.tile}>
                <span className={styles.tileLabel}>
                  <IconLock size={13} />
                  Password
                </span>
                <div className={styles.tileValue}>
                  {room.isPasscodeProtected ? (
                    currentPasscode ? (
                      <Group gap={6} align="center">
                        <span
                          style={{
                            fontFamily: showPassword ? "inherit" : "monospace",
                            letterSpacing: showPassword ? "normal" : "2px",
                            fontWeight: 700,
                          }}
                        >
                          {showPassword ? currentPasscode : "••••••••"}
                        </span>
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
                            onClick={handleCopyPassword}
                            aria-label="Copy password"
                          >
                            {copiedPassword ? <IconCheck size={14} /> : <IconCopy size={14} />}
                          </ActionIcon>
                        </Tooltip>
                        <Badge
                          color="violet"
                          variant="light"
                          size="md"
                          radius="md"
                          style={{ fontWeight: 600, border: "1px solid rgba(139, 92, 246, 0.25)" }}
                        >
                          Password Protected
                        </Badge>
                      </Group>
                    ) : (
                      <Badge
                        color="violet"
                        variant="light"
                        size="md"
                        radius="md"
                        leftSection={<IconLock size={13} />}
                        style={{ fontWeight: 600, border: "1px solid rgba(139, 92, 246, 0.25)" }}
                      >
                        Password Protected
                      </Badge>
                    )
                  ) : (
                    <Badge
                      color="gray"
                      variant="light"
                      size="md"
                      radius="md"
                      leftSection={<IconLockOpen size={13} />}
                      style={{ fontWeight: 600 }}
                    >
                      No Password Needed
                    </Badge>
                  )}
                </div>
              </div>

              <div className={styles.tile}>
                <span className={styles.tileLabel}>Room Type</span>
                <div className={styles.tileValue}>
                  <Badge
                    color={room.isPermanent ? "teal" : "blue"}
                    variant="light"
                    size="md"
                    radius="md"
                    style={{
                      fontWeight: 600,
                      border: room.isPermanent
                        ? "1px solid rgba(20, 184, 166, 0.25)"
                        : "1px solid rgba(59, 130, 246, 0.25)",
                    }}
                  >
                    {room.isPermanent ? "Permanent Room" : "Temporary Room"}
                  </Badge>
                  {room.isSubRoom && (
                    <Badge color="gray" variant="outline" size="md" radius="md" style={{ fontWeight: 600 }}>
                      Sub-Room
                    </Badge>
                  )}
                </div>
              </div>

              <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
                <span className={styles.tileLabel}>Invite Link</span>
                <div className={styles.tileValue}>
                  <a
                    href={urlPath}
                    onClick={(e) => {
                      e.preventDefault();
                      history.push(urlPath);
                    }}
                    style={{
                      color: "var(--color-violet)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      textDecoration: "underline",
                      fontWeight: 600,
                    }}
                  >
                    {window.location.origin}{urlPath}
                    <IconExternalLink size={14} />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Settings */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <div className={styles.cardTitleIconWrap}>
                  <IconSettings size={18} />
                </div>
                <span>Room Settings</span>
              </div>
              <Button
                variant="subtle"
                size="xs"
                color="violet"
                onClick={() => setEditModalOpened(true)}
                leftSection={<IconSettings size={14} />}
              >
                Edit
              </Button>
            </div>

            <div className={styles.tileGrid}>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Live Chat</span>
                <div className={styles.tileValue}>
                  <Badge
                    color={room.isChatDisabled ? "gray" : "green"}
                    variant="light"
                    size="md"
                    radius="md"
                    style={{
                      fontWeight: 600,
                      border: room.isChatDisabled
                        ? "1px solid rgba(156, 163, 175, 0.25)"
                        : "1px solid rgba(16, 185, 129, 0.25)",
                    }}
                  >
                    {room.isChatDisabled ? "Turned Off" : "Turned On"}
                  </Badge>
                </div>
              </div>

              <div className={styles.tile}>
                <span className={styles.tileLabel}>Video Controls</span>
                <div className={styles.tileValue}>
                  <Badge
                    color="violet"
                    variant="light"
                    size="md"
                    radius="md"
                    leftSection={<IconShieldCheck size={13} />}
                    style={{ fontWeight: 600, border: "1px solid rgba(139, 92, 246, 0.25)" }}
                  >
                    Host Only
                  </Badge>
                </div>
              </div>

              <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
                <span className={styles.tileLabel}>Description</span>
                <div className={styles.tileValue}>
                  {room.roomDescription ? (
                    <Text size="sm" c="var(--text-secondary)" style={{ fontStyle: "italic" }}>
                      "{room.roomDescription}"
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      No description added yet. Click "Edit" to add one.
                    </Text>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Danger Zone */}
          <div className={styles.dangerCard}>
            <div className={styles.dangerInfo}>
              <div className={styles.dangerTitle}>
                <IconAlertTriangle size={16} />
                <span>Danger Zone</span>
              </div>
              <div className={styles.dangerDesc}>
                Delete this room forever. All messages and room settings will be lost. You cannot undo this.
              </div>
            </div>
            <Button
              color="red"
              variant="outline"
              onClick={() => setDeleteConfirm(true)}
              leftSection={<IconTrash size={15} />}
            >
              Delete Room
            </Button>
          </div>
        </div>

        {/* RIGHT COLUMN: STATUS & RECENT ACTIVITY */}
        <div>
          {/* Card 4: Status & Timing */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <div className={styles.cardTitleIconWrap}>
                  <IconClock size={18} />
                </div>
                <span>Status & Timing</span>
              </div>
              <Badge color={statusConfig.badgeColor} variant="light" size="sm">
                {statusConfig.label}
              </Badge>
            </div>

            <div
              className={`${styles.lifecycleBanner} ${
                room.isPermanent ? styles.permanent : room.status === "active" ? styles.active : styles.inactive
              }`}
            >
              <div>
                <Text fw={700} size="sm" c="var(--text-primary)">
                  {room.isPermanent
                    ? "Permanent Room"
                    : room.status === "active"
                    ? "Party in Progress"
                    : "Room is Paused"}
                </Text>
                <Text size="xs" c="var(--text-secondary)" mt={4} style={{ lineHeight: 1.5 }}>
                  {room.isPermanent
                    ? "This room is saved forever. You and your friends can come back and watch together anytime."
                    : room.status === "active"
                    ? "People are currently in this room watching together."
                    : "Nobody is in the room right now. It automatically wakes up as soon as someone joins."}
                </Text>
              </div>
            </div>

            {room.status === "active" && !room.isPermanent && room.expiresAt && (
              <div style={{ marginBottom: "20px" }}>
                <div className={styles.countdownBig}>
                  {expiresInText || "—"}
                </div>
                <div className={styles.countdownLabel}>Time left until room closes</div>
                {isOpenable && (
                  <Button
                    variant="light"
                    color="violet"
                    size="sm"
                    fullWidth
                    mt="md"
                    onClick={handleExtend}
                    loading={isExtending}
                  >
                    Add 1 More Hour
                  </Button>
                )}
              </div>
            )}

            <div className={styles.tileGrid} style={{ gridTemplateColumns: "1fr" }}>
              <div className={styles.tile}>
                <span className={styles.tileLabel}>Last Used</span>
                <span className={styles.tileValue}>
                  {room.lifecycleEvents && room.lifecycleEvents.length > 0
                    ? new Date(room.lifecycleEvents[0].timestamp).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Never used yet"}
                </span>
              </div>

              <div className={styles.tile}>
                <span className={styles.tileLabel}>Auto-Start</span>
                <span className={styles.tileValue}>Starts when someone joins</span>
              </div>
            </div>
          </div>

          {/* Card 5: Activity History */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <div className={styles.cardTitleIconWrap}>
                  <IconActivity size={18} />
                </div>
                <span>Activity History</span>
              </div>
            </div>

            {room.lifecycleEvents && room.lifecycleEvents.length > 0 ? (
              <div className={styles.timeline}>
                {room.lifecycleEvents.slice(0, 6).map((event, index) => (
                  <div key={event.id || index} className={styles.timelineItem}>
                    {index < Math.min(room.lifecycleEvents.length, 6) - 1 && (
                      <div className={styles.timelineLine} />
                    )}
                    <div className={styles.timelineNode}>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: "var(--color-violet)",
                        }}
                      />
                    </div>
                    <div className={styles.timelineBody}>
                      <div className={styles.timelineTitle}>{event.event}</div>
                      <div className={styles.timelineTime}>
                        {new Date(event.timestamp).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyStateContainer}>
                <div className={styles.emptyStateIconWrap}>
                  <IconActivity size={22} color="var(--color-violet)" />
                </div>
                <Text fw={600} size="sm" c="var(--text-primary)">
                  No Activity Recorded
                </Text>
                <Text size="xs" c="dimmed" ta="center" style={{ maxWidth: 260 }}>
                  Room events, status changes, and participant activity will appear here.
                </Text>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal opened={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Delete Room" centered>
        <Text size="sm" mb="lg">
          Are you sure you want to delete <strong>{room.roomTitle || room.roomId}</strong> forever? You will not be able to get it back.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteConfirm(false)}>
            Keep Room
          </Button>
          <Button color="red" onClick={handleDelete} loading={isDeleting}>
            Delete Room
          </Button>
        </Group>
      </Modal>

      {/* EDIT ROOM MODAL */}
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
