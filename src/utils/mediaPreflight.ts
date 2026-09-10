import { iceServers, testAutoplay } from "./utils";

export interface MediaDeviceInfoGroup {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}

export interface PermissionStatusGroup {
  camera: PermissionState | "unsupported";
  microphone: PermissionState | "unsupported";
}

export interface WebRtcDiagnosticResult {
  supported: boolean;
  status: "available" | "degraded" | "unavailable";
  rttMs?: number;
  candidateTypes: string[];
  message: string;
}

export interface AutoplayDiagnosticResult {
  canAutoplay: boolean;
  message: string;
}

export interface PreflightPreferences {
  initialCameraOn: boolean;
  initialMicOn: boolean;
  cameraDeviceId?: string;
  micDeviceId?: string;
  speakerDeviceId?: string;
}

/**
 * Safely enumerate media devices grouped by kind.
 */
export async function enumerateMediaDevices(): Promise<MediaDeviceInfoGroup> {
  const mediaDevices =
    typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

  if (!mediaDevices || !mediaDevices.enumerateDevices) {
    return { audioInputs: [], videoInputs: [], audioOutputs: [] };
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    return {
      audioInputs: devices.filter((d) => d.kind === "audioinput"),
      videoInputs: devices.filter((d) => d.kind === "videoinput"),
      audioOutputs: devices.filter((d) => d.kind === "audiooutput"),
    };
  } catch (error) {
    console.warn("Failed to enumerate media devices:", error);
    return { audioInputs: [], videoInputs: [], audioOutputs: [] };
  }
}

/**
 * Query current permissions for camera and microphone without triggering prompts.
 */
export async function queryMediaPermissions(): Promise<PermissionStatusGroup> {
  const result: PermissionStatusGroup = {
    camera: "unsupported",
    microphone: "unsupported",
  };

  const permissions =
    typeof navigator !== "undefined" ? navigator.permissions : undefined;

  if (!permissions?.query) {
    return result;
  }

  try {
    const cam = await permissions.query({
      name: "camera" as PermissionName,
    });
    result.camera = cam.state;
  } catch {
    result.camera = "unsupported";
  }

  try {
    const mic = await permissions.query({
      name: "microphone" as PermissionName,
    });
    result.microphone = mic.state;
  } catch {
    result.microphone = "unsupported";
  }

  return result;
}

/**
 * Diagnostic WebRTC & STUN connectivity probe.
 * Note: Diagnostic only. Never blocks room entry.
 */
export async function probeWebRtcDiagnostic(): Promise<WebRtcDiagnosticResult> {
  const PeerConnection =
    (typeof window !== "undefined" && (window as any).RTCPeerConnection) ||
    (typeof globalThis !== "undefined" && (globalThis as any).RTCPeerConnection);

  if (!PeerConnection) {
    return {
      supported: false,
      status: "unavailable",
      candidateTypes: [],
      message: "WebRTC is not supported in this browser environment.",
    };
  }

  const startTime = performance.now();
  const candidateTypes: string[] = [];

  return new Promise((resolve) => {
    let pc: any = null;
    let resolved = false;

    const finalize = (
      status: "available" | "degraded" | "unavailable",
      message: string,
      rtt?: number
    ) => {
      if (resolved) return;
      resolved = true;
      try {
        pc?.close();
      } catch {
        // ignore close errors
      }
      resolve({
        supported: true,
        status,
        rttMs: rtt,
        candidateTypes: Array.from(new Set(candidateTypes)),
        message,
      });
    };

    const timeout = setTimeout(() => {
      finalize(
        candidateTypes.length > 0 ? "available" : "degraded",
        candidateTypes.length > 0
          ? "Diagnostic probe finished with local candidates."
          : "STUN probe timed out; direct connection will be attempted in-room.",
        Math.round(performance.now() - startTime)
      );
    }, 3500);

    try {
      const servers = iceServers();
      pc = new PeerConnection({
        iceServers: servers.length > 0 ? servers : [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.onicecandidate = (event: any) => {
        if (!event.candidate) return;
        const type = event.candidate.type;
        if (type) candidateTypes.push(type);

        if (type === "srflx" || type === "relay") {
          clearTimeout(timeout);
          finalize(
            "available",
            "WebRTC and STUN connectivity verified.",
            Math.round(performance.now() - startTime)
          );
        }
      };

      pc.createDataChannel("cowatch-preflight-probe");
      pc.createOffer()
        .then((offer: any) => pc?.setLocalDescription(offer))
        .catch((err: any) => {
          clearTimeout(timeout);
          finalize("degraded", `Diagnostic probe offer failed: ${err?.message || err}`);
        });
    } catch (err: any) {
      clearTimeout(timeout);
      finalize("degraded", `Failed to initialize probe: ${err?.message || err}`);
    }
  });
}

/**
 * Diagnostic autoplay test.
 */
export async function testAutoplayDiagnostic(): Promise<AutoplayDiagnosticResult> {
  try {
    const canPlay = await testAutoplay();
    return {
      canAutoplay: Boolean(canPlay),
      message: canPlay
        ? "Video autoplay is supported without prior interaction."
        : "Autoplay restricted; in-room media may start muted until unmuted.",
    };
  } catch (error) {
    return {
      canAutoplay: false,
      message: "Autoplay diagnostic could not be evaluated.",
    };
  }
}

/**
 * Stop all tracks on a MediaStream and release devices cleanly.
 */
export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (err) {
        console.warn("Failed to stop track:", err);
      }
    });
  } catch (err) {
    console.warn("Error stopping stream tracks:", err);
  }
}

