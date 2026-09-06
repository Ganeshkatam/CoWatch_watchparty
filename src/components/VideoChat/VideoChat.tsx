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
  IconUserPlus,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import styles from "./VideoChat.module.css";

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
}

export class VideoChat extends React.Component<VideoChatProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;

  socket = this.props.socket;

  state = {
    copied: false,
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
    let stream = new MediaStream([]);

    const prefCameraOn = this.context.profile.pref_camera_on;
    const prefMicOn = this.context.profile.pref_mic_on;

    if (prefCameraOn || prefMicOn) {
      try {
        stream = await navigator?.mediaDevices.getUserMedia({
          audio: prefMicOn,
          video: prefCameraOn,
        });
      } catch (e) {
        console.warn("Failed initial getUserMedia", e);
        if (prefCameraOn && prefMicOn) {
          try {
            console.log("attempt audio only stream");
            stream = await navigator?.mediaDevices?.getUserMedia({
              audio: true,
              video: false,
            });
          } catch (fallbackErr) {
            console.warn(fallbackErr);
          }
        }
      }
    }

    window.cowatch.ourStream = stream;
    // alert server we've joined video chat
    this.socket.emit("CMD:joinVideo");
    this.emitUserMute();
  };

  stopWebRTC = () => {
    const ourStream = window.cowatch.ourStream;
    const videoPCs = window.cowatch.videoPCs;
    ourStream &&
      ourStream.getTracks().forEach((track) => {
        track.stop();
      });
    window.cowatch.ourStream = undefined;
    Object.keys(videoPCs).forEach((key) => {
      videoPCs[key].close();
      delete videoPCs[key];
    });
    this.socket.emit("CMD:leaveVideo");
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
        value.close();
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
        videoRefs[id].srcObject = ourStream;
      } else {
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        videoPCs[id] = pc;
        // Add our own video as outgoing stream
        ourStream?.getTracks().forEach((track) => {
          if (ourStream) {
            pc.addTrack(track, ourStream);
          }
        });
        pc.onicecandidate = (event) => {
          // We generated an ICE candidate, send it to peer
          if (event.candidate) {
            this.sendSignal(id, { ice: event.candidate });
          }
        };
        pc.ontrack = (event: RTCTrackEvent) => {
          // Mount the stream from peer
          // console.log(stream);
          videoRefs[id].srcObject = event.streams[0];
        };
        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "failed") {
            // ICE failed (permanently, not a temporary disconnection, which would be "disconnected"), tear down and attempt to re-establish
            pc.close();
            delete videoPCs[id];
            this.updateWebRTC();
          }
        };
        // For each pair, have the lexicographically smaller ID be the offerer
        const isOfferer = selfId < id;
        if (isOfferer) {
          pc.onnegotiationneeded = async () => {
            // Start connection for peer's video
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(id, { sdp: pc.localDescription });
          };
        }
      }
    });
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

          return (
            <div key={p.id} className={styles.participantCard}>
              <div className={styles.avatarContainer}>
                {ourStream && p.isVideoChat ? (
                  <video
                    ref={(el) => {
                      if (el) {
                        videoRefs[p.id] = el;
                      }
                    }}
                    className={styles.avatarVideo}
                    style={{
                      transform: `scaleX(${p.id === selfId ? "-1" : "1"})`,
                    }}
                    autoPlay
                    muted={p.id === selfId}
                    data-id={p.id}
                  />
                ) : (
                  <img
                    className={styles.avatarImg}
                    src={userPhoto}
                    alt={displayName}
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== fallbackPhoto) {
                        target.src = fallbackPhoto;
                      }
                    }}
                  />
                )}
              </div>

              <div className={styles.meta}>
                <div className={styles.nameRow}>
                  <span className={styles.nameText} title={displayName}>
                    {displayName}
                  </span>
                  {isSelf && <span className={styles.youBadge}>You</span>}
                </div>
                <div className={styles.statusRow}>
                  <div className={styles.statusDot} />
                  <span className={styles.statusText}>
                    Watching {tsMap[p.id] ? `(${formatTimestamp(tsMap[p.id])})` : ""}
                  </span>
                </div>
              </div>

              <div className={styles.actions}>
                {isSelf && !ourStream && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="violet"
                    onClick={this.setupWebRTC}
                    leftSection={<IconVideo size={13} />}
                  >
                    Join
                  </Button>
                )}
                {isSelf && ourStream && (
                  <>
                    <ActionIcon
                      size="sm"
                      color={this.getVideoWebRTC() ? "green" : "red"}
                      variant="light"
                      onClick={this.toggleVideoWebRTC}
                      title="Toggle camera"
                    >
                      <IconVideo size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      color={this.getAudioWebRTC() ? "green" : "red"}
                      variant="light"
                      onClick={this.toggleAudioWebRTC}
                      title="Toggle mic"
                    >
                      <IconMicrophone size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      color="red"
                      variant="subtle"
                      onClick={this.stopWebRTC}
                      title="Leave call"
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  </>
                )}
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
                    >
                      <IconDotsVertical size={16} />
                    </button>
                  }
                />
              </div>
            </div>
          );
        })}

        <div
          className={styles.inviteCard}
          onClick={this.handleCopyInvite}
          role="button"
          tabIndex={0}
          title="Click to copy invite link"
        >
          <div
            className={styles.inviteIconBadge}
            style={{
              backgroundColor: this.state.copied
                ? "rgba(16, 185, 129, 0.15)"
                : "var(--bg-surface)",
              color: this.state.copied ? "var(--color-live)" : "var(--text-secondary)",
            }}
          >
            {this.state.copied ? (
              <IconCheck size={18} />
            ) : (
              <IconUserPlus size={18} />
            )}
          </div>
          <div className={styles.inviteMeta}>
            <span
              className={styles.inviteTitle}
              style={{
                color: this.state.copied ? "var(--color-live)" : "var(--text-primary)",
              }}
            >
              {this.state.copied ? "Link Copied!" : "Invite people"}
            </span>
            <span className={styles.inviteSubtitle}>
              {this.state.copied
                ? "Share with your friends to join"
                : "Share a link to bring friends into the room"}
            </span>
          </div>
          <IconChevronRight size={16} color="var(--text-muted)" />
        </div>
      </div>
    );
  }
}
