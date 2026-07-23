import { defineMiddleware } from 'astro:middleware';
import { verifyJWT } from './lib/jwt';

const COOKIE_V3 = 'inari_auth_v3';
const SHOP_LOGIN = '/shop/login';
// legacy v1(單密碼)/v2(無簽名 base64)cookie 已移除:兩者都可被偽造(v2 冇 HMAC、v1 硬編碼密碼),
// 係全站淪陷級洞。唯一有效 session = 簽名 v3 JWT。舊 cookie 用戶要重新登入一次。

// Public paths: no auth check
const PUBLIC_PREFIXES = [
  '/shop/login',
  '/login',
  '/api/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/retail/',
  '/api/chat',
  '/api/knowledge',
  '/api/seasonal',
  '/api/brand',
  '/api/products/search',
  // B2C guest 下單(2026-07-23新增,Joe拍板:免密碼,完全獨立命名空間,同 /shop 嘅B2B app無關)
  // ⚠️ '/api/order' 用trailing slash prefix,唔可以裸字串——'/api/orders'(B2B訂單API)都係以
  // '/api/order'開頭,裸prefix會令成個B2B訂單API被誤判做public,middleware完全唔驗證身份,
  // 令handler自己嘅locals.userType check永遠攞唔到值→永遠401(07-23 E2E測試揪到嘅P0 regression)。
  '/order',
  '/api/order/',
  '/brand',
  '/knowledge',
  '/market',
  '/salmon',
  '/sea-urchin',
  '/faq',
  '/blog',
  '/_astro',
];

const PUBLIC_EXACT = new Set(['/', '/login', '/api/order']);

// Route → minimum user_type(s) required.
// More specific (longer) prefixes MUST come BEFORE shorter ones since the
// loop uses startsWith and breaks on first match.
const ROUTE_GUARDS: Array<[string, string[]]> = [
  // Sensitive admin pages — manager only (matches API auth)
  ['/admin/users',     ['manager']],
  ['/admin/analytics', ['manager']],
  ['/admin/sales',     ['manager']],
  ['/admin/customers', ['manager']],
  ['/admin/suppliers', ['manager']],
  // General admin pages — staff + manager (matches API auth for products,
  // orders, inventory, knowledge)
  ['/admin',           ['staff', 'manager']],
  // Other route groups
  ['/wholesale', ['wholesale', 'manager']],
  ['/account',   ['wholesale', 'manager']],
  ['/shop/admin',['staff', 'manager']],
  ['/shop',      ['staff', 'manager', 'wholesale']],
];

function getCookie(header: string, name: string): string | null {
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
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

  // v3 JWT — 唯一有效 session。
  // purpose token(如 QR 免密碼登入 token purpose='qr')雖然係合法簽名 v3,但只准喺
  // /api/auth/retail/qr 換取真 session,唔可以直接當 session cookie 用 —— 否則 QR 撤銷機制失效。
  const v3Token = getCookie(cookie, COOKIE_V3);
  if (v3Token && jwtSecret) {
    const payload = await verifyJWT(v3Token, jwtSecret);
    if (payload && !(payload as any).purpose) {
      userType = payload.user_type;
      userId = payload.sub;
      username = payload.username;
      customerCode = payload.customer_code ?? '';
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
