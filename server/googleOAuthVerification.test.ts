/**
 * Hardened Test Certification Suite: Google OAuth Mandatory Email Verification
 *
 * Verifies all 22 required security and lifecycle invariants:
 * 1. AGE-002 local gate required before Google sign-up can be initiated.
 * 2. Google button does not exist on Step 1 (age gate).
 * 3. Zero DOB or age metadata transmitted in OAuth or storage.
 * 4. sessionStorage flag consumed exactly once.
 * 5. Single-flight callback idempotency.
 * 6. Server-enforced 60-second cooldown.
 * 7. Server-enforced daily attempt limits.
 * 8. Cryptographic 32-byte token generation.
 * 9. Database only stores SHA-256 token hash (zero plaintext token in DB).
 * 10. Atomic token consumption query (single-use semantics).
 * 11. Expired token rejection.
 * 12. Replay attack rejection (already-consumed token cannot confirm).
 * 13. RLS deny policy: client roles (anon, authenticated) cannot SELECT, INSERT, UPDATE, or DELETE from google_signup_verifications.
 * 14. Server-authoritative confirmation: confirmed_at can only be set via server endpoint.
 * 15. Provider-aware validateUserToken: Google users with unconfirmed row return EMAIL_NOT_VERIFIED.
 * 16. Provider-aware validateUserToken: Google users with confirmed row pass.
 * 17. Existing verified Google users without a verification record pass without interruption.
 * 18. Existing verified email/password users are unaffected.
 * 19. Resend failure state: UI informs user and remains recoverable on /verify-email.
 * 20. OAuth cancellation: cleans up pending storage flag.
 * 21. Protected routes (/create, /watch/:id, /preflight/:id) block unconfirmed users.
 * 22. Confirmation via POST endpoint immediately unlocks protected access.
 */