/**
 * Creates a volume level monitor on an audio track using Web Audio API.
 * Returns an unbind/cleanup function.
 * Audio is strictly NEVER connected to audioContext.destination to prevent loopback.
 */
export function createMicVolumeMonitor(
  stream: MediaStream,
  onVolumeChange: (level: number) => void
): () => void {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    onVolumeChange(0);
    return () => {};
  }

  const AudioContextClass =
    (typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)) ||
    (typeof globalThis !== "undefined" && ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext)) ||
    null;

  if (!AudioContextClass) {
    return () => {};
  }

  let audioCtx: AudioContext | null = null;
  let animationFrameId: number | null = null;
  let isCleanedUp = false;

  try {
    const ctx = new AudioContextClass();
    audioCtx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.4;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateVolume = () => {
      if (isCleanedUp) return;
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalize to 0 - 100 range
      const normalized = Math.min(100, Math.round((average / 128) * 100));
      onVolumeChange(normalized);

      if (typeof requestAnimationFrame === "function") {
        animationFrameId = requestAnimationFrame(updateVolume);
      }
    };

    updateVolume();
  } catch (err) {
    console.warn("Could not create audio volume monitor:", err);
  }

  return () => {
    isCleanedUp = true;
    if (animationFrameId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(animationFrameId);
    }
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch {
        // ignore close errors
      }
      audioCtx = null;
    }
    onVolumeChange(0);
  };
}

/**
 * Synthesizes a pleasant speaker test chime (440Hz / 554.37Hz) using Web Audio API.
 * Independent of microphone permissions. Supports setSinkId where available.
 */
export async function playSpeakerTestSound(outputDeviceId?: string): Promise<boolean> {
  const AudioContextClass =
    (typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)) ||
    (typeof globalThis !== "undefined" && ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext)) ||
    null;

  if (!AudioContextClass) return false;

  try {
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (
      outputDeviceId &&
      typeof (ctx as any).setSinkId === "function" &&
      outputDeviceId !== "default"
    ) {
      try {
        await (ctx as any).setSinkId(outputDeviceId);
      } catch (err) {
        console.warn("setSinkId failed on AudioContext, falling back to default:", err);
      }
    }

    const now = ctx.currentTime;
    // Tone 1: A4 (440Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(440, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: C#5 (554.37Hz) - harmonious major third
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(554.37, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.2, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.6);

    setTimeout(() => {
      try {
        ctx.close();
      } catch {
        // ignore
      }
    }, 800);

    return true;
  } catch (err) {
    console.warn("Error playing speaker test sound:", err);
    return false;
  }
}
