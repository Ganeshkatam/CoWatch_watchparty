/**
 * LOCAL-MEDIA-001: WebRTC P2P DataChannel Connection Manager
 * Manages peer connection, data channels, binary chunk framing, and backpressure control.
 */

import { iceServers } from "../../utils/utils";

export interface DataChannelMessage {
  type: "REQUEST_CHUNKS" | "HAVE_CHUNKS" | "CHUNK" | "UNAVAILABLE";
  mediaId: string;
  epoch: number;
  payload?: any;
}

export type ChunkReceivedCallback = (chunkIndex: number, data: Uint8Array) => void;
export type ChunkRequestedCallback = (peerId: string, chunkIndices: number[]) => void;
export type AvailabilityReceivedCallback = (peerId: string, availableChunks: number[]) => void;

export class LocalMediaPeer {
  public readonly peerId: string;
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private isInitiator: boolean;
  private onSignal: (signalData: any) => void;
  private onChunkReceived?: ChunkReceivedCallback;
  private onChunkRequested?: ChunkRequestedCallback;
  private onAvailabilityReceived?: AvailabilityReceivedCallback;
  private isConnected: boolean = false;

  // Backpressure thresholds (64KB low, 1MB high)
  private readonly HIGH_WATERMARK = 1024 * 1024;
  private readonly LOW_WATERMARK = 64 * 1024;

  constructor(
    peerId: string,
    isInitiator: boolean,
    onSignal: (signalData: any) => void,
    callbacks?: {
      onChunkReceived?: ChunkReceivedCallback;
      onChunkRequested?: ChunkRequestedCallback;
      onAvailabilityReceived?: AvailabilityReceivedCallback;
    }
  ) {
    this.peerId = peerId;
    this.isInitiator = isInitiator;
    this.onSignal = onSignal;
    this.onChunkReceived = callbacks?.onChunkReceived;
    this.onChunkRequested = callbacks?.onChunkRequested;
    this.onAvailabilityReceived = callbacks?.onAvailabilityReceived;

    this.pc = new RTCPeerConnection({
      iceServers: iceServers(),
    });

    this.setupPeerConnection();

    if (this.isInitiator) {
      this.setupDataChannel(
        this.pc.createDataChannel("local-media-mesh", {
          ordered: true,
        })
      );
    }
  }

  private setupPeerConnection(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onSignal({ candidate: event.candidate });
      }
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    this.pc.onconnectionstatechange = () => {
      this.isConnected = this.pc.connectionState === "connected";
    };
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    this.dc.binaryType = "arraybuffer";

    this.dc.onopen = () => {
      this.isConnected = true;
    };

    this.dc.onclose = () => {
      this.isConnected = false;
    };

    this.dc.onerror = (err) => {
      console.warn(`DataChannel error with peer ${this.peerId}:`, err);
    };

    this.dc.onmessage = (event) => {
      this.handleIncomingMessage(event.data);
    };
  }

  public async startNegotiation(): Promise<void> {
    if (!this.isInitiator) return;

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.onSignal({ sdp: this.pc.localDescription });
  }

  public async handleSignal(signalData: any): Promise<void> {
    try {
      if (signalData.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        if (signalData.sdp.type === "offer") {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.onSignal({ sdp: this.pc.localDescription });
        }
      } else if (signalData.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
      }
    } catch (err) {
      console.warn(`Signal handling error with peer ${this.peerId}:`, err);
    }
  }

  public sendChunk(chunkIndex: number, data: Uint8Array): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;

    // Backpressure check
    if (this.dc.bufferedAmount > this.HIGH_WATERMARK) {
      return false; // Backpressure saturated, caller should back off
    }

    try {
      // Frame structure: [4 bytes chunkIndex (Int32)] + [Binary payload]
      const frame = new Uint8Array(4 + data.byteLength);
      const view = new DataView(frame.buffer);
      view.setInt32(0, chunkIndex, false);
      frame.set(data, 4);

      this.dc.send(frame.buffer);
      return true;
    } catch (err) {
      console.warn(`Failed to send chunk ${chunkIndex} to peer ${this.peerId}:`, err);
      return false;
    }
  }

  public requestChunks(mediaId: string, epoch: number, chunkIndices: number[]): void {
    if (!this.dc || this.dc.readyState !== "open" || chunkIndices.length === 0) return;

    const msg: DataChannelMessage = {
      type: "REQUEST_CHUNKS",
      mediaId,
      epoch,
      payload: { chunkIndices },
    };

    this.sendJson(msg);
  }

  public broadcastAvailability(mediaId: string, epoch: number, availableChunks: number[]): void {
    if (!this.dc || this.dc.readyState !== "open") return;

    const msg: DataChannelMessage = {
      type: "HAVE_CHUNKS",
      mediaId,
      epoch,
      payload: { availableChunks },
    };

    this.sendJson(msg);
  }

  private sendJson(msg: DataChannelMessage): void {
    if (!this.dc || this.dc.readyState !== "open") return;
    try {
      this.dc.send(JSON.stringify(msg));
    } catch (err) {
      console.warn(`Failed to send JSON message to peer ${this.peerId}:`, err);
    }
  }

  private handleIncomingMessage(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      try {
        const msg: DataChannelMessage = JSON.parse(data);
        if (msg.type === "REQUEST_CHUNKS" && msg.payload?.chunkIndices) {
          this.onChunkRequested?.(this.peerId, msg.payload.chunkIndices);
        } else if (msg.type === "HAVE_CHUNKS" && msg.payload?.availableChunks) {
          this.onAvailabilityReceived?.(this.peerId, msg.payload.availableChunks);
        }
      } catch (err) {
        console.warn(`Failed to parse text message from peer ${this.peerId}:`, err);
      }
    } else if (data instanceof ArrayBuffer) {
      if (data.byteLength < 4) return;
      const view = new DataView(data);
      const chunkIndex = view.getInt32(0, false);
      const chunkData = new Uint8Array(data, 4);

      this.onChunkReceived?.(chunkIndex, chunkData);
    }
  }

  public getBufferedAmount(): number {
    return this.dc?.bufferedAmount ?? 0;
  }

  public isReady(): boolean {
    return this.isConnected && this.dc?.readyState === "open";
  }

  public close(): void {
    try {
      this.dc?.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
    this.isConnected = false;
  }
}
