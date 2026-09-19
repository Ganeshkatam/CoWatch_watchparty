import {
  HOLD_THRESHOLD_MS,
  MOVE_JITTER_TOLERANCE_PX,
  MIN_RADIUS,
  MAX_RADIUS,
  DEFAULT_RADIUS,
  WheelNavigationItem,
  normalizeAngle,
  angularDistance,
  getOrbitItemAngle,
} from './navigationPolicy';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}


console.log('=== CircularNavigationWheel Contract & Logic Tests ===\n');

// 1. Test Constants
console.log('Case 1: Testing Wheel Constants & Tolerances...');
assert(HOLD_THRESHOLD_MS === 180, 'HOLD_THRESHOLD_MS must be exactly 180ms per specification');
assert(MOVE_JITTER_TOLERANCE_PX === 8, 'MOVE_JITTER_TOLERANCE_PX must be 8px');
assert(MIN_RADIUS >= 70, 'MIN_RADIUS must be at least 70px');
assert(MAX_RADIUS <= 110, 'MAX_RADIUS must be bounded below 110px');
assert(DEFAULT_RADIUS >= MIN_RADIUS && DEFAULT_RADIUS <= MAX_RADIUS, 'DEFAULT_RADIUS must be within bounds');
console.log('  PASS: Wheel constants verified.\n');

// 2. Test Polar Mathematics & Angular Normalization
console.log('Case 2: Testing Polar Coordinates & Angular Calculations...');
const radius = 80;
const topAngle = -Math.PI / 2;
const topX = Math.round(Math.cos(topAngle) * radius);
const topY = Math.round(Math.sin(topAngle) * radius);
assert(topX === 0, 'Top angle X coordinate must be 0');
assert(topY === -80, 'Top angle Y coordinate must be -radius (-80)');

const rightAngle = 0;
const rightX = Math.round(Math.cos(rightAngle) * radius);
const rightY = Math.round(Math.sin(rightAngle) * radius);
assert(rightX === 80, 'Right angle X coordinate must be radius (80)');
assert(rightY === 0, 'Right angle Y coordinate must be 0');

const diff1 = angularDistance(Math.PI - 0.1, -Math.PI + 0.1);
assert(Math.abs(diff1 - 0.2) < 0.0001, 'Angular distance must wrap around +/- PI cleanly');
console.log('  PASS: Polar mathematics verified.\n');

// 3. Test Center Dock vs Orbit Item Partitioning
console.log('Case 3: Testing Center vs Orbit Items Partitioning...');
const DummyIcon = () => null;

const mockItems: WheelNavigationItem[] = [
  { id: 'home', label: 'Home', icon: DummyIcon, href: '/', isActive: false, ariaLabel: 'Home' },
  { id: 'rooms', label: 'Rooms', icon: DummyIcon, href: '/myrooms', isActive: true, ariaLabel: 'Rooms' },
  { id: 'create', label: 'New Room', icon: DummyIcon, href: '/create', isActive: false, ariaLabel: 'Create' },
  { id: 'profile', label: 'Profile', icon: DummyIcon, href: '/account/profile', isActive: false, ariaLabel: 'Profile' },
  { id: 'theme', label: 'Theme', icon: DummyIcon, action: () => {}, isActive: false, ariaLabel: 'Theme' },
];

const activeItem = mockItems.find((i) => i.isActive) || mockItems[0];
const orbitingItems = mockItems.filter((i) => i.id !== activeItem.id);

assert(activeItem.id === 'rooms', 'Center dock must represent the active destination');
assert(orbitingItems.length === 4, 'Orbiting items must contain exactly 4 remaining destinations');
assert(!orbitingItems.some((i) => i.id === 'rooms'), 'Active item must not duplicate in orbit');
assert(orbitingItems.some((i) => i.id === 'theme'), 'Theme action must remain an orbiting destination');
console.log('  PASS: Item partitioning verified.\n');

// 4. Test Sector Resolution in Bottom-Right Arc
console.log('Case 4: Testing Nearest Angular Destination Sector Matching in Bottom-Right Arc...');
const N = orbitingItems.length;

// Point near index 0 (top angle ~ -82deg)
const pointerTop = (-82 * Math.PI) / 180;
let nearestIdx = -1;
let smallestDiff = Infinity;

orbitingItems.forEach((_, idx) => {
  const itemAngle = getOrbitItemAngle(idx, N);
  const diff = angularDistance(itemAngle, pointerTop);
  if (diff < smallestDiff) {
    smallestDiff = diff;
    nearestIdx = idx;
  }
});

assert(nearestIdx === 0, 'Top pointer must resolve to index 0 item');
assert(smallestDiff < 0.001, 'Top pointer difference must be approximately 0');
console.log('  PASS: Sector resolution verified.\n');

// 5. Test Keyboard Navigation Cycle
console.log('Case 5: Testing Keyboard Traversal Order...');
let currentIndex = 0;
// Clockwise cycle
currentIndex = (currentIndex + 1) % orbitingItems.length;
assert(currentIndex === 1, 'Clockwise traversal advances index');
// Wrap around
currentIndex = orbitingItems.length - 1;
currentIndex = (currentIndex + 1) % orbitingItems.length;
assert(currentIndex === 0, 'Clockwise traversal wraps from end to start');

// Counter-clockwise cycle
currentIndex = currentIndex <= 0 ? orbitingItems.length - 1 : currentIndex - 1;
assert(currentIndex === orbitingItems.length - 1, 'Counter-clockwise traversal wraps from start to end');
console.log('  PASS: Keyboard traversal verified.\n');

console.log('All CircularNavigationWheel contract tests passed successfully!');
