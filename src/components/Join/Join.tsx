import React, { useContext, useEffect, useMemo, useState } from "react";
import { useHistory, useParams, Link } from "react-router-dom";
import {
  Button,
  Text,
  TextInput,
  PasswordInput,
  Badge,
  Avatar,
  Loader,
  Center,
} from "@mantine/core";
import {
  IconArrowRight,
  IconUsers,
  IconLink,
  IconAlertCircle,
  IconLock,
  IconShield,
  IconVideo,
  IconPlayerPlay,
  IconLogin,
  IconUser,
  IconMail,
} from "@tabler/icons-react";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { safeGetSession } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
import styles from "./Join.module.css";

interface JoinRouteParams {
  roomId?: string;
}

interface RoomInfo {
  roomId: string;
  roomTitle: string;
  roomDescription?: string;
  coverPhoto?: string | null;
  status: "active" | "inactive" | "expired" | string;
  requiresPasscode: boolean;
  participantsLocked?: boolean;
  maxParticipants?: number;
  isOwner: boolean;
}

const normalizeRoomId = (value: string): string => {
  let clean = value.trim();
  if (clean.includes("/watch/")) {
    clean = clean.split("/watch/")[1]?.split("?")[0] || clean;
  } else if (clean.includes("/join/")) {
    clean = clean.split("/join/")[1]?.split("?")[0] || clean;
  }
  return clean.replace(/^https?:\/\/[^/]+\/?/, "").replace(/^\/+|\/+$/g, "").split("?")[0];
};

