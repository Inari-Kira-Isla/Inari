const COOKIE_NAME = "inari_auth";
const LOGIN_PATH = "/login";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // 不保護靜態資源和 login 頁面本身
  if (
    url.pathname.startsWith(LOGIN_PATH) ||
    url.pathname === "/api/login" ||
    url.pathname.match(/\.(css|js|svg|ico|png|jpg|woff2?)$/)
  ) {
    return context.next();
  }

  // 檢查認證 cookie
  const cookie = context.request.headers.get("Cookie") || "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));

  if (!token) {
    return Response.redirect(new URL(LOGIN_PATH, context.request.url), 302);
  }

  const expectedToken = context.env.SITE_PASSWORD || "inari2026";
  const tokenValue = token.split("=")[1];

  if (tokenValue !== btoa(expectedToken)) {
    return Response.redirect(new URL(LOGIN_PATH, context.request.url), 302);
  }

  return context.next();
}
