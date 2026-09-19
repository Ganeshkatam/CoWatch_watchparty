import React from "react";
import { ActionIcon, Avatar, Button } from "@mantine/core";
import { Socket } from "socket.io-client";

import {
  formatTimestamp,
  getColorForStringHex,
  getDefaultPicture,
  iceServers,
  softWhite,
} from "../../utils/utils";
import { UserMenu } from "../UserMenu/UserMenu";
import { MetadataContext } from "../../MetadataContext";
import { operationCoordinator } from "../../utils/operationState";
import {
  IconCheck,
  IconChevronRight,
  IconDotsVertical,
  IconMicrophone,
  IconMicrophoneOff,
  IconScreenShare,
  IconUserPlus,
  IconVideo,
  IconVideoOff,
  IconX,
} from "@tabler/icons-react";
import styles from "./VideoChat.module.css";
import { InviteModal } from "../Modal/InviteModal";

interface VideoChatProps {
  socket: Socket;
  participants: User[];
  pictureMap: StringDict;
  nameMap: StringDict;
  tsMap: NumberDict;
  rosterUpdateTS: Number;
  hide?: boolean;
  owner: string | undefined;
  getLeaderTime: () => number;
  roomId?: string;
  passcode?: string;
  onOpenInviteModal?: () => void;
  initialCameraOn?: boolean;
  initialMicOn?: boolean;
  cameraDeviceId?: string;
  micDeviceId?: string;
  isHost?: boolean;
  currentHostClientId?: string;
  selfClientId?: string;
}

