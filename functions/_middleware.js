const COOKIE_NAME = "inari_auth";
const COOKIE_V2 = "inari_auth_v2";
const LOGIN_PATH = "/login";
const SHOP_LOGIN_PATH = "/shop/login";

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function parseV2Token(token) {
  try {
    const decoded = atob(token);
    const session = JSON.parse(decoded);
    if (session.v !== 2) return null;
    if (session.exp && session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Public paths — no auth required
  if (
    path.startsWith(LOGIN_PATH) ||
    path.startsWith(SHOP_LOGIN_PATH) ||
    path === "/api/login" ||
    path === "/api/shop-login" ||
    path === "/api/chat" ||
    path === "/api/knowledge" ||
    path.match(/\.(css|js|svg|ico|png|jpg|woff2?)$/)
  ) {
    return context.next();
  }

  const cookie = context.request.headers.get("Cookie") || "";

  // --- Try new v2 token (username-based login) ---
  const v2Token = getCookieValue(cookie, COOKIE_V2);
  if (v2Token) {
    const session = parseV2Token(v2Token);
    if (session) {
      const newHeaders = new Headers(context.request.headers);
      newHeaders.set("X-User-Id", session.id || "");
      newHeaders.set("X-User-Type", session.user_type || "staff");
      newHeaders.set("X-User-Role", session.role || "");
      newHeaders.set("X-Username", session.username || "");
      newHeaders.set("X-Customer-Code", session.customer_code || "");

      // Admin guard: /shop/admin requires staff or manager
      if (path.startsWith("/shop/admin")) {
        const userType = session.user_type || "staff";
        if (userType !== "staff" && userType !== "manager") {
          return Response.redirect(new URL(SHOP_LOGIN_PATH, context.request.url), 302);
        }
      }

      // Pass modified request explicitly — context.next() uses the passed request,
      // NOT context.request, so we must pass it here
      return context.next(new Request(context.request, { headers: newHeaders }));
    }
  }

  // --- Fallback: legacy single-password token (staff) ---
  const v1Token = getCookieValue(cookie, COOKIE_NAME);
  const expectedPassword = context.env.SITE_PASSWORD || "inari2026";
  if (v1Token && v1Token === btoa(expectedPassword)) {
    const newHeaders = new Headers(context.request.headers);
    newHeaders.set("X-User-Type", "staff");
    newHeaders.set("X-User-Role", "staff");
    newHeaders.set("X-Username", "staff");

    if (path.startsWith("/shop/admin")) {
      // v1 token is always staff — allowed
    }

    return context.next(new Request(context.request, { headers: newHeaders }));
  }

  // --- Shop routes require shop login ---
  if (path.startsWith("/shop")) {
    return Response.redirect(new URL(SHOP_LOGIN_PATH, context.request.url), 302);
  }

  // --- Other routes: redirect to main login ---
  return Response.redirect(new URL(LOGIN_PATH, context.request.url), 302);
}
