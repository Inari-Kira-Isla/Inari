import { test } from '@playwright/test';

test('QR login exchanges a registered purpose token for a wholesale session', async () => {
  /*
   * Intentionally skipped in local E2E:
   *
   * A valid URL cannot be constructed from customer_code alone. The QR token must
   * be signed with the server JWT_SECRET, contain purpose="qr" plus a unique jti,
   * and that jti must already be registered (not revoked or expired) in the
   * Supabase inari_qr_tokens table. Creating it through POST /api/admin/qr also
   * requires an authenticated staff/manager session and SUPABASE_SERVICE_KEY (or
   * SUPABASE_ANON_KEY). The endpoint builds the scanned URL from Host /
   * X-Forwarded-Host and X-Forwarded-Proto, so production proxy behaviour is part
   * of what this case needs to verify.
   *
   * Production/UAT coverage should:
   * 1. Log in as a manager and POST /api/admin/qr for TEST-UAT.
   * 2. Read the returned `url` (or decode `dataUrl`) and assert its public host.
   * 3. Open that URL in a fresh browser context.
   * 4. Assert redirect to /shop/order/new, an inari_auth_v3 cookie, and access to
   *    the wholesale order flow without being redirected to /shop/login.
   */
  test.skip(
    true,
    'Requires manager auth, JWT/Supabase secrets, registered QR jti, and production forwarded-host behaviour.',
  );
});
