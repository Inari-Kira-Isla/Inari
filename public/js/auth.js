// Client-side auth hook — reads inari_auth_v2 cookie
// Returns {user, isStaff, isB2B, isB2C, loading}

function getCookie(name) {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function parseSession() {
  const token = getCookie("inari_auth_v2");
  if (!token) return null;
  try {
    const session = JSON.parse(atob(token));
    if (session.v !== 2) return null;
    if (session.exp && session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function getAuth() {
  const session = parseSession();
  if (session) {
    return {
      user: session,
      isStaff: session.user_type === "staff",
      isB2B: session.user_type === "b2b",
      isB2C: session.user_type === "b2c",
      isLoggedIn: true,
    };
  }
  // Fallback: check legacy cookie for staff
  const legacyCookie = getCookie("inari_auth");
  if (legacyCookie) {
    return {
      user: { username: "staff", user_type: "staff", role: "staff" },
      isStaff: true,
      isB2B: false,
      isB2C: false,
      isLoggedIn: true,
    };
  }
  return { user: null, isStaff: false, isB2B: false, isB2C: false, isLoggedIn: false };
}

export function logout() {
  document.cookie = "inari_auth_v2=; Path=/; Max-Age=0";
  document.cookie = "inari_auth=; Path=/; Max-Age=0";
  window.location.href = "/login";
}
