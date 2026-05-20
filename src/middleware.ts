import { defineMiddleware } from 'astro:middleware';
import { verifyJWT } from './lib/jwt';

const COOKIE_V3 = 'inari_auth_v3';
const COOKIE_V2 = 'inari_auth_v2'; // legacy — readable but no longer issued
const COOKIE_V1 = 'inari_auth';    // legacy — single-password staff
const SHOP_LOGIN = '/shop/login';

// Public paths: no auth check
const PUBLIC_PREFIXES = [
  '/shop/login',
  '/login',
  '/api/login',
  '/api/shop-login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/retail/',
  '/api/chat',
  '/api/knowledge',
  '/api/seasonal',
  '/api/brand',
  '/api/products/search',
  '/brand',
  '/knowledge',
  '/market',
  '/salmon',
  '/sea-urchin',
  '/faq',
  '/blog',
  '/_astro',
];

const PUBLIC_EXACT = new Set(['/', '/login']);

// Route → minimum user_type(s) required
const ROUTE_GUARDS: Array<[string, string[]]> = [
  ['/admin',     ['manager']],
  ['/wholesale', ['wholesale', 'manager']],
  ['/account',   ['wholesale', 'manager']],
  ['/shop/admin',['staff', 'manager']],
  ['/shop',      ['staff', 'manager', 'wholesale']],
  ['/retail',    ['retail']],
];

function getCookie(header: string, name: string): string | null {
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

// Legacy v2: base64 JSON, no signature — read-only during transition
function parseV2Legacy(token: string): Record<string, unknown> | null {
  try {
    const s = JSON.parse(atob(token)) as Record<string, unknown>;
    if (s.v !== 2) return null;
    if (s.exp && (s.exp as number) < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch {
    return null;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  // Static assets — always pass
  if (/\.(css|js|svg|ico|png|jpg|jpeg|webp|woff2?)(\?.*)?$/.test(path)) return next();

  // Public exact paths
  if (PUBLIC_EXACT.has(path)) return next();

  // Public prefix paths
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return next();

  const cookie = context.request.headers.get('Cookie') || '';
  const jwtSecret = import.meta.env.JWT_SECRET || '';

  let userType = '';
  let userId = '';
  let username = '';
  let customerCode = '';

  // 1. Try v3 JWT (primary)
  const v3Token = getCookie(cookie, COOKIE_V3);
  if (v3Token && jwtSecret) {
    const payload = await verifyJWT(v3Token, jwtSecret);
    if (payload) {
      userType = payload.user_type;
      userId = payload.sub;
      username = payload.username;
      customerCode = payload.customer_code ?? '';
    }
  }

  // 2. Fall back to legacy v2 (transition period — no JWT_SECRET needed)
  if (!userType) {
    const v2Token = getCookie(cookie, COOKIE_V2);
    if (v2Token) {
      const s = parseV2Legacy(v2Token);
      if (s) {
        userType = (s.user_type as string) || 'staff';
        userId = (s.id as string) || '';
        username = (s.username as string) || '';
        customerCode = (s.customer_code as string) || '';
      }
    }
  }

  // 3. Fall back to legacy v1 (single-password staff)
  if (!userType) {
    const v1Token = getCookie(cookie, COOKIE_V1);
    const expected = import.meta.env.SITE_PASSWORD || 'inari2026';
    if (v1Token && v1Token === btoa(expected)) {
      userType = 'staff';
      userId = '';
      username = 'staff';
      customerCode = '';
    }
  }

  // Inject into locals if authenticated
  if (userType) {
    context.locals.userId = userId;
    context.locals.userType = userType;
    context.locals.username = username;
    context.locals.customerCode = customerCode;
    context.locals.isStaff = userType === 'staff' || userType === 'manager';
    context.locals.userRole = userType;
  }

  // Check route guards
  for (const [prefix, allowed] of ROUTE_GUARDS) {
    if (path.startsWith(prefix)) {
      if (!userType || !allowed.includes(userType)) {
        const next_param = encodeURIComponent(path);
        return context.redirect(`${SHOP_LOGIN}?next=${next_param}`, 302);
      }
      break;
    }
  }

  return next();
});
