import assert from "node:assert";
import {
  enumerateMediaDevices,
  queryMediaPermissions,
  stopMediaStream,
  testAutoplayDiagnostic,
  probeWebRtcDiagnostic,
  createMicVolumeMonitor,
  playSpeakerTestSound,
} from "./mediaPreflight";

/**
 * Test suite for mediaPreflight diagnostics and device utilities.
 * Run via: npx tsx src/utils/mediaPreflight.test.ts
 */

async function runMediaPreflightTests() {
  console.log("Running MediaPreflight diagnostics and device test suite...");

  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const setMockNavigator = (mock: any) => {
    Object.defineProperty(globalThis, "navigator", {
      value: mock,
      configurable: true,
      writable: true,
    });
  };

  const restoreNavigator = () => {
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDesc);
    } else {
      // @ts-ignore
      delete (globalThis as any).navigator;
    }
  };

  // 1. enumerateMediaDevices test
  {
    // Test when navigator.mediaDevices is undefined
    setMockNavigator({ mediaDevices: undefined });
    const emptyResult = await enumerateMediaDevices();
    assert.deepStrictEqual(emptyResult, {
      audioInputs: [],
      videoInputs: [],
      audioOutputs: [],
    });

    // Test when devices are present
    const mockDevices = [
      { deviceId: "mic1", kind: "audioinput", label: "USB Mic", groupId: "g1" },
      { deviceId: "cam1", kind: "videoinput", label: "HD Webcam", groupId: "g1" },
      { deviceId: "spk1", kind: "audiooutput", label: "Studio Speakers", groupId: "g1" },
    ];
    setMockNavigator({
      mediaDevices: {
        enumerateDevices: async () => mockDevices as any,
      },
    });

    const grouped = await enumerateMediaDevices();
    assert.strictEqual(grouped.audioInputs.length, 1);
    assert.strictEqual(grouped.audioInputs[0].label, "USB Mic");
    assert.strictEqual(grouped.videoInputs.length, 1);
    assert.strictEqual(grouped.videoInputs[0].label, "HD Webcam");
    assert.strictEqual(grouped.audioOutputs.length, 1);
    assert.strictEqual(grouped.audioOutputs[0].label, "Studio Speakers");

    // Test error handling during enumeration
    setMockNavigator({
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error("Device enumeration blocked");
        },
      },
    });
    const errorHandled = await enumerateMediaDevices();
    assert.deepStrictEqual(errorHandled, {
      audioInputs: [],
      videoInputs: [],
      audioOutputs: [],
    });

    restoreNavigator();
    console.log("✓ enumerateMediaDevices tests passed.");
  }

  // 2. queryMediaPermissions test
  {
    // When permissions API is unsupported
    setMockNavigator({ permissions: undefined });
    const unsupported = await queryMediaPermissions();
    assert.deepStrictEqual(unsupported, {
      camera: "unsupported",
      microphone: "unsupported",
    });

    // When permissions API is supported
    setMockNavigator({
      permissions: {
        query: async ({ name }: { name: string }) => {
          if (name === "camera") return { state: "granted" };
          if (name === "microphone") return { state: "denied" };
          throw new Error("Unknown permission name");
        },
      },
    });

    const activePermissions = await queryMediaPermissions();
    assert.strictEqual(activePermissions.camera, "granted");
    assert.strictEqual(activePermissions.microphone, "denied");

    restoreNavigator();
    console.log("✓ queryMediaPermissions tests passed.");
  }

  // 3. stopMediaStream test
  {
    let track1Stopped = false;
    let track2Stopped = false;

    const mockStream = {
      getTracks: () => [
        {
          kind: "video",
          stop: () => {
            track1Stopped = true;
          },
        },
        {
          kind: "audio",
          stop: () => {
            track2Stopped = true;
          },
        },
      ],
    } as any;

    stopMediaStream(mockStream);
    assert.strictEqual(track1Stopped, true);
    assert.strictEqual(track2Stopped, true);

    // Null and undefined safety
    assert.doesNotThrow(() => stopMediaStream(null));
    assert.doesNotThrow(() => stopMediaStream(undefined));
    console.log("✓ stopMediaStream tests passed.");
  }

  // 4. testAutoplayDiagnostic test
  {
    const autoResult = await testAutoplayDiagnostic();
    assert.strictEqual(typeof autoResult.canAutoplay, "boolean");
    assert.strictEqual(typeof autoResult.message, "string");
    assert.ok(autoResult.message.length > 0);
    console.log("✓ testAutoplayDiagnostic tests passed.");
  }

  // 5. probeWebRtcDiagnostic test
  {
    const originalRTCPeerConnection = (globalThis as any).RTCPeerConnection;

    // Test unsupported environment
    delete (globalThis as any).RTCPeerConnection;
    const unsupportedWebRtc = await probeWebRtcDiagnostic();
    assert.strictEqual(unsupportedWebRtc.supported, false);
    assert.strictEqual(unsupportedWebRtc.status, "unavailable");
    assert.ok(unsupportedWebRtc.message.includes("not supported"));

    // Test diagnostic probe with mock RTCPeerConnection
    let closed = false;
    class MockRTCPeerConnection {
      onicecandidate: ((e: any) => void) | null = null;
      close = () => {
        closed = true;
      };
      createDataChannel = () => ({});
      createOffer = async () => ({ type: "offer", sdp: "" });
      setLocalDescription = async () => {};

      constructor() {
        setTimeout(() => {
          if (this.onicecandidate) {
            this.onicecandidate({ candidate: { type: "srflx" } });
          }
        }, 15);
      }
    }

    (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
    const probeResult = await probeWebRtcDiagnostic();
    assert.strictEqual(probeResult.supported, true);
    assert.strictEqual(probeResult.status, "available");
    assert.ok(probeResult.candidateTypes.includes("srflx"));
    assert.strictEqual(closed, true);

    (globalThis as any).RTCPeerConnection = originalRTCPeerConnection;
    console.log("✓ probeWebRtcDiagnostic tests passed.");
  }

  // 6. createMicVolumeMonitor test
  {
    let volumeEmitted = -1;
    const mockEmptyStream = {
      getAudioTracks: () => [],
    } as any;

    const cleanup = createMicVolumeMonitor(mockEmptyStream, (level) => {
      volumeEmitted = level;
    });
    assert.strictEqual(volumeEmitted, 0);
    assert.strictEqual(typeof cleanup, "function");
    cleanup();
    console.log("✓ createMicVolumeMonitor tests passed.");
  }

  // 7. playSpeakerTestSound test
  {
    const originalAudioContext = (globalThis as any).AudioContext;

    let oscStarted = false;
    let oscStopped = false;

    class MockAudioContext {
      currentTime = 0;
      state = "suspended";
      destination = {};
      createOscillator = () => ({
        type: "sine",
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {
          oscStarted = true;
        },
        stop: () => {
          oscStopped = true;
        },
      });
      createGain = () => ({
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      });
      resume = async () => {
        this.state = "running";
      };
      close = async () => {};
    }

    (globalThis as any).AudioContext = MockAudioContext;
    const played = await playSpeakerTestSound();
    assert.strictEqual(played, true);
    assert.strictEqual(oscStarted, true);
    assert.strictEqual(oscStopped, true);

    (globalThis as any).AudioContext = originalAudioContext;
    console.log("✓ playSpeakerTestSound tests passed.");
  }

  console.log("All MediaPreflight tests completed successfully!");
}

runMediaPreflightTests().catch((err) => {
  console.error("MediaPreflight test failed:", err);
  process.exit(1);
});