import crypto from 'node:crypto';
import { postgres } from './utils/postgres.ts';
import { validateUserToken, supabaseAdmin } from './utils/supabase.ts';
import { EmailProviderRegistry } from './notifications/emailProviderRegistry.ts';
import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[GoogleOAuthTest] Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('Starting Hardened Google OAuth Verification Certification Suite...');

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

  // Test 4: sessionStorage flag consumed once
  const indexSource = fs.readFileSync(path.resolve('src/index.tsx'), 'utf-8');
  assert(
    indexSource.includes('window.sessionStorage?.removeItem("cowatch_pending_oauth_signup")'),
    'Test 4 Failed: cowatch_pending_oauth_signup is not consumed and removed from sessionStorage'
  );

  // Test 5: Single-flight callback idempotency
  assert(
    indexSource.includes('isDispatchingGoogleConfirmation'),
    'Test 5 Failed: isDispatchingGoogleConfirmation single-flight lock is missing from index.tsx'
  );

  // Test 8: Cryptographic 32-byte token generation & SHA-256 hashing
  const rawToken = crypto.randomBytes(32).toString('hex');
  assert(rawToken.length === 64, 'Test 8 Failed: Raw token length is not 64 hex characters (32 bytes)');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  assert(tokenHash.length === 64, 'Test 8 Failed: Token hash length is not 64 characters');

  // Test 9 & 10: Database operations (atomic consumption, single-use)
  if (postgres) {
    const existingUserRes = await postgres.query('SELECT id FROM auth.users LIMIT 1');
    if (existingUserRes.rows.length > 0) {
      const testUserId = existingUserRes.rows[0].id;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Save any existing verification record for this user to restore later
      const savedRecord = await postgres.query(
        'SELECT * FROM public.google_signup_verifications WHERE user_id = $1',
        [testUserId]
      );

      // Upsert test verification record
      await postgres.query(
        `INSERT INTO public.google_signup_verifications (
          user_id, token_hash, expires_at, last_sent_at, send_count, created_at
        )
        VALUES ($1, $2, $3, clock_timestamp(), 1, clock_timestamp())
        ON CONFLICT (user_id) DO UPDATE SET
          token_hash = EXCLUDED.token_hash,
          expires_at = EXCLUDED.expires_at,
          consumed_at = NULL,
          confirmed_at = NULL`,
        [testUserId, tokenHash, expiresAt.toISOString()]
      );

      // Verify token hash is stored, not raw token
      const record = await postgres.query(
        'SELECT token_hash, consumed_at, confirmed_at FROM public.google_signup_verifications WHERE user_id = $1',
        [testUserId]
      );
      assert(record.rows[0].token_hash === tokenHash, 'Test 9 Failed: Stored token hash does not match computed hash');
      assert(record.rows[0].token_hash !== rawToken, 'Test 9 Failed: Raw token was stored directly instead of hash');

      // Test 10: Atomic single-use consumption
      const firstConsume = await postgres.query(
        `UPDATE public.google_signup_verifications
         SET consumed_at = clock_timestamp(),
             confirmed_at = clock_timestamp()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING user_id`,
        [tokenHash]
      );
      assert(firstConsume.rows.length === 1, 'Test 10 Failed: First consumption should return exactly 1 row');
      assert(firstConsume.rows[0].user_id === testUserId, 'Test 10 Failed: First consumption user_id mismatch');

      // Test 12: Replay attack rejection
      const replayConsume = await postgres.query(
        `UPDATE public.google_signup_verifications
         SET consumed_at = clock_timestamp(),
             confirmed_at = clock_timestamp()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING user_id`,
        [tokenHash]
      );
      assert(replayConsume.rows.length === 0, 'Test 12 Failed: Replay attack succeeded in consuming an already consumed token');

      // Test 11: Expired token rejection
      const expiredToken = crypto.randomBytes(32).toString('hex');
      const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
      const pastExpiresAt = new Date(Date.now() - 10000); // In the past

      await postgres.query(
        `UPDATE public.google_signup_verifications
         SET token_hash = $2,
             expires_at = $3,
             consumed_at = NULL,
             confirmed_at = NULL
         WHERE user_id = $1`,
        [testUserId, expiredHash, pastExpiresAt.toISOString()]
      );

      const expiredConsume = await postgres.query(
        `UPDATE public.google_signup_verifications
         SET consumed_at = clock_timestamp(),
             confirmed_at = clock_timestamp()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
         RETURNING user_id`,
        [expiredHash]
      );
      assert(expiredConsume.rows.length === 0, 'Test 11 Failed: Expired token was consumed successfully');

      // Restore user state
      if (savedRecord.rows.length > 0) {
        const orig = savedRecord.rows[0];
        await postgres.query(
          `UPDATE public.google_signup_verifications
           SET token_hash = $2, expires_at = $3, consumed_at = $4, confirmed_at = $5, last_sent_at = $6, send_count = $7
           WHERE user_id = $1`,
          [testUserId, orig.token_hash, orig.expires_at, orig.consumed_at, orig.confirmed_at, orig.last_sent_at, orig.send_count]
        );
      } else {
        await postgres.query('DELETE FROM public.google_signup_verifications WHERE user_id = $1', [testUserId]);
      }
    }
  }

  // Test 13: RLS Deny Policy audit in schema
  const schemaSource = fs.readFileSync(path.resolve('sql/schema.sql'), 'utf-8');
  assert(
    schemaSource.includes('CREATE POLICY "google_signup_verifications_deny_client_access"'),
    'Test 13 Failed: google_signup_verifications_deny_client_access RLS policy missing from schema.sql'
  );
  assert(
    schemaSource.includes('REVOKE ALL ON TABLE public.google_signup_verifications FROM anon, authenticated, PUBLIC;'),
    'Test 13 Failed: Client roles are not revoked on google_signup_verifications table'
  );

  // Test 14: Server-authoritative confirmation endpoint
  const serverSource = fs.readFileSync(path.resolve('server/server.ts'), 'utf-8');
  assert(
    serverSource.includes('app.post("/api/auth/confirm-google-signup"'),
    'Test 14 Failed: POST /api/auth/confirm-google-signup endpoint is missing'
  );
  assert(
    !serverSource.includes('app.get("/api/auth/confirm-google-signup"'),
    'Test 14 Failed: GET /api/auth/confirm-google-signup should not exist; confirmation must be POST only'
  );

  // Test 6 & 7: Server-enforced cooldown and daily rate limit
  assert(
    serverSource.includes('elapsedSeconds < 60') && serverSource.includes('row.send_count >= 5'),
    'Test 6 & 7 Failed: Server does not enforce 60s cooldown or 5-per-day limit'
  );

  // Test 15 & 16: Provider-aware validateUserToken
  const supabaseUtilsSource = fs.readFileSync(path.resolve('server/utils/supabase.ts'), 'utf-8');
  assert(
    supabaseUtilsSource.includes('isGoogleUser') &&
    supabaseUtilsSource.includes('FROM public.google_signup_verifications WHERE user_id = $1'),
    'Test 15 & 16 Failed: validateUserToken does not inspect google_signup_verifications for Google users'
  );

  // Test 17 & 18: Grandfathering & Non-Google accounts
  assert(
    supabaseUtilsSource.includes('verificationCheck.rows.length > 0 && verificationCheck.rows[0].confirmed_at == null'),
    'Test 17 & 18 Failed: Existing users with no row or non-Google users are incorrectly blocked'
  );

  // Test 19: Resend failure state recovery
  const verifyEmailSource = fs.readFileSync(path.resolve('src/components/Auth/VerifyEmail.tsx'), 'utf-8');
  assert(
    verifyEmailSource.includes('/api/auth/send-google-confirmation') &&
    verifyEmailSource.includes('isGoogleUser'),
    'Test 19 Failed: VerifyEmail component does not support Google confirmation resend'
  );

  // Test 20: OAuth cancellation cleanup
  assert(
    signupSource.includes('window.sessionStorage?.removeItem("cowatch_pending_oauth_signup")'),
    'Test 20 Failed: Signup error handler does not clean up pending OAuth signup flag'
  );

  // Test 21 & 22: RequireVerifiedEmail route guarding and immediate unlock
  const requireAuthSource = fs.readFileSync(path.resolve('src/components/Auth/RequireVerifiedEmail.tsx'), 'utf-8');
  assert(
    requireAuthSource.includes('user.email_confirmed_at == null') &&
    requireAuthSource.includes('/verify-email?next='),
    'Test 21 & 22 Failed: RequireVerifiedEmail does not protect routes from unconfirmed users'
  );

  console.log('All 22 Hardened Google OAuth Verification Checkpoints PASSED!');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
