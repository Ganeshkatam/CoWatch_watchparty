import React, { useContext, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useHistory, useParams, Link, useLocation } from "react-router-dom";
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
import { WaitingForHost } from "../App/WaitingForHost";
import { MediaPreflight, type PreflightPreferences } from "../Preflight/MediaPreflight";
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
  isHost: boolean;
  isHostPresent?: boolean;
  hostName?: string;
}

type AdmissionStage = "validating" | "passcode" | "preflight" | "waiting" | "ready" | "error";

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
  const location = useLocation();
  const { roomId: routeRoomId } = useParams<JoinRouteParams>();
  const { user } = useContext(MetadataContext);

  const cleanRouteRoomId = useMemo(
    () => (routeRoomId ? normalizeRoomId(routeRoomId) : ""),
    [routeRoomId]
  );

  // Generic room ID input for /join without route params
  const [inputRoomId, setInputRoomId] = useState("");

  // Pre-fill the passcode from the URL hash fragment if present.
  // Hash fragment (#passcode=...) is never sent to the server in HTTP requests.
  const hashParams = useMemo(() => new URLSearchParams(location.hash.replace(/^#/, "")), [location.hash]);
  const initialPasscode = hashParams.get("passcode") || "";
  const [passcode, setPasscode] = useState(initialPasscode);

  const [stage, setStage] = useState<AdmissionStage>("validating");
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [roomError, setRoomError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [formError, setFormError] = useState("");

  // Stable client session ID across admission lifecycle
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  // Server-issued admission token
  const admissionTokenRef = useRef<string>("");
  // Media device preferences captured from preflight
  const preferencesRef = useRef<PreflightPreferences | null>(null);
  // Single-flight guard against concurrent transitions
  const transitioningRef = useRef<boolean>(false);

  useDocumentMetadata({
    title: roomInfo?.roomTitle
      ? `Join ${roomInfo.roomTitle} | CoWatch`
      : "Join a Watch Party | CoWatch",
    description: "Join a CoWatch synchronized watch party.",
  });

  const navigateToWatch = useCallback(() => {
    if (transitioningRef.current && stage === "ready") return;
    transitioningRef.current = true;
    setStage("ready");

    const prefs = preferencesRef.current;
    history.push(`/watch/${encodeURIComponent(cleanRouteRoomId)}`, {
      admissionToken: admissionTokenRef.current,
      sessionId: sessionIdRef.current,
      initialCameraOn: prefs?.initialCameraOn ?? false,
      initialMicOn: prefs?.initialMicOn ?? false,
      cameraDeviceId: prefs?.cameraDeviceId,
      micDeviceId: prefs?.micDeviceId,
      speakerDeviceId: prefs?.speakerDeviceId,
    });
  }, [cleanRouteRoomId, history, stage]);

  // Fetch room metadata and start admission state machine
  useEffect(() => {
    if (!cleanRouteRoomId) {
      setRoomInfo(null);
      setStage("validating");
      setRoomError("");
      return;
    }

    let isCancelled = false;
    setStage("validating");
    setRoomError("");
    setFormError("");
    transitioningRef.current = false;

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
          setStage("error");
          return;
        }

        if (!res.ok) {
          setRoomError("Unable to retrieve room information.");
          setStage("error");
          return;
        }

        const data: RoomInfo = await res.json();
        if (isCancelled) return;

        setRoomInfo(data);

        // Host / Owner admission bypass:
        // Host has authority over room and does not require participant passcode/admission token.
        if (data.isHost) {
          if (data.status === "active") {
            history.replace(`/watch/${encodeURIComponent(cleanRouteRoomId)}`);
            return;
          }
          // Inactive room: Host sees waiting/start session screen
          setStage("waiting");
          return;
        }

        // Participant admission checks:
        if (user === undefined) {
          // Wait for auth context to settle
          return;
        }

        const joinPath = `/join/${encodeURIComponent(cleanRouteRoomId)}`;
        if (!user) {
          history.push(`/login?redirect=${encodeURIComponent(joinPath)}`);
          return;
        }

        if (user.email_confirmed_at == null) {
          history.push(`/verify-email?next=${encodeURIComponent(joinPath)}`);
          return;
        }

        if (data.status === "expired") {
          setRoomError("This room session has expired.");
          setStage("error");
          return;
        }

        if (data.participantsLocked) {
          setRoomError("This room is currently locked to new participants by the host.");
          setStage("error");
          return;
        }

        // Admission control paths:
        if (data.requiresPasscode) {
          setStage("passcode");
        } else {
          // Participant (No-passcode): obtain server-issued admission token directly
          try {
            const verifyResp = await fetch(`${serverPath}/verifyPasscode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(uid ? { "x-user-id": uid } : {}),
              },
              body: JSON.stringify({
                roomId: cleanRouteRoomId,
                sessionId: sessionIdRef.current,
              }),
            });

            if (isCancelled) return;
            const verifyData = await verifyResp.json().catch(() => ({}));

            if (verifyResp.ok && verifyData.valid && verifyData.admissionToken) {
              admissionTokenRef.current = verifyData.admissionToken;
              setStage("preflight");
            } else {
              setRoomError(verifyData.error || "Room admission authorization failed.");
              setStage("error");
            }
          } catch {
            if (!isCancelled) {
              setRoomError("Network error during room authorization.");
              setStage("error");
            }
          }
        }
      } catch {
        if (!isCancelled) {
          setRoomError("Network error while connecting to room gateway.");
          setStage("error");
        }
      }
    };

    fetchRoom();

    return () => {
      isCancelled = true;
    };
  }, [cleanRouteRoomId, user, history]);

  // HTTP Polling while in Waiting stage:
  // Invariant: ZERO Socket.IO connections are ever created during waiting.
  // Polling checks room.status === "active", and transitions once active with single-flight guard.
  useEffect(() => {
    if (stage !== "waiting" || !cleanRouteRoomId) return;

    let isCancelled = false;
    const interval = window.setInterval(async () => {
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
        if (!res.ok || isCancelled) return;
        const freshData: RoomInfo = await res.json();
        if (isCancelled) return;

        if (freshData.status === "active") {
          setRoomInfo(freshData);
          if (!transitioningRef.current) {
            transitioningRef.current = true;
            if (freshData.isHost) {
              history.replace(`/watch/${encodeURIComponent(cleanRouteRoomId)}`);
            } else {
              navigateToWatch();
            }
          }
        }
      } catch {
        // Silent poll
      }
    }, 3000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [stage, cleanRouteRoomId, history, navigateToWatch]);

  const handleStartRoom = async () => {
    if (!cleanRouteRoomId) return;
    try {
      const session = await safeGetSession(1000);
      const token = session?.data?.session?.access_token;
      if (!token) {
        setFormError("Authentication required to start session.");
        return;
      }
      const resp = await fetch(`${serverPath}/startRoom`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId: cleanRouteRoomId }),
      });
      const resData = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setFormError(resData?.error?.message || "Failed to start room session.");
        return;
      }
      history.replace(`/watch/${encodeURIComponent(cleanRouteRoomId)}`);
    } catch {
      setFormError("Network error while starting room session.");
    }
  };

  const handleStatusCheck = async () => {
    if (!cleanRouteRoomId) return;
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
      if (res.ok) {
        const fresh = await res.json();
        setRoomInfo(fresh);
        if (fresh.status === "active" && !transitioningRef.current) {
          transitioningRef.current = true;
          if (fresh.isHost) {
            history.replace(`/watch/${encodeURIComponent(cleanRouteRoomId)}`);
          } else {
            navigateToWatch();
          }
        }
      }
    } catch {}
  };

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

  // Handle participant passcode verification
  const handlePasscodeSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");

    if (!cleanRouteRoomId) return;

    const joinPath = `/join/${encodeURIComponent(cleanRouteRoomId)}`;
    if (user === undefined) return;

    if (!user) {
      history.push(`/login?redirect=${encodeURIComponent(joinPath)}`);
      return;
    }

    if (user.email_confirmed_at == null) {
      history.push(`/verify-email?next=${encodeURIComponent(joinPath)}`);
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
          sessionId: sessionIdRef.current,
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

      // Success: store cryptographically signed admission token and advance to preflight
      admissionTokenRef.current = data.admissionToken;
      setStage("preflight");
    } catch {
      setVerifying(false);
      setFormError("Network error verifying passcode. Please try again.");
    }
  };

  const handlePreflightComplete = useCallback(
    (prefs: PreflightPreferences) => {
      preferencesRef.current = prefs;
      if (roomInfo?.status === "active") {
        navigateToWatch();
      } else {
        setStage("waiting");
      }
    },
    [roomInfo?.status, navigateToWatch]
  );

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Participant";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div
          className={
            stage === "preflight"
              ? styles.preflightWrapper
              : styles.contentWrapper
          }
        >
          {cleanRouteRoomId ? (
            stage === "validating" ? (
              <Center style={{ minHeight: 280, flexDirection: "column", gap: 16 }}>
                <Loader color="violet" size="lg" />
                <Text size="sm" c="dimmed">
                  Verifying room admission...
                </Text>
              </Center>
            ) : stage === "error" ? (
              <div className={styles.errorCard}>
                <IconAlertCircle size={38} className={styles.errorIcon} />
                <h2 className={styles.errorTitle}>Room Unavailable</h2>
                <p className={styles.errorDesc}>{roomError}</p>
                <Button component={Link} to="/join" variant="default" size="sm">
                  Try Another Room
                </Button>
              </div>
            ) : stage === "waiting" ? (
              <WaitingForHost
                isInline={true}
                roomId={cleanRouteRoomId}
                roomTitle={roomInfo?.roomTitle || cleanRouteRoomId}
                hostName={roomInfo?.hostName}
                isOwner={Boolean(roomInfo?.isHost)}
                onCheckStatus={handleStatusCheck}
                onStartSession={roomInfo?.isHost ? handleStartRoom : undefined}
              />
            ) : stage === "preflight" ? (
              <MediaPreflight
                roomId={cleanRouteRoomId}
                isInline={true}
                onComplete={handlePreflightComplete}
              />
            ) : stage === "ready" ? (
              <Center style={{ minHeight: 280, flexDirection: "column", gap: 16 }}>
                <Loader color="violet" size="lg" />
                <Text size="sm" c="dimmed">
                  Entering watch party...
                </Text>
              </Center>
            ) : (
              /* Passcode Stage */
              <>
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

                <form
                  onSubmit={handlePasscodeSubmit}
                  className={styles.form}
                  noValidate
                >
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

                  <Button
                    type="submit"
                    size="md"
                    fullWidth
                    variant="gradient"
                    gradient={{ from: "violet", to: "indigo", deg: 135 }}
                    rightSection={
                      roomInfo?.isHost ? (
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
                      Boolean(roomInfo?.participantsLocked)
                    }
                    className={styles.submitBtn}
                  >
                    {roomInfo?.status === "expired"
                      ? "Room Expired"
                      : roomInfo?.participantsLocked
                        ? "Room Locked"
                        : !user
                          ? "Sign in to Join"
                          : user.email_confirmed_at == null
                            ? "Verify Email to Join"
                            : "Continue to Setup"}
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
        </div>
      </main>
    </div>
  );
};
