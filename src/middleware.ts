import { defineMiddleware } from 'astro:middleware';

const COOKIE_NAME = 'inari_auth';
const COOKIE_V2 = 'inari_auth_v2';
const LOGIN_PATH = '/login';
const SHOP_LOGIN_PATH = '/shop/login';

function getCookieValue(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function parseV2Token(token: string): Record<string, unknown> | null {
  try {
    const decoded = atob(token);
    const session = JSON.parse(decoded) as Record<string, unknown>;
    if (session.v !== 2) return null;
    if (session.exp && (session.exp as number) < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  // Public paths — no auth required
  if (
    path.startsWith(LOGIN_PATH) ||
    path.startsWith(SHOP_LOGIN_PATH) ||
    path === '/api/login' ||
    path === '/api/shop-login' ||
    path === '/api/chat' ||
    path === '/api/knowledge' ||
    path.match(/\.(css|js|svg|ico|png|jpg|woff2?)$/)
  ) {
    return next();
  }

  const cookie = context.request.headers.get('Cookie') || '';

  // --- Try new v2 token (username-based login) ---
  const v2Token = getCookieValue(cookie, COOKIE_V2);
  if (v2Token) {
    const session = parseV2Token(v2Token);
    if (session) {
      // Pass user context via locals (Astro pattern)
      context.locals.userId = (session.id as string) || '';
      context.locals.userType = (session.user_type as string) || 'staff';
      context.locals.userRole = (session.role as string) || '';
      context.locals.username = (session.username as string) || '';
      context.locals.customerCode = (session.customer_code as string) || '';
      context.locals.isStaff =
        session.user_type === 'staff' || session.user_type === 'manager';

      // Admin guard: /shop/admin requires staff or manager
      if (path.startsWith('/shop/admin')) {
        const userType = (session.user_type as string) || 'staff';
        if (userType !== 'staff' && userType !== 'manager') {
          return context.redirect(SHOP_LOGIN_PATH, 302);
        }
      }

      return next();
    }
  }

  // --- Fallback: legacy single-password token (staff) ---
  const v1Token = getCookieValue(cookie, COOKIE_NAME);
  const expectedPassword = import.meta.env.SITE_PASSWORD || 'inari2026';
  if (v1Token && v1Token === btoa(expectedPassword)) {
    context.locals.userId = '';
    context.locals.userType = 'staff';
    context.locals.userRole = 'staff';
    context.locals.username = 'staff';
    context.locals.customerCode = '';
    context.locals.isStaff = true;

    // v1 token is always staff — /shop/admin is allowed
    return next();
  }

  // --- Shop routes require shop login ---
  if (path.startsWith('/shop')) {
    return context.redirect(SHOP_LOGIN_PATH, 302);
  }

  // --- Other routes: redirect to main login ---
  return context.redirect(LOGIN_PATH, 302);
});
