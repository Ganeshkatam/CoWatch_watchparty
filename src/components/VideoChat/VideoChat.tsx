import React from "react";
import { ActionIcon, Button } from "@mantine/core";
import { Socket } from "socket.io-client";

import {
  formatTimestamp,
  getOrCreateClientId,
  getColorForStringHex,
  getDefaultPicture,
  iceServers,
  softWhite,
} from "../../utils/utils";
import { UserMenu } from "../UserMenu/UserMenu";
import { MetadataContext } from "../../MetadataContext";
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
  onOpenInviteModal?: () => void;
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

  state = {
    copied: false,
    isInviteModalOpen: false,
  };

  private handleOpenInvite = () => {
    if (this.props.onOpenInviteModal) {
      this.props.onOpenInviteModal();
    } else {
      this.setState({ isInviteModalOpen: true });
    }
  };

  private handleCopyInvite = () => {
    navigator.clipboard.writeText(window.location.href);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  private lastPrefCameraOn: boolean = false;
  private lastPrefMicOn: boolean = false;

  componentDidMount() {
    this.lastPrefCameraOn = this.context.profile?.pref_camera_on ?? false;
    this.lastPrefMicOn = this.context.profile?.pref_mic_on ?? false;
    this.socket?.on("signal", this.handleSignal);
  }

  componentWillUnmount() {
    this.socket?.off("signal", this.handleSignal);
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

  handleSignal = async (data: any) => {
    // Handle messages received from signaling server
    const msg = data.msg;
    const from = data.from;
    let pc = window.cowatch.videoPCs[from];
    if (!pc) {
      return;
    }
    console.log("recv", from, data);
    if (msg.ice !== undefined) {
      pc.addIceCandidate(new RTCIceCandidate(msg.ice));
    } else if (msg.sdp && msg.sdp.type === "offer") {
      // If our PC is stale, replace it with a fresh one before handling the offer
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        pc.close();
        delete window.cowatch.videoPCs[from];
        this.updateWebRTC();
        pc = window.cowatch.videoPCs[from];
        if (!pc) {
          return;
        }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(from, { sdp: pc.localDescription });
    } else if (msg.sdp && msg.sdp.type === "answer") {
      pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    }
  };

  setupWebRTC = async () => {
    try {
      let stream = new MediaStream([]);

      const prefCameraOn = this.context.profile?.pref_camera_on ?? true;
      const prefMicOn = this.context.profile?.pref_mic_on ?? true;

      if (prefCameraOn || prefMicOn) {
        try {
          stream = await navigator?.mediaDevices?.getUserMedia({
            audio: prefMicOn,
            video: prefCameraOn,
          });
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
      Object.keys(videoPCs).forEach((key) => {
        try {
          videoPCs[key]?.close();
        } catch (e) {}
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

  updateWebRTC = () => {
    try {
      const ourStream = window.cowatch.ourStream;
      const videoPCs = window.cowatch.videoPCs;
      const videoRefs = window.cowatch.videoRefs;
      if (!ourStream) {
        // We haven't started video chat, exit
        return;
      }
      const selfId = getOrCreateClientId();

      // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
      // This allows them to rejoin later
      const clientIds = new Set(
        this.props.participants.filter((p) => p.isVideoChat).map((p) => p.id),
      );
      Object.entries(videoPCs).forEach(([key, value]) => {
        if (!clientIds.has(key)) {
          try {
            value.close();
          } catch (e) {}
          delete videoPCs[key];
        }
      });

      this.props.participants.forEach((user) => {
        const id = user.id;
        if (!user.isVideoChat || videoPCs[id]) {
          // User isn't in video chat, or we already have a connection to them
          return;
        }
        if (id === selfId) {
          videoPCs[id] = new RTCPeerConnection();
          if (videoRefs && videoRefs[id] && ourStream) {
            try {
              videoRefs[id].srcObject = ourStream;
            } catch (e) {
              console.warn("Could not set local stream on video element:", e);
            }
          }
        } else {
          const pc = new RTCPeerConnection({ iceServers: iceServers() });
          videoPCs[id] = pc;
          // Add our own video as outgoing stream
          ourStream?.getTracks().forEach((track) => {
            if (ourStream) {
              try {
                pc.addTrack(track, ourStream);
              } catch (e) {
                console.warn("Could not add track to pc:", e);
              }
            }
          });
          pc.onicecandidate = (event) => {
            // We generated an ICE candidate, send it to peer
            if (event.candidate) {
              this.sendSignal(id, { ice: event.candidate });
            }
          };
          pc.ontrack = (event: RTCTrackEvent) => {
            if (videoRefs && videoRefs[id] && event.streams && event.streams[0]) {
              try {
                videoRefs[id].srcObject = event.streams[0];
              } catch (e) {
                console.warn("Could not set remote stream on video element:", e);
              }
            }
          };
          pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === "failed") {
              // ICE failed (permanently, not a temporary disconnection, which would be "disconnected"), tear down and attempt to re-establish
              try {
                pc.close();
              } catch (e) {}
              delete videoPCs[id];
              this.updateWebRTC();
            }
          };
          // For each pair, have the lexicographically smaller ID be the offerer
          const isOfferer = selfId < id;
          if (isOfferer) {
            pc.onnegotiationneeded = async () => {
              try {
                // Start connection for peer's video
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.sendSignal(id, { sdp: pc.localDescription });
              } catch (e) {
                console.warn("Negotiation error:", e);
              }
            };
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
    const selfId = getOrCreateClientId();

    return (
      <div className={styles.container}>
        {participants.map((p) => {
          const isSelf = p.id === selfId;
          const displayName =
            (isSelf ? this.context.displayName : null) ||
            nameMap[p.id] ||
            p.id;
          const rawPhoto = isSelf
            ? pictureMap[p.id] || this.context.avatarUrl
            : pictureMap[p.id];
          const fallbackPhoto = getDefaultPicture(
            displayName,
            getColorForStringHex(p.id),
          );
          const userPhoto = rawPhoto || fallbackPhoto;

          const isSelfInCall = Boolean(isSelf && ourStream);
          const isSelfVideoActive = Boolean(isSelfInCall && this.getVideoWebRTC());
          const isPeerInCall = Boolean(!isSelf && p.isVideoChat);
          const showVideoFeed = isSelf ? isSelfVideoActive : isPeerInCall;

          return (
            <div key={p.id} className={styles.videoTile}>
              {(isSelfInCall || p.isVideoChat) && (
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs[p.id] = el;
                      if (isSelf && ourStream && el.srcObject !== ourStream) {
                        try {
                          el.srcObject = ourStream;
                        } catch (e) {
                          console.warn("Error assigning srcObject to local video:", e);
                        }
                      }
                    } else {
                      delete videoRefs[p.id];
                    }
                  }}
                  className={styles.videoElement}
                  style={{
                    display: showVideoFeed ? "block" : "none",
                    transform: `scaleX(${isSelf ? "-1" : "1"})`,
                  }}
                  autoPlay
                  playsInline
                  muted={isSelf}
                  data-id={p.id}
                />
              )}

              {!showVideoFeed && (
                <div className={styles.avatarPlaceholder}>
                  <img
                    className={styles.largeAvatar}
                    src={userPhoto}
                    alt={displayName}
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== fallbackPhoto) {
                        target.src = fallbackPhoto;
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

                <UserMenu
                  displayName={displayName}
                  disabled={!Boolean(owner && owner === this.context.user?.id)}
                  socket={socket}
                  userToManage={p.id}
                  trigger={
                    <button
                      type="button"
                      className={styles.menuTrigger}
                      title="User options"
                      style={{
                        visibility: Boolean(owner && owner === this.context.user?.id)
                          ? "visible"
                          : "hidden",
                      }}
                    >
                      <IconDotsVertical size={15} />
                    </button>
                  }
                />
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
                        title={this.getVideoWebRTC() ? "Turn camera off" : "Turn camera on"}
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
                        title={this.getAudioWebRTC() ? "Mute mic" : "Unmute mic"}
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
                        title="Leave video call"
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
                      title="Join video call"
                    >
                      <IconVideo size={13} />
                    </ActionIcon>
                  )}

                  {!isSelf && (
                    <div className={styles.peerIndicators}>
                      {p.isVideoChat && (
                        <div className={styles.indicatorItem} title="Camera connected">
                          <IconVideo size={13} color="var(--color-live)" />
                        </div>
                      )}
                      {p.isMuted ? (
                        <div className={styles.indicatorItem} title="Microphone muted">
                          <IconMicrophoneOff size={13} color="var(--color-danger, #EF4444)" />
                        </div>
                      ) : p.isVideoChat ? (
                        <div className={styles.indicatorItem} title="Microphone on">
                          <IconMicrophone size={13} color="var(--color-live)" />
                        </div>
                      ) : null}
                      {p.isScreenShare && (
                        <div className={styles.indicatorItem} title="Sharing screen">
                          <IconScreenShare size={13} color="#60A5FA" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div
          className={styles.inviteCard}
          onClick={this.handleOpenInvite}
          role="button"
          tabIndex={0}
          title="Click to invite friends"
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
            <span className={styles.inviteSubtitle}>
              Share a link to bring friends into the room
            </span>
          </div>
          <IconChevronRight size={16} color="var(--text-muted)" />
        </div>

        {this.state.isInviteModalOpen && (
          <InviteModal
            roomId={this.props.roomId || ""}
            closeInviteModal={() => this.setState({ isInviteModalOpen: false })}
          />
        )}
      </div>
    );
  }
}
