import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signJWT, verifyJWT, signQRToken, makeTokenExpiry } from '../src/lib/jwt';

const SECRET = 'test-secret-only-for-vitest';
const src = (rel: string) => readFileSync(fileURLToPath(new URL('../src/' + rel, import.meta.url)), 'utf8');

// ── JWT 簽名完整性(v3 session 防偽造) ──────────────────────────
describe('verifyJWT — 簽名 session 唔可偽造', () => {
  it('合法 token round-trip', async () => {
    const t = await signJWT({ sub: 'u1', user_type: 'manager', customer_code: null, username: 'boss', exp: makeTokenExpiry('manager') }, SECRET);
    const p = await verifyJWT(t, SECRET);
    expect(p?.user_type).toBe('manager');
  });
  it('篡改 payload → 簽名唔過 → null', async () => {
    const t = await signJWT({ sub: 'u1', user_type: 'wholesale', customer_code: 'C1', username: 'x', exp: makeTokenExpiry('wholesale') }, SECRET);
    const [h, , s] = t.split('.');
    const forged = btoa(JSON.stringify({ iss: 'inari-global', user_type: 'manager', exp: 9999999999 })).replace(/=+$/, '');
    expect(await verifyJWT(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });
  it('錯 secret → null', async () => {
    const t = await signJWT({ sub: 'u1', user_type: 'staff', customer_code: null, username: 'x', exp: makeTokenExpiry('staff') }, SECRET);
    expect(await verifyJWT(t, 'wrong-secret')).toBeNull();
  });
  it('過期 → null', async () => {
    const t = await signJWT({ sub: 'u1', user_type: 'staff', customer_code: null, username: 'x', exp: 1 }, SECRET);
    expect(await verifyJWT(t, SECRET)).toBeNull();
  });
  it('偽造 v2 unsigned base64 唔係有效 JWT(三段簽名)', async () => {
    const v2forge = btoa(JSON.stringify({ v: 2, user_type: 'manager', exp: 9999999999 }));
    expect(await verifyJWT(v2forge, SECRET)).toBeNull(); // 唔夠三段/冇簽名
  });
});

// ── QR token 唔可直接當 session(撤銷機制唔可被繞過) ───────────
describe('QR token purpose 隔離', () => {
  it('QR token 係合法簽名但帶 purpose=qr', async () => {
    const qr = await signQRToken('C1', 'jti-1', 'qr_C1', makeTokenExpiry('retail'), SECRET);
    const p = await verifyJWT(qr, SECRET);
    expect(p).not.toBeNull();
    expect((p as any).purpose).toBe('qr');
  });
  it('middleware 接受規則 (payload && !purpose) 會拒 QR token 當 session', async () => {
    const qr = await verifyJWT(await signQRToken('C1', 'jti-1', 'qr_C1', makeTokenExpiry('retail'), SECRET), SECRET);
    const session = await verifyJWT(await signJWT({ sub: 'u', user_type: 'wholesale', customer_code: 'C1', username: 'x', exp: makeTokenExpiry('wholesale') }, SECRET), SECRET);
    const accepts = (p: any) => !!(p && !p.purpose);
    expect(accepts(qr)).toBe(false);      // QR token 被拒
    expect(accepts(session)).toBe(true);  // 真 session 接受
  });
});

// ── 源碼守衛:防偽造路徑被重新引入(regression lock) ─────────────
describe('源碼守衛 — 已刪嘅偽造洞唔可回歸', () => {
  const mw = src('middleware.ts');
  it('middleware 冇 v2 無簽名 parseV2Legacy', () => { expect(mw).not.toContain('parseV2Legacy'); });
  it('middleware 冇硬編碼密碼 inari2026', () => { expect(mw).not.toContain('inari2026'); });
  it('middleware 冇 legacy v1/v2 cookie 常數', () => {
    expect(mw).not.toContain("'inari_auth_v2'");
    expect(mw).not.toContain("COOKIE_V1");
  });
  it('middleware 有 purpose token 拒絕守衛', () => { expect(mw).toContain('purpose'); });

  it('orders POST 非 staff 鎖死 locals customer_code', () => {
    const o = src('pages/api/orders/index.ts');
    expect(o).toContain('isStaff');
    expect(o).not.toContain('body.customer_code || locals.customerCode');
  });
  it('confirm 用正向擁有權授權(!isStaff)', () => {
    const c = src('pages/api/orders/[id]/confirm.ts');
    expect(c).toContain('!isStaff');
    expect(c).not.toContain("userType === 'wholesale' && locals.customerCode");
  });
});