export const Join: React.FC = () => {
  const history = useHistory();
  const { roomId: routeRoomId } = useParams<JoinRouteParams>();
  const { user } = useContext(MetadataContext);

  const cleanRouteRoomId = useMemo(
    () => (routeRoomId ? normalizeRoomId(routeRoomId) : ""),
    [routeRoomId]
  );

  // Generic room ID input for /join without route params
  const [inputRoomId, setInputRoomId] = useState("");

  // INVARIANT: Passcode state is STRICTLY initialized to empty string.
  // Any passcode query parameters in the URL are completely ignored, never copied into state,
  // never prefilled into fields, and never submitted automatically.
  const [passcode, setPasscode] = useState("");

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [formError, setFormError] = useState("");

  useDocumentMetadata({
    title: roomInfo?.roomTitle
      ? `Join ${roomInfo.roomTitle} | CoWatch`
      : "Join a Watch Party | CoWatch",
    description: "Enter room passcode to join a CoWatch synchronized watch party.",
  });

  // Fetch room metadata when cleanRouteRoomId changes
  useEffect(() => {
    if (!cleanRouteRoomId) {
      setRoomInfo(null);
      setLoadingRoom(false);
      setRoomError("");
      return;
    }

    let isCancelled = false;
    setLoadingRoom(true);
    setRoomError("");
    setFormError("");

    setPasscode("");

    const fetchRoom = async () => {
      try {
        const session = await safeGetSession(1000);
        const token = session?.data?.session?.access_token;
        const uid = session?.data?.session?.user?.id;

        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (uid) headers["x-user-id"] = uid;

        const res = await fetch(
          `${serverPath}/roomInfo/${encodeURIComponent(cleanRouteRoomId)}`,
          { headers }
        );

        if (isCancelled) return;

        if (res.status === 404) {
          setRoomError("This room does not exist or has expired.");
          setLoadingRoom(false);
          return;
        }

        if (!res.ok) {
          setRoomError("Unable to retrieve room information.");
          setLoadingRoom(false);
          return;
        }

        const data: RoomInfo = await res.json();
        if (isCancelled) return;

        setRoomInfo(data);
        setLoadingRoom(false);
      } catch (err) {
        if (isCancelled) return;
        setRoomError("Network error while connecting to room gateway.");
        setLoadingRoom(false);
      }
    };

    fetchRoom();

    return () => {
      isCancelled = true;
    };
  }, [cleanRouteRoomId]);

  // Handle submit for generic /join page (user enters room code / link)
  const handleGenericSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");

    const normalized = normalizeRoomId(inputRoomId);
    if (!normalized) {
      setFormError("Enter a room ID or invite link to continue.");
      return;
    }

    if (normalized.length > 200) {
      setFormError("That room ID is too long.");
      return;
    }

    history.push(`/join/${encodeURIComponent(normalized)}`);
  };

  // Handle submit on the specific room gateway (/join/:roomId)
  const handleGatewaySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");

    if (!cleanRouteRoomId) return;

    // Check user authentication
    const joinPath = `/join/${encodeURIComponent(cleanRouteRoomId)}`;
    if (user === undefined) {
      return;
    }

    if (!user) {
      history.push(`/login?redirect=${encodeURIComponent(joinPath)}`);
      return;
    }

    if (user.email_confirmed_at == null) {
      history.push(`/verify-email?next=${encodeURIComponent(joinPath)}`);
      return;
    }

    // If caller is host, advance directly to preflight green room
    if (roomInfo?.isOwner) {
      history.push(`/preflight/${encodeURIComponent(cleanRouteRoomId)}`);
      return;
    }

    if (roomInfo?.status === "expired") {
      setFormError("This room session has expired.");
      return;
    }

    if (roomInfo?.participantsLocked) {
      setFormError("This room is currently locked to new participants by the host.");
      return;
    }

    // Participant verification
    const cleanPass = passcode.trim();
    if (!cleanPass) {
      setFormError("Passcode is required to enter this room.");
      return;
    }

    if (cleanPass.length !== 8) {
      setFormError("Passcode must be strictly 8 characters.");
      return;
    }

    setVerifying(true);

    try {
      const session = await safeGetSession(1000);
      const token = session?.data?.session?.access_token;
      const uid = session?.data?.session?.user?.id;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (uid) headers["x-user-id"] = uid;

      const resp = await fetch(`${serverPath}/verifyPasscode`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          roomId: cleanRouteRoomId,
          passcode: cleanPass,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      setVerifying(false);

      if (resp.status === 429) {
        setFormError(
          data.error ||
          "Too many passcode attempts. Please wait a few minutes before trying again."
        );
        return;
      }

      if (resp.status === 401 || !resp.ok || !data.valid) {
        setFormError(data.error || "Incorrect room passcode. Please try again.");
        return;
      }

      // Pre-navigation gate succeeded:
      // Advance to Green Room (preflight) passing passcode strictly via route state.
      // Passcode is never written to sessionStorage or localStorage.
      // Socket.IO performs authoritative second verification against the database hash upon room entry.
      history.push(`/preflight/${encodeURIComponent(cleanRouteRoomId)}`, {
        passcode: cleanPass,
      });
    } catch (err) {
      setVerifying(false);
      setFormError("Network error verifying passcode. Please try again.");
    }
  };

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Guest Participant";

  return (
    <div className={styles.page}>
      {/* Minimal Header */}
      <header className={styles.header}>
        <Link to="/" className={styles.brandLink}>
          <img src="/logo192.png" alt="CoWatch" className={styles.logo} />
          <span className={styles.brandName}>CoWatch</span>
        </Link>
        <div className={styles.headerActions}>
          <Link to="/faq" className={styles.headerLink}>
            Support
          </Link>
          {user ? (
            <Button
              component={Link}
              to="/create"
              size="xs"
              variant="default"
              className={styles.headerBtn}
            >
              Create Room
            </Button>
          ) : (
            <Button
              component={Link}
              to={`/login?redirect=${encodeURIComponent(
                cleanRouteRoomId ? `/join/${encodeURIComponent(cleanRouteRoomId)}` : "/join"
              )}`}
              size="xs"
              variant="default"
              className={styles.headerAuthBtn}
            >
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className={styles.main}>
        <div className={styles.contentWrapper}>
          {cleanRouteRoomId ? (
            /* Gateway Screen for Specific Room */
            loadingRoom ? (
              <Center style={{ minHeight: 280, flexDirection: "column", gap: 16 }}>
                <Loader color="violet" size="lg" />
                <Text size="sm" c="dimmed">
                  Connecting to room...
                </Text>
              </Center>
            ) : roomError ? (
              <div className={styles.errorCard}>
                <IconAlertCircle size={38} className={styles.errorIcon} />
                <h2 className={styles.errorTitle}>Room Unavailable</h2>
                <p className={styles.errorDesc}>{roomError}</p>
                <Button component={Link} to="/join" variant="default" size="sm">
                  Try Another Room
                </Button>
              </div>
            ) : (
              <>
                {/* Room Preview Card */}
                {roomInfo && (
                  <div className={styles.roomPreviewCard}>
                    {roomInfo.coverPhoto ? (
                      <img
                        src={roomInfo.coverPhoto}
                        alt={roomInfo.roomTitle}
                        className={styles.roomCover}
                      />
                    ) : (
                      <div className={styles.roomCoverFallback}>
                        <IconVideo size={36} stroke={1.5} />
                      </div>
                    )}
                    <div className={styles.roomCardContent}>
                      <div className={styles.roomCardHeader}>
                        <div className={styles.roomTitleRow}>
                          <h1 className={styles.roomTitle}>{roomInfo.roomTitle}</h1>
                          <span className={styles.roomIdBadge}>
                            {roomInfo.roomId}
                          </span>
                        </div>
                        <Badge
                          color={
                            roomInfo.status === "active"
                              ? "green"
                              : roomInfo.status === "expired"
                                ? "red"
                                : "yellow"
                          }
                          variant="light"
                          size="sm"
                        >
                          {roomInfo.status === "active"
                            ? "ACTIVE"
                            : roomInfo.status === "expired"
                              ? "EXPIRED"
                              : "WAITING"}
                        </Badge>
                      </div>
                      {roomInfo.roomDescription && (
                        <p className={styles.roomDescription}>
                          {roomInfo.roomDescription}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* User Identity Preview */}
                {user ? (
                  <div className={styles.identityPreview}>
                    <Avatar
                      src={user.user_metadata?.avatar_url}
                      radius="xl"
                      size="sm"
                      color="violet"
                    >
                      {displayName.charAt(0).toUpperCase()}
                    </Avatar>
                    <div className={styles.identityTextGroup}>
                      <span className={styles.identityLabel}>Joining As</span>
                      <span className={styles.identityName}>{displayName}</span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.identityPreview}>
                    <Avatar radius="xl" size="sm" color="gray">
                      <IconUser size={15} />
                    </Avatar>
                    <div className={styles.identityTextGroup}>
                      <span className={styles.identityLabel}>Account</span>
                      <span className={styles.identityName}>
                        Guest · Sign in required to enter
                      </span>
                    </div>
                  </div>
                )}

                {/* Host Direct Action or Participant Passcode Entry Form */}
                <form
                  onSubmit={handleGatewaySubmit}
                  className={styles.form}
                  noValidate
                >
                  {roomInfo?.isOwner ? (
                    <div className={styles.ownerNotice}>
                      <div className={styles.ownerNoticeIconBox}>
                        <IconShield size={18} />
                      </div>
                      <div className={styles.ownerNoticeContent}>
                        <span className={styles.ownerNoticeTitle}>
                          You're the host
                        </span>
                        <span className={styles.ownerNoticeDesc}>
                          You can start and control this session.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.inputWrapper}>
                      {roomInfo?.participantsLocked && (
                        <div
                          className={styles.inlineError}
                          style={{
                            marginBottom: 12,
                            background: "rgba(245, 159, 0, 0.1)",
                            borderColor: "rgba(245, 159, 0, 0.3)",
                            color: "var(--color-warning)",
                          }}
                          role="alert"
                        >
                          <IconLock size={16} stroke={1.8} />
                          <span>This room is currently locked to new participants by the host.</span>
                        </div>
                      )}
                      <div className={styles.passcodeHeader}>
                        <span className={styles.passcodeTitle}>Room Passcode</span>
                        <span className={styles.passcodeSubtitle}>
                          {user
                            ? "Enter the passcode shared by the host."
                            : "Enter the room passcode to continue."}
                        </span>
                      </div>
                      <PasswordInput
                        placeholder="Enter 8-character passcode"
                        value={passcode}
                        minLength={8}
                        maxLength={8}
                        onChange={(event) => {
                          setPasscode(event.currentTarget.value.slice(0, 8));
                          if (formError) setFormError("");
                        }}
                        disabled={roomInfo?.participantsLocked || verifying}
                        required
                        size="md"
                        leftSection={<IconLock size={18} stroke={1.5} />}
                        aria-invalid={Boolean(formError)}
                        aria-describedby={
                          formError ? "join-error-message" : undefined
                        }
                      />
                      {formError && (
                        <div
                          id="join-error-message"
                          className={styles.inlineError}
                          role="alert"
                        >
                          <IconAlertCircle size={15} stroke={1.8} />
                          <span>{formError}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="md"
                    fullWidth
                    variant="gradient"
                    gradient={{ from: "violet", to: "indigo", deg: 135 }}
                    rightSection={
                      roomInfo?.isOwner ? (
                        <IconPlayerPlay size={18} />
                      ) : !user ? (
                        <IconLogin size={18} />
                      ) : user.email_confirmed_at == null ? (
                        <IconMail size={18} />
                      ) : (
                        <IconArrowRight size={18} />
                      )
                    }
                    loading={verifying}
                    disabled={
                      verifying ||
                      roomInfo?.status === "expired" ||
                      (!roomInfo?.isOwner && Boolean(roomInfo?.participantsLocked))
                    }
                    className={styles.submitBtn}
                  >
                    {roomInfo?.isOwner
                      ? "Start Room"
                      : roomInfo?.status === "expired"
                        ? "Room Expired"
                        : roomInfo?.participantsLocked
                          ? "Room Locked"
                          : !user
                            ? "Sign in to Join"
                            : user.email_confirmed_at == null
                              ? "Verify Email to Join"
                              : verifying
                                ? "Entering..."
                                : "Enter Watch Room"}
                  </Button>
                </form>
              </>
            )
          ) : (
            /* Generic /join screen to enter room code or paste link */
            <>
              <div className={styles.iconWrap} aria-hidden="true">
                <IconUsers size={26} stroke={1.8} />
              </div>

              <h1 className={styles.title}>Join a Room</h1>
              <p className={styles.subtitle}>
                Enter your room code or paste an invite link to jump in.
              </p>

              <form
                onSubmit={handleGenericSubmit}
                className={styles.form}
                noValidate
              >
                <div className={styles.inputWrapper}>
                  <TextInput
                    label="Room Code or Invite Link"
                    placeholder="e.g. room-alpha-123 or https://cowatch.tv/join/..."
                    value={inputRoomId}
                    onChange={(event) => {
                      setInputRoomId(event.currentTarget.value);
                      if (formError) setFormError("");
                    }}
                    required
                    maxLength={300}
                    size="md"
                    leftSection={<IconLink size={18} stroke={1.5} />}
                    aria-invalid={Boolean(formError)}
                    aria-describedby={
                      formError ? "generic-error-message" : undefined
                    }
                  />
                  {formError && (
                    <div
                      id="generic-error-message"
                      className={styles.inlineError}
                      role="alert"
                    >
                      <IconAlertCircle size={15} stroke={1.8} />
                      <span>{formError}</span>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  fullWidth
                  variant="gradient"
                  gradient={{ from: "violet", to: "indigo", deg: 135 }}
                  rightSection={<IconArrowRight size={18} />}
                  className={styles.submitBtn}
                >
                  Continue to Room
                </Button>
              </form>
            </>
          )}

          <div className={styles.legalLinksRow}>
            <Link to="/terms" className={styles.legalLink}>
              Terms
            </Link>
            <span className={styles.legalDot}>·</span>
            <Link to="/privacy" className={styles.legalLink}>
              Privacy
            </Link>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className={styles.footer}>
        <span className={styles.copyright}>
          © {new Date().getFullYear()} CoWatch
        </span>
        <div className={styles.footerLinks}>
          <Link to="/privacy" className={styles.footerLink}>
            Privacy
          </Link>
          <Link to="/terms" className={styles.footerLink}>
            Terms
          </Link>
          <Link to="/faq" className={styles.footerLink}>
            Support
          </Link>
        </div>
      </footer>
    </div>
  );
};