export class VideoChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string | null }
> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error: error?.message || "Video chat error" };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("VideoChat error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)" }}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: "8px" }}>
            Video chat encountered an issue
          </p>
          <Button
            size="xs"
            variant="light"
            color="violet"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry Video Chat
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export class VideoChat extends React.Component<VideoChatProps> {

  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;

  socket = this.props.socket;
  getSelfId = () => this.props.selfClientId || this.props.socket?.id || "";

  state = {
    isInviteModalOpen: false,
  };

  private handleOpenInvite = () => {
    const canInvite = Boolean(
      this.props.isHost ||
      (this.props.owner && this.context.user?.id && this.props.owner === this.context.user.id)
    );
    if (!canInvite) return;
    if (this.props.onOpenInviteModal) {
      this.props.onOpenInviteModal();
    } else {
      this.setState({ isInviteModalOpen: true });
    }
  };


  private lastPrefCameraOn: boolean = false;
  private lastPrefMicOn: boolean = false;

  componentDidMount() {
    this.lastPrefCameraOn =
      this.props.initialCameraOn !== undefined
        ? this.props.initialCameraOn
        : (this.context.profile?.pref_camera_on ?? false);
    this.lastPrefMicOn =
      this.props.initialMicOn !== undefined
        ? this.props.initialMicOn
        : (this.context.profile?.pref_mic_on ?? false);
    this.socket?.on("signal", this.handleSignal);

    if (typeof window !== "undefined" && window.cowatch) {
      window.cowatch.getVideoDiagnostics = (targetId?: string) => {
        const pcs = window.cowatch.videoPCs || {};
        const remoteStreams = window.cowatch.remoteStreams || {};
        const videoRefs = window.cowatch.videoRefs || {};
        const inspectId = targetId || Object.keys(pcs)[0];
        const pc = inspectId ? pcs[inspectId] : undefined;
        const stream = inspectId ? remoteStreams[inspectId] : undefined;
        const videoEl = inspectId ? videoRefs[inspectId] : undefined;
        return {
          inspectId,
          signalingState: pc?.signalingState,
          connectionState: pc?.connectionState,
          iceConnectionState: pc?.iceConnectionState,
          localTracks: window.cowatch.ourStream?.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })) || [],
          remoteTracks: stream?.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })) || [],
          videoWidth: videoEl?.videoWidth,
          videoHeight: videoEl?.videoHeight,
          paused: videoEl?.paused,
          readyState: videoEl?.readyState,
        };
      };
    }
  }

  componentWillUnmount() {
    this.socket?.off("signal", this.handleSignal);
    if (typeof window !== "undefined" && window.cowatch && window.cowatch.getVideoDiagnostics) {
      delete window.cowatch.getVideoDiagnostics;
    }
  }

  componentDidUpdate(prevProps: VideoChatProps) {
    if (this.props.socket !== prevProps.socket) {
      this.socket = this.props.socket;
      prevProps.socket?.off("signal", this.handleSignal);
      this.socket?.on("signal", this.handleSignal);
    }

    if (this.props.rosterUpdateTS !== prevProps.rosterUpdateTS) {
      this.updateWebRTC();
    }

    const currentPrefCamera = this.context.profile?.pref_camera_on ?? false;
    if (this.lastPrefCameraOn !== currentPrefCamera) {
      this.lastPrefCameraOn = currentPrefCamera;
      // If we are in a room and the preference diverges from our current stream state, apply the preference change
      if (window.cowatch.ourStream && currentPrefCamera !== Boolean(this.getVideoWebRTC())) {
        this.toggleVideoWebRTC();
      }
    }

    const currentPrefMic = this.context.profile?.pref_mic_on ?? false;
    if (this.lastPrefMicOn !== currentPrefMic) {
      this.lastPrefMicOn = currentPrefMic;
      // If we are in a room and the preference diverges from our current stream state, apply the preference change
      if (window.cowatch.ourStream && currentPrefMic !== Boolean(this.getAudioWebRTC())) {
        this.toggleAudioWebRTC();
      }
    }
  }

  emitUserMute = () => {
    this.socket.emit("CMD:userMute", { isMuted: !this.getAudioWebRTC() });
  };

  makingOffer: Record<string, boolean> = {};
  ignoreOffer: Record<string, boolean> = {};
  isSettingRemoteAnswerPending: Record<string, boolean> = {};

  handleSignal = async (data: any) => {
    // Handle messages received from signaling server
    const msg = data.msg;
    const from = data.from;
    const selfId = this.getSelfId();

    let pc = window.cowatch.videoPCs[from];
    if (!pc) {
      if (msg.sdp && msg.sdp.type === "answer") return;
      pc = this.createPeerConnection(from);
    }

    try {
      if (msg.sdp) {
        const polite = selfId > from;
        const readyForOffer =
          !this.makingOffer[from] &&
          (pc.signalingState === "stable" || this.isSettingRemoteAnswerPending[from]);
        const offerCollision = msg.sdp.type === "offer" && !readyForOffer;

        this.ignoreOffer[from] = !polite && offerCollision;
        if (this.ignoreOffer[from]) {
          return;
        }

        if (offerCollision) {
          try {
            await Promise.all([
              pc.setLocalDescription({ type: "rollback" }),
              pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)),
            ]);
          } catch (rbErr) {
            console.warn("Rollback handling error:", rbErr);
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          }
        } else {
          if (msg.sdp.type === "answer") {
            this.isSettingRemoteAnswerPending[from] = true;
          }
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          } finally {
            this.isSettingRemoteAnswerPending[from] = false;
          }
        }

        if (msg.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.sendSignal(from, { sdp: pc.localDescription });
        }

        const queue = window.cowatch.iceQueues[from];
        if (queue && queue.length > 0) {
          for (const candidate of queue) {
            try {
              await pc.addIceCandidate(candidate);
            } catch (err) {
              console.warn("Failed to add queued ICE candidate", err);
            }
          }
          window.cowatch.iceQueues[from] = [];
        }
      } else if (msg.ice !== undefined) {
        try {
          const candidate = new RTCIceCandidate(msg.ice);
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            window.cowatch.iceQueues[from] = window.cowatch.iceQueues[from] || [];
            window.cowatch.iceQueues[from].push(candidate);
          }
        } catch (err) {
          if (!this.ignoreOffer[from]) {
            console.warn("Error adding ICE candidate:", err);
          }
        }
      }
    } catch (err) {
      console.error("Signal handling error", err);
    }
  };

  setupWebRTC = async () => {
    try {
      let stream = new MediaStream([]);

      const prefCameraOn =
        this.props.initialCameraOn !== undefined
          ? this.props.initialCameraOn
          : (this.context.profile?.pref_camera_on ?? true);
      const prefMicOn =
        this.props.initialMicOn !== undefined
          ? this.props.initialMicOn
          : (this.context.profile?.pref_mic_on ?? true);

      if (prefCameraOn || prefMicOn) {
        try {
          const constraints: MediaStreamConstraints = {
            audio: prefMicOn
              ? (this.props.micDeviceId ? { deviceId: { exact: this.props.micDeviceId } } : true)
              : false,
            video: prefCameraOn
              ? (this.props.cameraDeviceId ? { deviceId: { exact: this.props.cameraDeviceId } } : true)
              : false,
          };
          stream = await navigator?.mediaDevices?.getUserMedia(constraints);
        } catch (e) {
          console.warn("Failed initial getUserMedia with audio+video, falling back:", e);
          try {
            stream = await navigator?.mediaDevices?.getUserMedia({
              audio: true,
              video: false,
            });
          } catch (fallbackErr) {
            console.warn("Audio-only fallback also failed or was denied:", fallbackErr);
          }
        }
      }

      window.cowatch.ourStream = stream;
      // Immediately synchronize local tracks to existing peer connections
      this.updateWebRTC();
      // alert server we've joined video chat
      this.socket?.emit("CMD:joinVideo");
      this.emitUserMute();
      this.forceUpdate();
    } catch (err) {
      console.error("Critical error in setupWebRTC:", err);
    }
  };

  stopWebRTC = () => {
    try {
      const ourStream = window.cowatch.ourStream;
      const videoPCs = window.cowatch.videoPCs;
      if (ourStream) {
        ourStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
      window.cowatch.ourStream = undefined;
      window.cowatch.remoteStreams = {};
      Object.keys(videoPCs).forEach((key) => {
        try {
          videoPCs[key]?.close();
        } catch (e) { }
        delete videoPCs[key];
      });
      this.socket?.emit("CMD:leaveVideo");
      this.forceUpdate();
    } catch (err) {
      console.error("Critical error in stopWebRTC:", err);
    }
  };
  addTrackToAllPCs = (track: MediaStreamTrack) => {
    const ourStream = window.cowatch.ourStream;
    const videoPCs = window.cowatch.videoPCs;
    if (!ourStream) return;
    Object.values(videoPCs).forEach((pc: any) => {
      const senders = pc.getSenders();
      if (!senders.find((s: any) => s.track === track)) {
        pc.addTrack(track, ourStream);
      }
    });
  };

  toggleVideoWebRTC = async () => {
    const ourStream = window.cowatch.ourStream;
    if (!ourStream) return;
    const videoTrack = ourStream.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = stream.getVideoTracks()[0];
        ourStream.addTrack(newTrack);
        this.addTrackToAllPCs(newTrack);
      } catch (e) {
        console.warn("Failed to acquire video track dynamically", e);
      }
    }
    this.forceUpdate();
  };

  getVideoWebRTC = () => {
    const ourStream = window.cowatch.ourStream;
    return ourStream && ourStream.getVideoTracks()[0]?.enabled;
  };

  toggleAudioWebRTC = async () => {
    const ourStream = window.cowatch.ourStream;
    if (!ourStream) return;
    const audioTrack = ourStream.getAudioTracks()[0];

    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newTrack = stream.getAudioTracks()[0];
        ourStream.addTrack(newTrack);
        this.addTrackToAllPCs(newTrack);
      } catch (e) {
        console.warn("Failed to acquire audio track dynamically", e);
      }
    }
    this.emitUserMute();
    this.forceUpdate();
  };

  getAudioWebRTC = () => {
    const ourStream = window.cowatch.ourStream;
    return (
      ourStream &&
      ourStream.getAudioTracks()[0] &&
      ourStream.getAudioTracks()[0].enabled
    );
  };

  createPeerConnection = (id: string) => {
    const existing = window.cowatch.videoPCs[id];
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    window.cowatch.videoPCs[id] = pc;
    window.cowatch.iceQueues[id] = [];
    
    const ourStream = window.cowatch.ourStream;
    const videoRefs = window.cowatch.videoRefs;

    // Attach Perfect Negotiation handler on both peers before adding tracks
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer[id] = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        this.sendSignal(id, { sdp: pc.localDescription });
      } catch (e) {
        console.warn("Negotiation error for peer", id, e);
      } finally {
        this.makingOffer[id] = false;
      }
    };

    // Add our own video as outgoing stream
    if (ourStream) {
      ourStream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, ourStream);
        } catch (e) {
          console.warn("Could not add track to pc:", e);
        }
      });
    }

    pc.onicecandidate = (event) => {
      // We generated an ICE candidate, send it to peer
      if (event.candidate) {
        this.sendSignal(id, { ice: event.candidate });
      }
    };

    pc.ontrack = (event: RTCTrackEvent) => {
      if (!window.cowatch.remoteStreams) {
        window.cowatch.remoteStreams = {};
      }
      let stream = window.cowatch.remoteStreams[id];
      if (!stream) {
        stream = event.streams?.[0] || new MediaStream();
        window.cowatch.remoteStreams[id] = stream;
      }
      if (!stream.getTracks().some((t: MediaStreamTrack) => t.id === event.track.id)) {
        stream.addTrack(event.track);
      }

      event.track.onunmute = () => {
        const videoEl = window.cowatch.videoRefs?.[id];
        if (videoEl && stream) {
          if (videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
          }
          videoEl.play().catch((err) => {
            console.warn("Playback retry on track onunmute deferred:", err);
          });
        }
      };

      const videoEl = window.cowatch.videoRefs?.[id];
      if (videoEl && stream) {
        try {
          if (videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
          }
          videoEl.play().catch((e) => {
            console.warn("Autoplay playback attempt deferred for remote peer", id, e);
          });
        } catch (e) {
          console.warn("Could not set remote stream on video element:", e);
        }
      }

      this.forceUpdate();
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === "connected" || iceState === "completed") {
        operationCoordinator.setPeerRtcStatus(id, "connected");
      } else if (iceState === "checking") {
        operationCoordinator.setPeerRtcStatus(id, "connecting");
      } else if (iceState === "disconnected") {
        operationCoordinator.setPeerRtcStatus(id, "disconnected");
      } else if (iceState === "failed") {
        operationCoordinator.setPeerRtcStatus(id, "failed");
        // ICE failed (permanently, not a temporary disconnection, which would be "disconnected"), tear down and attempt to re-establish
        try {
          pc.close();
        } catch (e) { }
        delete window.cowatch.videoPCs[id];
        delete window.cowatch.iceQueues[id];
        if (window.cowatch.remoteStreams) {
          delete window.cowatch.remoteStreams[id];
        }
        this.updateWebRTC();
      } else if (iceState === "closed") {
        operationCoordinator.setPeerRtcStatus(id, "closed");
      }
    };

    pc.onconnectionstatechange = () => {
      const connState = pc.connectionState;
      if (connState === "connected") {
        operationCoordinator.setPeerRtcStatus(id, "connected");
      } else if (connState === "connecting") {
        operationCoordinator.setPeerRtcStatus(id, "connecting");
      } else if (connState === "disconnected") {
        operationCoordinator.setPeerRtcStatus(id, "disconnected");
      } else if (connState === "failed") {
        operationCoordinator.setPeerRtcStatus(id, "failed");
      } else if (connState === "closed") {
        operationCoordinator.setPeerRtcStatus(id, "closed");
      }
    };

    return pc;
  };

  updateWebRTC = () => {
    try {
      const ourStream = window.cowatch.ourStream;
      const videoPCs = window.cowatch.videoPCs;
      const videoRefs = window.cowatch.videoRefs;
      if (!ourStream) {
        // We haven't started video chat, exit
        return;
      }
      const selfId = this.getSelfId();

      // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
      // This allows them to rejoin later
      const clientIds = new Set(
        this.props.participants.filter((p) => p.isVideoChat).map((p) => p.id),
      );
      Object.entries(videoPCs).forEach(([key, value]) => {
        if (!clientIds.has(key)) {
          try {
            value.close();
          } catch (e) { }
          delete videoPCs[key];
          delete window.cowatch.iceQueues[key];
          if (window.cowatch.remoteStreams) {
            delete window.cowatch.remoteStreams[key];
          }
        }
      });

      this.props.participants.forEach((user) => {
        const id = user.id;
        if (!user.isVideoChat) {
          // User isn't in video chat, skip
          return;
        }
        if (id === selfId) {
          if (!videoPCs[id]) {
            videoPCs[id] = new RTCPeerConnection();
          }
          if (videoRefs && videoRefs[id] && ourStream) {
            try {
              if (videoRefs[id].srcObject !== ourStream) {
                videoRefs[id].srcObject = ourStream;
              }
              videoRefs[id].play().catch(() => {});
            } catch (e) {
              console.warn("Could not set local stream on video element:", e);
            }
          }
        } else {
          const pc = this.createPeerConnection(id);
          // Synchronize local tracks to existing PeerConnection if missing
          if (pc && ourStream) {
            const senders = pc.getSenders();
            ourStream.getTracks().forEach((track) => {
              const hasSender = senders.some((s: RTCRtpSender) => s.track === track);
              if (!hasSender) {
                try {
                  pc.addTrack(track, ourStream);
                } catch (e) {
                  console.warn("Could not add track to existing peer connection:", id, e);
                }
              }
            });
          }
        }
      });
    } catch (err) {
      console.error("Critical error in updateWebRTC:", err);
    }
  };

  sendSignal = async (to: string, data: any) => {
    console.log("send", to, data);
    this.socket.emit("signal", { to, msg: data });
  };

  render() {
    const { participants, pictureMap, nameMap, tsMap, socket, owner } =
      this.props;
    const ourStream = window.cowatch.ourStream;
    const videoRefs = window.cowatch.videoRefs;
    const selfId = this.getSelfId();
    const isRoomOwner = Boolean(owner && this.context.user?.id && owner === this.context.user.id);
    const canInvite = Boolean(this.props.isHost || isRoomOwner);

    return (
      <div className={styles.container} data-count={participants.length}>
        {participants.map((p) => {
          const isSelf = p.id === selfId;
          const displayName =
            (isSelf ? this.context.displayName : null) ||
            nameMap[p.id] ||
            p.id;
          const videoTS = tsMap[p.id];
          const hasVideo = p.isVideoChat;
          const isLeader =
            this.props.getLeaderTime() &&
            Math.abs(videoTS - this.props.getLeaderTime()) < 1;
          const isSelected = false;
          const isCurrentTargetHost = p.id === this.props.currentHostClientId;
          const isSelfVideoActive = Boolean(ourStream && ourStream.getVideoTracks().some(t => t.enabled));
          return (
            <div
              key={p.id}
              className={`${styles.videoTile} ${isSelf ? styles.selfTile : ""} ${hasVideo ? styles.hasVideo : styles.noVideo}`}
            >
              {/* Media Container: Camera Stream or Fallback Avatar */}
              {hasVideo ? (
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <video
                    ref={(el) => {
                      if (el) {
                        videoRefs[p.id] = el;
                        const targetStream = isSelf ? ourStream : window.cowatch.remoteStreams?.[p.id];
                        if (targetStream) {
                          if (el.srcObject !== targetStream) {
                            el.srcObject = targetStream;
                          }
                          el.play().catch((playErr) => {
                            console.warn("Autoplay attempt deferred for", p.id, playErr);
                          });
                        }
                      } else {
                        delete videoRefs[p.id];
                      }
                    }}
                    onLoadedMetadata={(e) => {
                      const videoEl = e.currentTarget;
                      videoEl.play().catch((playErr) => {
                        console.warn("Play on loadedmetadata deferred:", playErr);
                      });
                    }}
                    onClick={(e) => {
                      const videoEl = e.currentTarget;
                      if (videoEl && videoEl.paused) {
                        videoEl.play().catch((err) => {
                          console.warn("User gesture playback retry deferred:", err);
                        });
                      }
                    }}
                    autoPlay
                    playsInline
                    muted={isSelf} // Mute self to prevent acoustic feedback
                    className={styles.videoElement}
                  />
                  {/* Subtle audio indicator if unmuted */}
                  <div className={styles.videoOverlayBadges}>
                    {/* Placeholder for audio meter or active speaking pulse */}
                  </div>
                </div>
              ) : (
                <div className={styles.avatarPlaceholder}>
                  <Avatar
                    src={pictureMap[p.id] || getDefaultPicture(displayName, getColorForStringHex(p.id))}
                    alt={displayName}
                    size={84}
                    radius="100%"
                    className={styles.largeAvatar}
                    imageProps={{
                      onError: (e: any) => {
                        // Resilient fallback if custom avatar 404s
                        const target = e.target as HTMLImageElement;
                        target.src = getDefaultPicture(displayName, getColorForStringHex(p.id));
                      }
                    }}
                  />
                  {isSelf && !ourStream && (
                    <Button
                      size="xs"
                      variant="gradient"
                      gradient={{ from: "violet", to: "indigo", deg: 45 }}
                      radius="md"
                      onClick={this.setupWebRTC}
                      leftSection={<IconVideo size={14} />}
                      style={{ marginTop: "4px" }}
                      className={styles.joinCallBtn}
                    >
                      Join Video Call
                    </Button>
                  )}
                  {isSelf && ourStream && !isSelfVideoActive && (
                    <span className={styles.cameraOffNotice}>Camera is turned off</span>
                  )}
                  {!isSelf && (
                    <span className={styles.peerStatusNotice}>
                      {p.isVideoChat ? "Camera is turned off" : "Watching"}
                    </span>
                  )}
                </div>
              )}

              {/* Top Bar: Participant Name and Options Menu */}
              <div className={styles.tileTopBar}>
                <div className={styles.nameBadge} title={displayName}>
                  <div className={styles.statusDot} />
                  <span className={styles.nameText}>{displayName}</span>
                  {isSelf && <span className={styles.youBadge}>You</span>}
                </div>

                {(this.props.isHost || isSelf) && (
                  <UserMenu
                    displayName={displayName}
                    socket={socket}
                    userToManage={p.id}
                    isHost={this.props.isHost}
                    isCurrentTargetHost={p.id === this.props.currentHostClientId}
                    selfClientId={selfId}
                    trigger={
                      <button
                        type="button"
                        className={styles.menuTrigger}
                      >
                        <IconDotsVertical size={15} />
                      </button>
                    }
                  />
                )}
              </div>

              {/* Bottom Bar: Timestamp and Video/Audio Controls */}
              <div className={styles.tileBottomBar}>
                <div className={styles.timeBadge}>
                  Watching {tsMap[p.id] ? formatTimestamp(tsMap[p.id]) : "0:00"}
                </div>

                <div className={styles.controlsBadge}>
                  {isSelf && ourStream && (
                    <div className={styles.controlPill}>
                      <ActionIcon
                        size="sm"
                        radius="sm"
                        color={this.getVideoWebRTC() ? "green" : "red"}
                        variant="filled"
                        onClick={this.toggleVideoWebRTC}
                      >
                        {this.getVideoWebRTC() ? (
                          <IconVideo size={13} />
                        ) : (
                          <IconVideoOff size={13} />
                        )}
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        radius="sm"
                        color={this.getAudioWebRTC() ? "green" : "red"}
                        variant="filled"
                        onClick={this.toggleAudioWebRTC}
                      >
                        {this.getAudioWebRTC() ? (
                          <IconMicrophone size={13} />
                        ) : (
                          <IconMicrophoneOff size={13} />
                        )}
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        radius="sm"
                        color="red"
                        variant="subtle"
                        onClick={this.stopWebRTC}
                      >
                        <IconX size={13} />
                      </ActionIcon>
                    </div>
                  )}

                  {isSelf && !ourStream && (
                    <ActionIcon
                      size="sm"
                      radius="sm"
                      color="violet"
                      variant="light"
                      onClick={this.setupWebRTC}
                    >
                      <IconVideo size={13} />
                    </ActionIcon>
                  )}

                  {!isSelf && (
                    <div className={styles.peerIndicators}>
                      {p.isVideoChat && (
                        <div className={styles.indicatorItem}>
                          <IconVideo size={13} color="var(--color-live)" />
                        </div>
                      )}
                      {p.isMuted ? (
                        <div className={styles.indicatorItem}>
                          <IconMicrophoneOff size={13} color="var(--color-danger)" />
                        </div>
                      ) : p.isVideoChat ? (
                        <div className={styles.indicatorItem}>
                          <IconMicrophone size={13} color="var(--color-live)" />
                        </div>
                      ) : null}
                      {p.isScreenShare && (
                        <div className={styles.indicatorItem}>
                          <IconScreenShare size={13} color="var(--media-video)" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {canInvite && (
          <div
            className={`${styles.inviteCard} ${participants.length === 1 ? styles.inviteCardSlot : ""}`}
            onClick={this.handleOpenInvite}
            role="button"
            tabIndex={0}
          >
            <div
              className={styles.inviteIconBadge}
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--color-violet)",
              }}
            >
              <IconUserPlus size={18} />
            </div>
            <div className={styles.inviteMeta}>
              <span className={styles.inviteTitle}>
                Invite people
              </span>
            </div>
            <IconChevronRight size={16} color="var(--text-muted)" className={styles.inviteChevron} />
          </div>
        )}

        {this.state.isInviteModalOpen && canInvite && (
          <InviteModal
            roomId={this.props.roomId || ""}
            passcode={this.props.passcode}
            isHost={this.props.isHost}
            isOwner={isRoomOwner}
            closeInviteModal={() => this.setState({ isInviteModalOpen: false })}
          />
        )}
      </div>
    );
  }
}
