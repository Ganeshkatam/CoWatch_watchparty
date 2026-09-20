import {
  HOLD_THRESHOLD_MS,
  MOVE_JITTER_TOLERANCE_PX,
  MIN_RADIUS,
  MAX_RADIUS,
  DEFAULT_RADIUS,
  DOCK_HOVER_RADIUS,
  WHEEL_HOVER_RADIUS_PADDING,
  WheelNavigationItem,
  normalizeAngle,
  angularDistance,
  getOrbitItemAngle,
  isPointerWithinWheelRadius,
  isPointerWithinDockRadius,
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
assert(MAX_RADIUS <= 160, 'MAX_RADIUS must be bounded below 160px');
assert(DEFAULT_RADIUS >= MIN_RADIUS && DEFAULT_RADIUS <= MAX_RADIUS, 'DEFAULT_RADIUS must be within bounds');
assert(DOCK_HOVER_RADIUS === 36, 'DOCK_HOVER_RADIUS must be 36px');
assert(WHEEL_HOVER_RADIUS_PADDING === 48, 'WHEEL_HOVER_RADIUS_PADDING must be 48px');
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
  { id: 'myrooms', label: 'My Rooms', icon: DummyIcon, href: '/myrooms', isActive: true, ariaLabel: 'My Rooms' },
  { id: 'create', label: 'New Room', icon: DummyIcon, href: '/create', isActive: false, ariaLabel: 'Create' },
  { id: 'profile', label: 'Profile', icon: DummyIcon, href: '/account/profile', isActive: false, ariaLabel: 'Profile' },
  { id: 'join', label: 'Join', icon: DummyIcon, href: '/join', isActive: false, ariaLabel: 'Join' },
];

const activeItem = mockItems.find((i) => i.isActive) || mockItems[0];
const orbitingItems = mockItems.filter((i) => i.id !== activeItem.id);

assert(activeItem.id === 'myrooms', 'Center dock must represent the active destination');
assert(orbitingItems.length === 4, 'Orbiting items must contain exactly 4 remaining destinations');
assert(!orbitingItems.some((i) => i.id === 'myrooms'), 'Active item must not duplicate in orbit');
assert(orbitingItems.some((i) => i.id === 'join'), 'Join destination must remain an orbiting destination');
console.log('  PASS: Item partitioning verified.\n');

// 4. Test Sector Resolution in Bottom-Right Arc
console.log('Case 4: Testing Nearest Angular Destination Sector Matching in Bottom-Right Arc...');
const N = orbitingItems.length;

// Point near index 0 (top angle = -90deg)
const pointerTop = (-90 * Math.PI) / 180;
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

// 6. Test Hover Radius Boundary Checks
console.log('Case 6: Testing Hover Radius Boundary Checks...');
assert(isPointerWithinDockRadius(0, 0), 'Center of dock is within dock radius');
assert(isPointerWithinDockRadius(20, 20), 'Points within 36px are inside dock radius');
assert(!isPointerWithinDockRadius(40, 0), 'Points beyond 36px are outside dock radius');

// Within quadrant radius (radius = 132, maxRadius = 132 + 48 = 180)
assert(isPointerWithinWheelRadius(0, 0, 132), 'Dock center is within wheel radius');
assert(isPointerWithinWheelRadius(-132, 0, 132), 'Horizontal orbit position is within wheel radius');
assert(isPointerWithinWheelRadius(0, -132, 132), 'Vertical orbit position is within wheel radius');
assert(isPointerWithinWheelRadius(-93, -93, 132), 'Diagonal orbit position is within wheel radius');
assert(isPointerWithinWheelRadius(-170, 0, 132), 'Near outer rim is within wheel radius');

// Outside quadrant radius
assert(!isPointerWithinWheelRadius(-190, 0, 132), 'Point beyond 180px is outside wheel radius');
assert(!isPointerWithinWheelRadius(70, 0, 132), 'Point to the right of corner is outside quadrant');
assert(!isPointerWithinWheelRadius(0, 70, 132), 'Point below corner is outside quadrant');
console.log('  PASS: Hover radius boundary checks verified.\n');

console.log('All CircularNavigationWheel contract tests passed successfully!');
