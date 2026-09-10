import React, { useContext, useEffect, useRef, useState } from "react";
import { useHistory, Link } from "react-router-dom";
import {
  Button,
  Badge,
  Avatar,
  Loader,
  Center,
  ActionIcon,
  Tooltip,
  Popover,
  Select,
} from "@mantine/core";
import {
  IconArrowRight,
  IconVideo,
  IconVideoOff,
  IconMicrophone,
  IconMicrophoneOff,
  IconVolume,
  IconVolume2,
  IconSettings,
  IconCheck,
  IconAlertTriangle,
  IconPlayerPlay,
  IconChevronLeft,
} from "@tabler/icons-react";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { safeGetSession } from "../../utils/supabaseClient";
import { serverPath } from "../../utils/utils";
import {
  enumerateMediaDevices,
  stopMediaStream,
  createMicVolumeMonitor,
  playSpeakerTestSound,
  testAutoplayDiagnostic,
  type AutoplayDiagnosticResult,
} from "../../utils/mediaPreflight";
import styles from "./MediaPreflight.module.css";

interface MediaPreflightProps {
  roomId: string;
  location?: any;
}

interface RoomInfo {
  roomId: string;
  roomTitle: string;
  roomDescription?: string;
  coverPhoto?: string | null;
  status: "active" | "inactive" | "expired" | string;
  requiresPasscode: boolean;
  isOwner: boolean;
}

