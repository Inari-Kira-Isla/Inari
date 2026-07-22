// Client-side auth hook — asks the server (GET /api/auth/me) which reads the
// real HttpOnly `inari_auth_v3` session cookie (JS can never read it directly).
// 2026-07-23: rewritten — this file previously read a client-visible
// `inari_auth_v2` cookie that the backend stopped setting once it moved to
// HttpOnly `inari_auth_v3` JWT sessions (security hardening). Every page using
// getAuth() would briefly render then bounce back to /shop/login because
// isLoggedIn was always false, even with a fully valid server-side session
// (found during 2026-07-23 QR login UAT — same root cause blocked normal
// username/password login too, not just QR).
// Returns {user, isStaff, isLoggedIn}

export async function getAuth() {
  try {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!resp.ok) return { user: null, isStaff: false, isLoggedIn: false };
    const data = await resp.json();
    return {
      user: {
        username: data.username,
        user_type: data.user_type,
        customer_code: data.customer_code || null,
      },
      isStaff: !!data.is_staff,
      isLoggedIn: true,
    };
  } catch {
    return { user: null, isStaff: false, isLoggedIn: false };
  }
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // ignore — still redirect below even if the call fails
  }
  window.location.href = '/shop/login';
}
