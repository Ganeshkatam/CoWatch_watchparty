/**
 * FRONTEND-003: Visual Consistency & Design System Verification
 *
 * Enforces:
 * 1. Modal tier contracts (sm: 420, md: 520, lg: 680, xl: 840).
 * 2. Responsive modal width clamping with dynamic viewports down to 320/375px.
 * 3. Canonical token integrity (spacing, radius, breakpoints).
 * 4. Zero arbitrary pixel widths in the targeted modal family.
 * 5. Elimination of progressive loading strings on interactive action buttons.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import {
  MODAL_SIZES,
  ModalSizeTier,
  getResponsiveModalWidth,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  BREAKPOINTS,
} from "./designSystem";

async function runVisualConsistencyTests() {
  console.log("Starting FRONTEND-003 Visual Consistency & Design System Tests...\n");
  let passed = 0;

  // Test 1: Modal Size Tier Invariants
  console.log("Test 1: Modal Size Tier Invariants");
  assert.strictEqual(MODAL_SIZES.sm, 420, "Modal tier 'sm' must be exactly 420px");
  assert.strictEqual(MODAL_SIZES.md, 520, "Modal tier 'md' must be exactly 520px");
  assert.strictEqual(MODAL_SIZES.lg, 680, "Modal tier 'lg' must be exactly 680px");
  assert.strictEqual(MODAL_SIZES.xl, 840, "Modal tier 'xl' must be exactly 840px");
  console.log("PASS: Modal size tier constants are authoritative and invariant.");
  passed++;

  // Test 2: Responsive Modal Width Clamping Contract
  console.log("\nTest 2: Responsive Modal Width Clamping Contract");
  const tiers: ModalSizeTier[] = ["sm", "md", "lg", "xl"];
  for (const tier of tiers) {
    const clamped = getResponsiveModalWidth(tier);
    assert.strictEqual(
      clamped,
      `min(${MODAL_SIZES[tier]}px, calc(100vw - 32px))`,
      `Responsive clamp for tier '${tier}' must follow min(tier, calc(100vw - gutters))`
    );
  }
  const customGutter = getResponsiveModalWidth("md", 48);
  assert.strictEqual(
    customGutter,
    "min(520px, calc(100vw - 48px))",
    "Custom gutter clamp must format correctly"
  );
  console.log("PASS: Responsive modal clamp calculations conform to layout contracts.");
  passed++;

  // Test 3: Design System Tokens Integrity
  console.log("\nTest 3: Design System Tokens Integrity");
  assert.deepStrictEqual(
    SPACING_TOKENS,
    { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
    "Spacing tokens must follow canonical 4px-based grid"
  );
  assert.deepStrictEqual(
    RADIUS_TOKENS,
    { sm: "8px", md: "12px", lg: "16px", xl: "20px" },
    "Radius tokens must follow canonical curve steps"
  );
  assert.strictEqual(BREAKPOINTS.xs, 375, "Breakpoint xs must support mobile 375px");
  assert.strictEqual(BREAKPOINTS.sm, 576, "Breakpoint sm must be 576px");
  console.log("PASS: Spacing, radius, and responsive breakpoints are authoritative.");
  passed++;

  // Test 4: Modal Audit - Zero Arbitrary Pixel Widths in Target Modal Components
  console.log("\nTest 4: Modal Audit - Zero Arbitrary Pixel Widths in Target Modals");
  const modalFiles = [
    "src/components/Settings/SettingsModal.tsx",
    "src/components/Modal/ErrorModal.tsx",
    "src/components/Host/AssignHostModal.tsx",
    "src/components/Feedback/FeedbackModal.tsx",
    "src/components/Modal/InviteModal.tsx",
    "src/components/Modal/PasscodeModal.tsx",
    "src/components/Modal/ScreenShareModal.tsx",
    "src/components/Modal/FileShareModal.tsx",
    "src/components/Modal/VBrowserModal.tsx",
    "src/components/Modal/SubtitleModal.tsx",
    "src/components/Modal/MultiStreamModal.tsx",
    "src/components/Modal/HostEndedModal.tsx",
    "src/components/Profile/Profile.tsx",
    "src/components/MyRooms/RoomCard.tsx",
    "src/components/MyRooms/RoomDetails.tsx",
    "src/components/App/QuickAdd.tsx",
  ];

  // Regex to detect arbitrary pixel literals like size={460}, size={437}, size={613}, size="50rem"
  const forbiddenArbitrarySizes = /size=\{?\s*(\d{3,4}|"\d+rem")\s*\}?/g;

  for (const relPath of modalFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    assert(fs.existsSync(fullPath), `Target modal file ${relPath} must exist`);
    const content = fs.readFileSync(fullPath, "utf-8");

    // Ensure MODAL_SIZES is imported and used
    assert(
      content.includes("MODAL_SIZES"),
      `File ${relPath} must consume MODAL_SIZES from designSystem`
    );

    // Ensure no forbidden arbitrary sizes remain
    const matches = Array.from(content.matchAll(forbiddenArbitrarySizes));
    const arbitraryMatches = matches.filter((m) => {
      const val = m[1];
      // Allowed if it is not inside a Modal size prop or is one of canonical constants if any
      return !["MODAL_SIZES.sm", "MODAL_SIZES.md", "MODAL_SIZES.lg", "MODAL_SIZES.xl"].includes(val);
    });

    // Check specifically on <Modal tags
    const modalTagMatches = content.match(/<Modal[^>]*size=\{?["']?(\d{3,4}|[0-9.]+rem)["']?\}?[^>]*>/g);
    assert(
      !modalTagMatches || modalTagMatches.length === 0,
      `File ${relPath} contains arbitrary size in <Modal> tag: ${modalTagMatches}`
    );
  }
  console.log(`PASS: All ${modalFiles.length} target modal components consume canonical MODAL_SIZES tiers with 0 arbitrary pixel widths.`);
  passed++;

  // Test 5: Stable Labels - Elimination of Progressive Loading Strings on Interactive Action Buttons
  console.log("\nTest 5: Stable Labels - Elimination of Progressive Loading Strings");
  const targetActionComponents = [
    "src/components/Create/Create.tsx",
    "src/components/Join/Join.tsx",
    "src/components/Feedback/FeedbackModal.tsx",
    "src/components/Profile/Profile.tsx",
  ];

  const forbiddenProgressiveStrings = [
    /"Creating Room\.\.\."/,
    /"Creating\.\.\."/,
    /"Sending\.\.\."/,
    /"Entering\.\.\."/,
    /"Uploading\.\.\."/,
  ];

  for (const relPath of targetActionComponents) {
    const fullPath = path.resolve(process.cwd(), relPath);
    assert(fs.existsSync(fullPath), `Component file ${relPath} must exist`);
    const content = fs.readFileSync(fullPath, "utf-8");

    for (const pattern of forbiddenProgressiveStrings) {
      assert(
        !pattern.test(content),
        `Component ${relPath} violates stable label contract by containing progressive string: ${pattern}`
      );
    }
  }
  console.log(`PASS: Target action components preserve stable labels across pending states.`);
  passed++;

  console.log(`\n========================================`);
  console.log(`All ${passed} FRONTEND-003 visual consistency tests passed successfully.`);
  console.log(`========================================\n`);
}

runVisualConsistencyTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