export const MediaPreflight: React.FC<MediaPreflightProps> = ({
  roomId: rawRoomId,
  location,
}) => {
  const history = useHistory();
  const { user, profile, setMetadata } = useContext(MetadataContext);

  const cleanRoomId = (rawRoomId || "").trim();

  // INVARIANT: Passcode is strictly read from transient route state.
  // It is NEVER persisted to or read from sessionStorage or localStorage.
  // If the user refreshes /preflight/:roomId, they are safely returned to /join/:roomId.
  const [passcode] = useState<string>(() => {
    return location?.state?.passcode || "";
  });

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(true);

  // Initial mute & camera preferences honor user profile or default to false
  const [isCameraOn, setIsCameraOn] = useState<boolean>(() => {
    return profile?.pref_camera_on ?? false;
  });
  const [isMicOn, setIsMicOn] = useState<boolean>(() => {
    return profile?.pref_mic_on ?? false;
  });

  // Device lists
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);

  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>("");
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>("");
  const [selectedSpeakerDevice, setSelectedSpeakerDevice] = useState<string>("");

  // Local preview stream
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Live audio level (0 - 100)
  const [micVolume, setMicVolume] = useState<number>(0);
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);

  // Diagnostics (Non-blocking)
  const [autoplayDiag, setAutoplayDiag] = useState<AutoplayDiagnosticResult | null>(null);

  useDocumentMetadata({
    title: roomInfo?.roomTitle
      ? `Green Room - ${roomInfo.roomTitle} | CoWatch`
      : "Green Room | CoWatch",
    description: "Prepare and test your audio and video devices before joining CoWatch.",
  });

  // 1. Fetch room details and enforce gateway security boundary
  useEffect(() => {
    if (!cleanRoomId) {
      history.replace("/join");
      return;
    }

    let isCancelled = false;

    const loadRoom = async () => {
      try {
        const session = await safeGetSession(1000);
        const token = session?.data?.session?.access_token;
        const uid = session?.data?.session?.user?.id;

        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (uid) headers["x-user-id"] = uid;

        const res = await fetch(
          `${serverPath}/roomInfo/${encodeURIComponent(cleanRoomId)}`,
          { headers }
        );

        if (isCancelled) return;

        if (!res.ok) {
          history.replace(`/join/${encodeURIComponent(cleanRoomId)}`);
          return;
        }

        const data: RoomInfo = await res.json();
        if (isCancelled) return;

        setRoomInfo(data);
        setLoadingRoom(false);

        // Invariant: If room requires a passcode, user is not host, and no passcode is present,
        // redirect back to Gateway where user must enter the passcode.
        if (data.requiresPasscode && !data.isOwner && !passcode) {
          history.replace(`/join/${encodeURIComponent(cleanRoomId)}`);
        }
      } catch (err) {
        if (!isCancelled) {
          history.replace(`/join/${encodeURIComponent(cleanRoomId)}`);
        }
      }
    };

    loadRoom();

    return () => {
      isCancelled = true;
    };
  }, [cleanRoomId, history, passcode]);

  // 2. Enumerate devices and run non-blocking diagnostics
  useEffect(() => {
    let isCancelled = false;

    const refreshDevices = async () => {
      const grouped = await enumerateMediaDevices();
      if (isCancelled) return;
      setAudioInputs(grouped.audioInputs);
      setVideoInputs(grouped.videoInputs);
      setAudioOutputs(grouped.audioOutputs);

      if (grouped.audioInputs.length > 0 && !selectedAudioDevice) {
        setSelectedAudioDevice(grouped.audioInputs[0].deviceId);
      }
      if (grouped.videoInputs.length > 0 && !selectedVideoDevice) {
        setSelectedVideoDevice(grouped.videoInputs[0].deviceId);
      }
      if (grouped.audioOutputs.length > 0 && !selectedSpeakerDevice) {
        setSelectedSpeakerDevice(grouped.audioOutputs[0].deviceId);
      }
    };

    refreshDevices();

    // Run diagnostics asynchronously without blocking UI
    testAutoplayDiagnostic().then((res) => {
      if (!isCancelled) setAutoplayDiag(res);
    });

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    }

    return () => {
      isCancelled = true;
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
      }
    };
  }, []);

  // 3. Acquire preview stream strictly honoring user preferences
  // Opening preflight does NOT prompt getUserMedia if both camera and mic are disabled
  useEffect(() => {
    let isCancelled = false;

    if (!isCameraOn && !isMicOn) {
      if (previewStream) {
        stopMediaStream(previewStream);
        setPreviewStream(null);
      }
      return;
    }

    const acquireStream = async () => {
      const constraints: MediaStreamConstraints = {
        video: isCameraOn
          ? selectedVideoDevice
            ? { deviceId: { exact: selectedVideoDevice } }
            : true
          : false,
        audio: isMicOn
          ? selectedAudioDevice
            ? { deviceId: { exact: selectedAudioDevice } }
            : true
          : false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (isCancelled) {
          stopMediaStream(stream);
          return;
        }

        // Clean up previous stream tracks
        if (previewStream) {
          stopMediaStream(previewStream);
        }

        setPreviewStream(stream);

        // Re-enumerate to get updated labels once permissions are granted
        const updated = await enumerateMediaDevices();
        if (!isCancelled) {
          setAudioInputs(updated.audioInputs);
          setVideoInputs(updated.videoInputs);
          setAudioOutputs(updated.audioOutputs);
        }
      } catch (err) {
        console.warn("Could not acquire preview stream:", err);
        if (isCancelled) return;
        if (isCameraOn && isMicOn) {
          // Fallback to audio-only if camera failed
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!isCancelled) {
              setPreviewStream(audioOnly);
              setIsCameraOn(false);
            }
          } catch {
            setIsCameraOn(false);
            setIsMicOn(false);
          }
        } else {
          setIsCameraOn(false);
          setIsMicOn(false);
        }
      }
    };

    acquireStream();

    return () => {
      isCancelled = true;
    };
  }, [isCameraOn, isMicOn, selectedAudioDevice, selectedVideoDevice]);

  // 4. Attach stream to video preview element and monitor volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = previewStream;
    }

    if (!previewStream || !isMicOn) {
      setMicVolume(0);
      return;
    }

    const cleanupMonitor = createMicVolumeMonitor(previewStream, (level) => {
      setMicVolume(level);
    });

    return () => {
      cleanupMonitor();
    };
  }, [previewStream, isMicOn]);

  // Clean up all preview stream tracks when unmounting
  useEffect(() => {
    return () => {
      if (previewStream) {
        stopMediaStream(previewStream);
      }
    };
  }, [previewStream]);

  // Toggle Camera
  const handleToggleCamera = () => {
    setIsCameraOn((prev) => !prev);
  };

  // Toggle Microphone
  const handleToggleMic = () => {
    setIsMicOn((prev) => !prev);
  };

  // Test Speaker Sound
  const handleTestSpeaker = async () => {
    if (isPlayingTestSound) return;
    setIsPlayingTestSound(true);
    await playSpeakerTestSound(selectedSpeakerDevice);
    setTimeout(() => {
      setIsPlayingTestSound(false);
    }, 700);
  };

  // Action: Join Watch Room
  const handleJoinRoom = () => {
    // 1. Release preflight stream so hardware turns off cleanly
    if (previewStream) {
      stopMediaStream(previewStream);
      setPreviewStream(null);
    }

    // 2. Persist preferences to profile & sessionStorage
    try {
      sessionStorage.setItem("cowatch_pref_camera", String(isCameraOn));
      sessionStorage.setItem("cowatch_pref_mic", String(isMicOn));
      if (setMetadata && profile) {
        setMetadata({
          profile: {
            ...profile,
            pref_camera_on: isCameraOn,
            pref_mic_on: isMicOn,
          },
        });
      }
    } catch (_) {}

    // 3. Navigate into /watch/:roomId with serializable preferences
    history.push(`/watch/${encodeURIComponent(cleanRoomId)}`, {
      passcode,
      initialCameraOn: isCameraOn,
      initialMicOn: isMicOn,
      cameraDeviceId: selectedVideoDevice || undefined,
      micDeviceId: selectedAudioDevice || undefined,
      speakerDeviceId: selectedSpeakerDevice || undefined,
    });
  };

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Participant";

  if (loadingRoom) {
    return (
      <div className={styles.page}>
        <Center style={{ minHeight: "100vh", flexDirection: "column", gap: 16 }}>
          <Loader color="violet" size="lg" />
        </Center>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Top Header */}
      <header className={styles.header}>
        <Link to="/" className={styles.brandLink}>
          <img src="/logo192.png" alt="CoWatch" className={styles.logo} />
          <span className={styles.brandName}>CoWatch</span>
        </Link>
        {roomInfo && (
          <div className={styles.headerRoomInfo}>
            <span className={styles.roomTitleText}>{roomInfo.roomTitle}</span>
            <span className={styles.roomIdBadge}>{roomInfo.roomId}</span>
          </div>
        )}
      </header>

      {/* Main Studio Viewport */}
      <main className={styles.main}>
        <div className={styles.studioContainer}>
          {/* Left Column: Preview Stage & Device Controls */}
          <div className={styles.stageCard}>
            <div className={styles.stageHeader}>
              <div>
                <h2 className={styles.stageTitle}>Green Room</h2>
                <p className={styles.stageSubtitle}>
                  Check your video framing and audio levels before entering.
                </p>
              </div>
              <Badge variant="light" color="violet" size="sm">
                PREVIEW
              </Badge>
            </div>

            {/* Video Preview Box */}
            <div className={styles.previewWrapper}>
              {isCameraOn ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={styles.previewVideo}
                />
              ) : (
                <div className={styles.cameraOffState}>
                  <div className={styles.avatarFallback}>
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className={styles.cameraOffLabel}>Camera is off</span>
                </div>
              )}

              {/* Real-time Floating Mic Volume Meter */}
              <div className={styles.liveMeterContainer}>
                {isMicOn ? (
                  <>
                    <IconMicrophone size={14} color="#10b981" />
                    <div className={styles.meterTrack}>
                      <div
                        className={styles.meterFill}
                        style={{ width: `${Math.max(6, micVolume)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <IconMicrophoneOff size={14} color="#f87171" />
                    <span className={styles.meterMutedText}>Muted</span>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Device Controls Toolbar */}
            <div className={styles.toolbar}>
              {/* Mic Toggle Button */}
              <Tooltip label={isMicOn ? "Mute Microphone" : "Unmute Microphone"} withArrow>
                <ActionIcon
                  size="xl"
                  radius="xl"
                  variant={isMicOn ? "filled" : "light"}
                  color={isMicOn ? "violet" : "red"}
                  onClick={handleToggleMic}
                  aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
                  className={styles.controlButton}
                >
                  {isMicOn ? <IconMicrophone size={20} /> : <IconMicrophoneOff size={20} />}
                </ActionIcon>
              </Tooltip>

              {/* Camera Toggle Button */}
              <Tooltip label={isCameraOn ? "Turn Off Camera" : "Turn On Camera"} withArrow>
                <ActionIcon
                  size="xl"
                  radius="xl"
                  variant={isCameraOn ? "filled" : "light"}
                  color={isCameraOn ? "violet" : "gray"}
                  onClick={handleToggleCamera}
                  aria-label={isCameraOn ? "Turn off camera" : "Turn on camera"}
                  className={styles.controlButton}
                >
                  {isCameraOn ? <IconVideo size={20} /> : <IconVideoOff size={20} />}
                </ActionIcon>
              </Tooltip>

              {/* Speaker Test Button */}
              <Tooltip label="Test Speaker Sound" withArrow>
                <ActionIcon
                  size="xl"
                  radius="xl"
                  variant="default"
                  loading={isPlayingTestSound}
                  onClick={handleTestSpeaker}
                  aria-label="Test speaker sound"
                  className={styles.controlButton}
                >
                  {isPlayingTestSound ? <IconVolume2 size={20} /> : <IconVolume size={20} />}
                </ActionIcon>
              </Tooltip>

              {/* Device Selector Popover */}
              <Popover width={320} position="top" withArrow shadow="md">
                <Popover.Target>
                  <Tooltip label="Device Settings" withArrow>
                    <ActionIcon
                      size="xl"
                      radius="xl"
                      variant="default"
                      aria-label="Audio and video device settings"
                      className={styles.controlButton}
                    >
                      <IconSettings size={20} />
                    </ActionIcon>
                  </Tooltip>
                </Popover.Target>
                <Popover.Dropdown>
                  <div className={styles.deviceSelectGroup}>
                    <Select
                      label="Microphone"
                      size="xs"
                      data={
                        audioInputs.length > 0
                          ? audioInputs.map((d, i) => ({
                              value: d.deviceId,
                              label: d.label || `Microphone ${i + 1}`,
                            }))
                          : [{ value: "default", label: "Default Microphone" }]
                      }
                      value={selectedAudioDevice}
                      onChange={(val) => val && setSelectedAudioDevice(val)}
                    />
                    <Select
                      label="Camera"
                      size="xs"
                      data={
                        videoInputs.length > 0
                          ? videoInputs.map((d, i) => ({
                              value: d.deviceId,
                              label: d.label || `Camera ${i + 1}`,
                            }))
                          : [{ value: "default", label: "Default Camera" }]
                      }
                      value={selectedVideoDevice}
                      onChange={(val) => val && setSelectedVideoDevice(val)}
                    />
                    {audioOutputs.length > 0 && (
                      <Select
                        label="Speaker / Output"
                        size="xs"
                        data={audioOutputs.map((d, i) => ({
                          value: d.deviceId,
                          label: d.label || `Speaker ${i + 1}`,
                        }))}
                        value={selectedSpeakerDevice}
                        onChange={(val) => val && setSelectedSpeakerDevice(val)}
                      />
                    )}
                    <Button
                      size="xs"
                      variant="light"
                      color="violet"
                      onClick={handleTestSpeaker}
                      loading={isPlayingTestSound}
                      leftSection={<IconVolume size={14} />}
                    >
                      Play Test Tone
                    </Button>
                  </div>
                </Popover.Dropdown>
              </Popover>
            </div>
          </div>

          {/* Right Column: Room Info & Entry Action */}
          <div className={styles.infoCard}>
            <div className={styles.roomSummary}>
              <div className={styles.roomHeadline}>
                <h1 className={styles.roomTitle}>{roomInfo?.roomTitle}</h1>
                <Badge
                  color={
                    roomInfo?.status === "active"
                      ? "green"
                      : roomInfo?.status === "expired"
                      ? "red"
                      : "yellow"
                  }
                  variant="light"
                  size="sm"
                >
                  {roomInfo?.status === "active"
                    ? "ACTIVE"
                    : roomInfo?.status === "expired"
                    ? "EXPIRED"
                    : "WAITING"}
                </Badge>
              </div>
              {roomInfo?.roomDescription && (
                <p className={styles.roomDescription}>{roomInfo.roomDescription}</p>
              )}
            </div>

            {/* User Profile Badge */}
            <div className={styles.userPreview}>
              <Avatar
                src={user?.user_metadata?.avatar_url}
                radius="xl"
                size="md"
                color="violet"
              >
                {displayName.charAt(0).toUpperCase()}
              </Avatar>
              <div className={styles.userPreviewInfo}>
                <span className={styles.userLabel}>
                  {roomInfo?.isOwner ? "Joining as Host" : "Joining as"}
                </span>
                <span className={styles.userName}>{displayName}</span>
              </div>
            </div>

            {/* Non-blocking Diagnostic Status Matrix */}
            <div className={styles.diagnosticsSection}>
              <span className={styles.diagnosticsHeader}>System Readiness</span>
              <div className={styles.diagnosticsList}>
                {/* Camera diagnostic */}
                <div className={styles.diagnosticItem}>
                  <div className={styles.diagnosticLabel}>
                    <IconVideo size={15} />
                    <span>Camera</span>
                  </div>
                  <span className={styles.diagnosticStatus}>
                    {isCameraOn ? (
                      <Badge color="green" size="xs" variant="dot">
                        Ready
                      </Badge>
                    ) : (
                      <Badge color="gray" size="xs" variant="dot">
                        Off
                      </Badge>
                    )}
                  </span>
                </div>

                {/* Microphone diagnostic */}
                <div className={styles.diagnosticItem}>
                  <div className={styles.diagnosticLabel}>
                    <IconMicrophone size={15} />
                    <span>Microphone</span>
                  </div>
                  <span className={styles.diagnosticStatus}>
                    {isMicOn ? (
                      <Badge color="green" size="xs" variant="dot">
                        Active
                      </Badge>
                    ) : (
                      <Badge color="gray" size="xs" variant="dot">
                        Muted
                      </Badge>
                    )}
                  </span>
                </div>

                {/* Autoplay diagnostic */}
                <div className={styles.diagnosticItem}>
                  <div className={styles.diagnosticLabel}>
                    <IconPlayerPlay size={15} />
                    <span>Autoplay</span>
                  </div>
                  <span className={styles.diagnosticStatus}>
                    {autoplayDiag ? (
                      autoplayDiag.canAutoplay ? (
                        <Badge color="green" size="xs" variant="dot">
                          Ready
                        </Badge>
                      ) : (
                        <Tooltip label={autoplayDiag.message} withArrow>
                          <Badge color="yellow" size="xs" variant="dot">
                            Restricted
                          </Badge>
                        </Tooltip>
                      )
                    ) : (
                      <Loader size={10} color="gray" />
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className={styles.actions}>
              <Button
                size="md"
                fullWidth
                variant="gradient"
                gradient={{ from: "violet", to: "indigo", deg: 135 }}
                onClick={handleJoinRoom}
                rightSection={<IconArrowRight size={18} />}
                className={styles.joinButton}
              >
                Join Watch Room
              </Button>
              <Link
                to={`/join/${encodeURIComponent(cleanRoomId)}`}
                className={styles.backLink}
              >
                <IconChevronLeft size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                Back to Room Details
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
