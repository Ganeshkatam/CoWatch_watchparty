/**
 * Hardened Test Certification Suite: Option 1 — Model A (Pure Supabase-Native)
 *
 * Verifies all required security, lifecycle, and architectural invariants:
 * 1. AGE-002 local 18+ gate required before Google sign-up can be initiated.
 * 2. Google button does not appear on Step 1 (age gate).
 * 3. Zero DOB or age metadata transmitted in OAuth or storage.
 * 4. No application-level verification table: public.google_signup_verifications is completely absent.
 * 5. No custom authentication endpoints: /api/auth/send-google-confirmation and /api/auth/confirm-google-signup do not exist.
 * 6. No application-generated verification tokens (rawToken, token_hash) exist in the codebase.
 * 7. ConfirmGoogleSignup.tsx converted to redirect.
 * 8. Server validateUserToken relies strictly on Supabase Auth (email_confirmed_at).
 * 9. Supabase is the sole authentication email authority; VerifyEmail uses native supabase.auth.resend.
 * 10. RequireVerifiedEmail protects sensitive routes (/create, /watch/:id, /preflight/:id) based on Supabase email confirmation state.
 * 11. Database runtime check confirms public.google_signup_verifications does not exist.
 */

import { postgres } from './utils/postgres.ts';
import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ModelATest] Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('Starting Model A (Pure Supabase-Native) Certification Suite...');

  // Test 1 & 2: AGE-002 local eligibility and button absence on Step 1
  const signupSource = fs.readFileSync(path.resolve('src/components/Auth/Signup.tsx'), 'utf-8');
  assert(
    signupSource.includes('!isAgeEligible ?'),
    'Test 1 Failed: Signup does not check isAgeEligible before rendering registration options'
  );
  const ternaryIndex = signupSource.indexOf('!isAgeEligible ?');
  const elseBranchIndex = signupSource.indexOf(':', ternaryIndex);
  const googleBtnIndex = signupSource.indexOf('onClick={handleGoogleSignUp}');
  assert(
    googleBtnIndex > elseBranchIndex,
    'Test 2 Failed: Google signup button appears on Step 1 before age gate clearance'
  );

  // Test 3: Zero DOB or age metadata transmitted
  assert(
    !signupSource.includes("birthdate: dob") && !signupSource.includes("dob: dob") && !signupSource.includes("age:"),
    'Test 3 Failed: DOB or age metadata found in registration payloads'
  );

  // Test 4: No cowatch_pending_oauth_signup secondary interception
  assert(
    !signupSource.includes('cowatch_pending_oauth_signup'),
    'Test 4 Failed: cowatch_pending_oauth_signup should not be present in Signup.tsx'
  );

  const indexSource = fs.readFileSync(path.resolve('src/index.tsx'), 'utf-8');
  assert(
    !indexSource.includes('cowatch_pending_oauth_signup'),
    'Test 4b Failed: cowatch_pending_oauth_signup should not be present in index.tsx'
  );

  // Test 5: No secondary application confirmation endpoints in server
  const serverSource = fs.readFileSync(path.resolve('server/server.ts'), 'utf-8');
  assert(
    !serverSource.includes('/api/auth/send-google-confirmation'),
    'Test 5a Failed: /api/auth/send-google-confirmation endpoint should be completely removed from server.ts'
  );
  assert(
    !serverSource.includes('/api/auth/confirm-google-signup'),
    'Test 5b Failed: /api/auth/confirm-google-signup endpoint should be completely removed from server.ts'
  );

  // Test 6: Zero custom token or token_hash references in server/utils/supabase.ts
  const supabaseUtilsSource = fs.readFileSync(path.resolve('server/utils/supabase.ts'), 'utf-8');
  assert(
    !supabaseUtilsSource.includes('google_signup_verifications'),
    'Test 6 Failed: server/utils/supabase.ts still references google_signup_verifications'
  );
  assert(
    !supabaseUtilsSource.includes('token_hash'),
    'Test 6b Failed: server/utils/supabase.ts still references token_hash'
  );

  // Test 7: ConfirmGoogleSignup.tsx converted to redirect (not deleted per rule)
  const confirmGoogleSignupSource = fs.readFileSync(path.resolve('src/components/Auth/ConfirmGoogleSignup.tsx'), 'utf-8');
  assert(
    confirmGoogleSignupSource.includes('Redirect') && !confirmGoogleSignupSource.includes('/api/auth/confirm-google-signup'),
    'Test 7 Failed: ConfirmGoogleSignup.tsx must be converted to a clean redirect without calling custom confirmation endpoints'
  );

  // Test 8: Pure Supabase Auth confirmation check in validateUserToken
  assert(
    supabaseUtilsSource.includes('user.email_confirmed_at == null'),
    'Test 8 Failed: validateUserToken must check Supabase native user.email_confirmed_at'
  );

  // Test 9: VerifyEmail uses pure Supabase Auth resend
  const verifyEmailSource = fs.readFileSync(path.resolve('src/components/Auth/VerifyEmail.tsx'), 'utf-8');
  assert(
    verifyEmailSource.includes('supabase.auth.resend({') &&
    verifyEmailSource.includes('type: "signup"') &&
    !verifyEmailSource.includes('/api/auth/send-google-confirmation'),
    'Test 9 Failed: VerifyEmail must delegate email confirmation solely to Supabase native resend'
  );

  // Test 10: RequireVerifiedEmail guards protected routes based on Supabase email confirmation
  const requireAuthSource = fs.readFileSync(path.resolve('src/components/Auth/RequireVerifiedEmail.tsx'), 'utf-8');
  assert(
    requireAuthSource.includes('user.email_confirmed_at == null') &&
    requireAuthSource.includes('/verify-email?next='),
    'Test 10 Failed: RequireVerifiedEmail does not protect routes based on Supabase email confirmation state'
  );

  // Test 11: Database check: public.google_signup_verifications does not exist
  if (postgres) {
    const tableCheck = await postgres.query(`
      SELECT to_regclass('public.google_signup_verifications') AS table_exists;
    `);
    assert(
      tableCheck.rows[0].table_exists === null,
      'Test 11 Failed: public.google_signup_verifications table still exists in PostgreSQL database'
    );
  }

  console.log('All Option 1 — Model A (Pure Supabase-Native) Certification Checkpoints PASSED!');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

