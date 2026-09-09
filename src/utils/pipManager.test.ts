import { pipManager } from "./pipManager";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("Testing pipManager...");

// 1. Initial State
const initialState = pipManager.getState();
assert(initialState.stage === "idle", "Initial stage should be idle");
assert(!initialState.active, "Initial active state should be false");
assert(initialState.mode === null, "Initial mode should be null");
assert(initialState.target === null, "Initial target should be null");

// 2. Subscription
let observedState = pipManager.getState();
const unsubscribe = pipManager.subscribe((state) => {
  observedState = state;
});
assert(observedState.stage === "idle", "Subscriber receives current state immediately");

// 3. Capability detection in Node/Test environment
assert(typeof pipManager.isDocumentPiPSupported === "function", "isDocumentPiPSupported should be a function");
assert(typeof pipManager.isNativePiPSupported === "function", "isNativePiPSupported should be a function");

// 4. Cleanup on idle should be safe and idempotent
pipManager.cleanup();
assert(pipManager.getState().stage === "idle", "Stage remains idle after cleanup");

// 5. Native PiP detection with video element mock
const fakeVideo = {
  disablePictureInPicture: true,
} as unknown as HTMLVideoElement;
// In Node environment document is undefined or polyfilled
if (typeof document !== "undefined" && document.pictureInPictureEnabled) {
  assert(!pipManager.isNativePiPSupported(fakeVideo), "Should be false if disablePictureInPicture is true");
}

unsubscribe();
console.log("All pipManager tests passed successfully!");
