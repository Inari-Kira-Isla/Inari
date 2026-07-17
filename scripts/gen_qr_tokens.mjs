#!/usr/bin/env node
// 生成每客戶 QR 免密碼登入 token (2026-07-17 P1)
// 用法: node scripts/gen_qr_tokens.mjs --base https://<shop-prod-url> MF0030 MN0010 ...
//   --base  : 商城正式域名(QR 會 encode 呢個);必填
//   --days N: token 有效日數(預設 180)
//   codes   : 一個或多個 customer_code
// 做嘅嘢: ①確保有 wholesale inari_users 帳 ②簽 purpose=qr JWT(同商城 lib/jwt 同格式)
//   ③寫 inari_qr_tokens 撤銷表 ④出 QR PNG 落 scripts/qr_out/
// 純用 .env 嘅 JWT_SECRET / SUPABASE_SERVICE_KEY(唔入代碼)。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TENANT = 'b15d5a02-764c-4353-ad40-07b901d9f321';
const ISSUER = 'inari-global';

// ── 讀 .env（唔靠 dotenv 依賴）──
function loadEnv() {
  const env = {};
  const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

// ── 簽 JWT（HS256,同 src/lib/jwt.ts signJWT 逐位對齊,加 purpose/jti）──
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function signJWT(claims, secret) {
  const now = Math.floor(Date.now() / 1000);
  const full = {
    iss: ISSUER, iat: now, exp: claims.exp, tenant_id: TENANT, v: 3,
    sub: claims.sub, user_type: 'wholesale', customer_code: claims.customer_code,
    username: claims.username, purpose: 'qr', jti: claims.jti,
  };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(full));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
// 自我驗證(mirror verifyJWT):簽完即刻驗,確保商城收得
function verifyOwn(token, secret) {
  const [h, b, s] = token.split('.');
  const good = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url') === s;
  if (!good) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (p.iss !== ISSUER || p.exp < Math.floor(Date.now() / 1000)) return null;
  return p;
}

// ── PostgREST helper ──
async function pg(env, method, pathq, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathq}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${pathq} → ${r.status} ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

// QR 客戶身份 = customer_code 為本嘅合成身份,唔入 inari_users(嗰張係 staff 表,role check 只收
// accounting/manager/sales)。middleware 淨係讀 JWT claims 唔查 DB,撤銷靠 inari_qr_tokens 已足夠。

// ── main ──
const args = process.argv.slice(2);
let base = '', days = 180; const codes = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--days') days = parseInt(args[++i]);
  else codes.push(args[i]);
}
if (!base || !codes.length) {
  console.error('用法: node scripts/gen_qr_tokens.mjs --base https://<url> [--days 180] CODE1 CODE2 ...');
  process.exit(1);
}
const env = loadEnv();
if (!env.JWT_SECRET || !env.SUPABASE_SERVICE_KEY) { console.error('.env 缺 JWT_SECRET / SUPABASE_SERVICE_KEY'); process.exit(1); }

const outDir = path.join(ROOT, 'scripts', 'qr_out');
fs.mkdirSync(outDir, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const exp = now + days * 24 * 3600;
const summary = [];

for (const code of codes) {
  try {
    const sub = `qr_${code}`, username = `qr_${code}`;   // 合成身份,唔入 inari_users
    const jti = crypto.randomUUID();
    const token = signJWT({ sub, username, customer_code: code, jti, exp }, env.JWT_SECRET);
    if (!verifyOwn(token, env.JWT_SECRET)) throw new Error('自我驗證失敗(簽名格式問題)');
    await pg(env, 'POST', 'inari_qr_tokens',
      { jti, customer_code: code, label: `qr ${code}`, expires_at: new Date(exp * 1000).toISOString() });
    const url = `${base.replace(/\/$/, '')}/api/auth/retail/qr?t=${token}`;
    const png = path.join(outDir, `${code}.png`);
    await QRCode.toFile(png, url, { width: 512, margin: 2 });
    summary.push({ code, sub, jti, png, url });
    console.log(`✅ ${code}  → ${png}  (jti ${jti.slice(0, 8)})`);
  } catch (e) {
    console.log(`❌ ${code}  ${e.message}`);
  }
}
fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n完成 ${summary.length}/${codes.length}。PNG + _summary.json 喺 ${outDir}`);
console.log('撤銷: UPDATE inari_qr_tokens SET revoked=true WHERE jti=...  即刻失效。');
