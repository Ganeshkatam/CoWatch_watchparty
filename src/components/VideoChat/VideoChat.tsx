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
  IconDotsVertical,
  IconMicrophone,
  IconScreenShare,
  IconUserPlus,
  IconVideo,
  IconX,
} from "@tabler/icons-react";

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
    const videoChatSize = participants.length > 2 ? 140 : 180;
    const videoChatContentStyle: React.CSSProperties = {
      height: videoChatSize,
      width: videoChatSize,
      objectFit: "cover",
      position: "relative",
    };
    const selfId = getOrCreateClientId();
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "4px",
          padding: "4px",
        }}
      >
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
            <div key={p.id}>
              <div
                style={{
                  position: "relative",
                  width: videoChatSize,
                  height: videoChatSize,
                  backgroundColor: "var(--bg-elevated)",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                <div>
                  <UserMenu
                    displayName={displayName}
                    disabled={
                      !Boolean(owner && owner === this.context.user?.id)
                    }
                    socket={socket}
                    userToManage={p.id}
                    trigger={
                      <IconDotsVertical
                        style={{
                          position: "absolute",
                          right: 0,
                          top: 0,
                          cursor: "pointer",
                          zIndex: 1,
                          visibility: Boolean(
                            owner && owner === this.context.user?.id,
                          )
                            ? "visible"
                            : "hidden",
                        }}
                      />
                    }
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "4px",
                      position: "absolute",
                      top: 0,
                      left: 0,
                      zIndex: 1,
                    }}
                  >
                    {!ourStream && p.id === selfId && (
                      <Button
                        size="xs"
                        color={"purple"}
                        onClick={this.setupWebRTC}
                        leftSection={<IconVideo />}
                      >
                        Join
                      </Button>
                    )}
                    {ourStream && p.id === selfId && (
                      <Button
                        size="xs"
                        color={"red"}
                        onClick={this.stopWebRTC}
                        leftSection={<IconX />}
                      >
                        Leave
                      </Button>
                    )}
                    {ourStream && p.id === selfId && (
                      <>
                        <ActionIcon
                          color={this.getVideoWebRTC() ? "green" : "red"}
                          onClick={this.toggleVideoWebRTC}
                        >
                          <IconVideo />
                        </ActionIcon>
                        <ActionIcon
                          color={this.getAudioWebRTC() ? "green" : "red"}
                          onClick={this.toggleAudioWebRTC}
                        >
                          <IconMicrophone />
                        </ActionIcon>
                      </>
                    )}
                    {p.id !== selfId && (
                      <>
                        {p.isVideoChat && <IconVideo color={softWhite} />}
                        {p.isVideoChat && (
                          <IconMicrophone
                            color={p.isMuted ? "red" : softWhite}
                          />
                        )}
                      </>
                    )}
                    {p.isScreenShare && <IconScreenShare color={softWhite} />}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      bottom: "4px",
                      left: "0px",
                      width: "100%",
                      backgroundColor: "rgba(0,0,0,0)",
                      color: softWhite,
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      display: "flex",
                      zIndex: 1,
                    }}
                  >
                    <div
                      title={displayName}
                      style={{
                        backdropFilter: "brightness(80%)",
                        padding: "4px",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        display: "inline-block",
                      }}
                    >
                      {displayName}
                    </div>
                    <div
                      style={{
                        backdropFilter: "brightness(60%)",
                        padding: "4px",
                        flexGrow: 1,
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      {formatTimestamp(tsMap[p.id] || 0)}{" "}
                      {/* {this.context.beta &&
                          `(${(
                            (tsMap[p.id] - this.props.getLeaderTime()) *
                            1000
                          ).toFixed(0)}ms)`} */}
                    </div>
                  </div>
                  {ourStream && p.isVideoChat ? (
                    <video
                      ref={(el) => {
                        if (el) {
                          videoRefs[p.id] = el;
                        }
                      }}
                      style={{
                        ...videoChatContentStyle,
                        // mirror the video if it's our stream. this style mimics Zoom where your
                        // video is mirrored only for you)
                        transform: `scaleX(${p.id === selfId ? "-1" : "1"})`,
                      }}
                      autoPlay
                      muted={p.id === selfId}
                      data-id={p.id}
                    />
                  ) : (
                    <img
                      style={videoChatContentStyle}
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
              </div>
            </div>
          );
        })}
        <div
          onClick={this.handleCopyInvite}
          style={{
            position: "relative",
            width: videoChatSize,
            height: videoChatSize,
            backgroundColor: "rgba(255, 255, 255, 0.02)",
            borderRadius: "8px",
            border: "2px dashed var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "12px",
            cursor: "pointer",
            textAlign: "center",
            transition: "all 0.2s ease",
            boxSizing: "border-box",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-violet, #8b5cf6)";
            e.currentTarget.style.backgroundColor = "rgba(139, 92, 246, 0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-subtle)";
            e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.02)";
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundColor: this.state.copied
                ? "rgba(16, 185, 129, 0.15)"
                : "var(--bg-surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
          >
            {this.state.copied ? (
              <IconCheck size={22} color="var(--color-green, #10b981)" />
            ) : (
              <IconUserPlus size={22} color="var(--text-secondary)" />
            )}
          </div>
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: this.state.copied
                  ? "var(--color-green, #10b981)"
                  : "var(--text-primary)",
              }}
            >
              {this.state.copied ? "Link Copied!" : "Invite Friend"}
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                marginTop: "2px",
              }}
            >
              {this.state.copied ? "Share with friends" : "Click to copy link"}
            </div>
          </div>
        </div>
      </div>
    );
  }
}
