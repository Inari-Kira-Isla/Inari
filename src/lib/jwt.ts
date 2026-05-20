// JWT HS256 via Web Crypto API — zero npm dependencies
// Payload v3: { iss, sub, exp, iat, user_type, customer_code, tenant_id, username, v }

export interface JwtPayload {
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  user_type: 'staff' | 'manager' | 'wholesale' | 'retail';
  customer_code: string | null;
  tenant_id: string;
  username: string;
  v: number;
}

const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';
const ISSUER = 'inari-global';

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJWT(
  payload: Omit<JwtPayload, 'iss' | 'iat' | 'tenant_id' | 'v'> & { exp?: number },
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    iss: ISSUER,
    iat: now,
    exp: payload.exp ?? now + 7 * 24 * 3600, // 7 days default
    tenant_id: TENANT_ID,
    v: 3,
    sub: payload.sub,
    user_type: payload.user_type,
    customer_code: payload.customer_code ?? null,
    username: payload.username,
  };

  const enc = new TextEncoder();
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).buffer as ArrayBuffer);
  const body = base64urlEncode(enc.encode(JSON.stringify(fullPayload)).buffer as ArrayBuffer);
  const signingInput = `${header}.${body}`;

  const key = await importKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  const sig = base64urlEncode(sigBuf);

  return `${signingInput}.${sig}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const signingInput = `${header}.${body}`;

    const enc = new TextEncoder();
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sig),
      enc.encode(signingInput)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as JwtPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.iss !== ISSUER) return null;

    return payload;
  } catch {
    return null;
  }
}

export function makeTokenExpiry(userType: JwtPayload['user_type']): number {
  const now = Math.floor(Date.now() / 1000);
  if (userType === 'manager') return now + 8 * 3600;       // 8 hours
  if (userType === 'retail')  return now + 30 * 24 * 3600; // 30 days
  return now + 7 * 24 * 3600;                              // 7 days (staff/wholesale)
}
