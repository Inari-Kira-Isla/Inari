# INARI Phase 1 — Harness Engineering 任務手冊

**版本:** 1.0  
**建立:** 2026-05-20  
**對應規格:** SYSTEM_SPEC.md v1.0  
**追蹤 Agent:** `~/.openclaw/workspace/agents/inari-dev/AGENT.md`

每個任務格式：
```
Goal        — 做什麼，為什麼
Context     — 相關檔案/資料來源
Execution   — 執行路徑
Verify      — 驗收條件（必須全過才算完成）
Output      — 輸出位置
Checkpoint  — 回滾方式
```

---

## WEEK 1 — 安全修補（P0）

---

### T01: JWT HS256 工具庫

**Goal:** 建立有簽名的 JWT 機制，替換現有無簽名 base64 cookie，防止身份偽造。

**Context:**
- 現有問題：`src/middleware.ts` 解析 base64 JSON，無 HMAC 驗證，任何人可偽造
- 參考規格：`SYSTEM_SPEC.md` § 7.1

**Execution:**
1. 新建 `src/lib/jwt.ts`
2. 實作 `signJWT(payload, secret): Promise<string>`
3. 實作 `verifyJWT(token, secret): Promise<Record<string,unknown> | null>`
4. 使用 `crypto.subtle.sign` HMAC-SHA256，零 npm 依賴
5. 在 Vercel dashboard 新增 env var `JWT_SECRET`（≥32 bytes 隨機字串）

**Verify:**
- [ ] `verifyJWT(signJWT(payload, s), s)` === payload
- [ ] `verifyJWT(tampered_token, s)` === null
- [ ] `verifyJWT(expired_token, s)` === null（exp 驗證）
- [ ] TypeScript 無型別錯誤

**Output:** `src/lib/jwt.ts`

**Checkpoint:** 此任務不修改任何現有檔案，完全新增，無需回滾

---

### T02: Middleware 重寫

**Goal:** 用 verifyJWT 替換現有 base64 解析，加入 ROUTE_GUARDS 路由隔離。

**Context:**
- 現有檔案：`src/middleware.ts`（約 60 行）
- 依賴：T01 完成
- 參考規格：`SYSTEM_SPEC.md` § 7.3

**Execution:**
1. 備份現有 middleware（git commit 作為 checkpoint）
2. 替換 base64 解析為 `verifyJWT(cookieValue, JWT_SECRET)`
3. 加入 `ROUTE_GUARDS` 物件
4. 過渡期：v1 cookie（`inari_auth`）繼續支援，但標記為 legacy
5. 未登入訪問 protected 路由 → redirect `/shop/login?next=<path>`

**Verify:**
- [ ] `curl /admin` 無 cookie → 302 to /shop/login
- [ ] staff JWT 訪問 /admin → 403 或 302
- [ ] wholesale JWT 訪問 /shop/admin → 403 或 302
- [ ] manager JWT 訪問所有路由 → 200
- [ ] 舊 v1 cookie 仍能登入（過渡期）

**Output:** `src/middleware.ts`（重寫）

**Checkpoint:** git revert 到重寫前的 commit

---

### T03: 新建 /api/auth/login

**Goal:** 產生 HttpOnly JWT v3 cookie，修復 shop-login.ts 缺 HttpOnly 的問題。

**Context:**
- 現有問題：`src/pages/api/shop-login.ts` Set-Cookie 缺 HttpOnly
- 依賴：T01 完成
- 參考規格：`SYSTEM_SPEC.md` § 7.2

**Execution:**
1. 新建 `src/pages/api/auth/login.ts`
2. POST handler：驗證帳密 → signJWT → Set-Cookie HttpOnly Secure SameSite=Strict
3. 新建 `src/pages/api/auth/logout.ts`：清除 cookie
4. 新建 `src/pages/api/auth/me.ts`：verifyJWT → 回傳用戶資訊
5. 更新 `src/pages/shop/login.astro` 改呼叫新端點

**Verify:**
- [ ] 登入後 cookie 有 HttpOnly 旗標（DevTools 確認）
- [ ] `/api/auth/me` 回傳正確 user_type
- [ ] 錯誤密碼回傳 401
- [ ] logout 後 cookie 清除，/api/auth/me 回傳 401

**Output:** `src/pages/api/auth/login.ts`, `logout.ts`, `me.ts`

**Checkpoint:** `/api/shop-login` 保留，可立即 rollback

---

### T08: qb_sales RLS Policy

**Goal:** 資料庫層鎖定 qb_sales 只允許 SELECT，防止 614K 筆歷史被意外修改。

**Context:**
- Supabase project: `cqartwwsbxnjjatmndtt.supabase.co` (inari-production)
- 執行方式：`supabase db query --linked --workdir /tmp/supabase-inari`
- PAT: `vault supabase/pat`

**Execution:**
```sql
ALTER TABLE qb_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_only" ON qb_sales
  FOR SELECT USING (true);
-- 不建立 INSERT/UPDATE/DELETE policy
```

**Verify:**
- [ ] `SELECT COUNT(*) FROM qb_sales` via anon key → 成功
- [ ] `INSERT INTO qb_sales (...)` via anon key → 42501 / 403
- [ ] `INSERT INTO qb_sales (...)` via service_role → 成功（後端 API 需要）

**Output:** Supabase migration（SQL 存 `supabase/migrations/20260520_qbsales_rls.sql`）

**Checkpoint:** `ALTER TABLE qb_sales DISABLE ROW LEVEL SECURITY`（如需緊急回滾）

---

### BUG-FIX: wholesale 確認訂單

**Goal:** 修復 wholesale 用戶無法確認訂單的 bug（1行修改）。

**Context:**
- 檔案：`src/pages/api/orders/[id]/confirm.ts` 約 L64
- 問題：`userType === 'b2b'`，系統實際值為 `'wholesale'`

**Execution:**
1. 找到 `userType === 'b2b'` 判斷
2. 改為 `userType === 'wholesale'`
3. 確認同檔案無其他 'b2b' 殘留

**Verify:**
- [ ] 用 test wholesale 帳號下單 → 確認訂單 → 狀態變為 confirmed
- [ ] 確認訂單 API 回傳 `{ ok: true }`

**Output:** `src/pages/api/orders/[id]/confirm.ts`（1行修改）

**Checkpoint:** git revert（1行，風險極低）

---

## WEEK 2 — 品牌/知識（P1，可並行）

---

### T04: 品牌主頁 /brand

**Goal:** 建立繁中版品牌主頁，連結知識庫，提升 wholesale 客戶品牌認知。

**Context:**
- 現有英文版：`src/pages/index.astro`（保留不動）
- 設計系統：`public/shop/styles.css`（oklch 色票）
- 旬物資料：T06 完成後可接 `/api/seasonal`

**Execution:**
1. 新建 `src/pages/brand.astro`
2. 區塊：Hero（品牌標語）→ 三大品類（海膽/三文魚/帆立貝）→ 本月旬物 → 連結 /knowledge
3. 旬物橫幅：fetch /api/seasonal，若 T06 未完成則靜態 placeholder

**Verify:**
- [ ] GET /brand → 200
- [ ] 旬物橫幅有內容（或 placeholder）
- [ ] 行動裝置 viewport 正常
- [ ] 連結 /knowledge/ 正確

**Output:** `src/pages/brand.astro`

**Checkpoint:** 刪除檔案即可回滾（新增頁面）

---

### T05: 知識庫頁面 /knowledge/*

**Goal:** 建立商品知識庫公開頁，提升 SEO 與品牌信任。

**Context:**
- 資料來源：Supabase `product_knowledge`（44筆）、`region_knowledge`（8筆）
- 現有知識頁：`/market/*`, `/salmon/*`, `/sea-urchin/*`（保留）

**Execution:**
1. `src/pages/knowledge/index.astro` — 品類索引卡片
2. `src/pages/knowledge/seafood.astro` — 海鮮總覽
3. `src/pages/knowledge/seasonal.astro` — 旬物月曆
4. `src/pages/knowledge/regions.astro` — 產地地區

**Verify:**
- [ ] 4個路由全部 200
- [ ] product_knowledge 資料正確顯示
- [ ] region_knowledge 8個地區正確顯示
- [ ] 無登入即可訪問

**Output:** `src/pages/knowledge/`（4個新檔案）

**Checkpoint:** 全部新增，刪除即可回滾

---

### T06: Seasonal API + inari_seasonal_calendar

**Goal:** 提供旬物月份資料 API，供品牌主頁與知識庫頁面使用。

**Context:**
- 現有旬物資料：`region_knowledge` JSONB 含 `seasonal_calendar`
- 新建表：`inari_seasonal_calendar`（見 SYSTEM_SPEC.md § 4.2）

**Execution:**
1. Supabase migration 建立 `inari_seasonal_calendar` 表
2. 填入初始資料（5月旬物：帆立貝、馬糞海膽、甜蝦等）
3. 新建 `src/pages/api/seasonal.ts`
4. Cache-Control: max-age=3600

**Verify:**
- [ ] `GET /api/seasonal` → 200，JSON 含 peak_items
- [ ] `GET /api/seasonal?month=5` → 包含帆立貝、海膽
- [ ] 無 auth 可訪問
- [ ] 回應時間 < 500ms（或有快取）

**Output:** Supabase table + `src/pages/api/seasonal.ts`

**Checkpoint:** DROP TABLE inari_seasonal_calendar；刪除 API 檔案

---

## WEEK 3 — 管理/批發（P1-P2）

---

### T07: Admin 後台統一 /admin/*

**Goal:** 提供 manager 統一管理後台，整合現有分散的管理功能。

**Context:**
- 現有：`src/pages/admin.astro`（只有知識庫）→ 保留為 `/admin/knowledge`
- 保護：T02 middleware manager-only

**Execution:**
1. `admin/index.astro` → redirect to admin/dashboard
2. `admin/dashboard.astro` — 銷售摘要（qb_sales）
3. `admin/products.astro` — 商品管理
4. `admin/orders.astro` — 全訂單管理
5. `admin/knowledge.astro` — 移植現有 admin.astro 內容

**Verify:**
- [ ] staff JWT 訪問 /admin → 302/403
- [ ] manager JWT 訪問 /admin/dashboard → 200
- [ ] /admin/products 可切換商品上架狀態
- [ ] /admin/knowledge 功能與原 /admin 等效

**Output:** `src/pages/admin/`（4個新檔案）

**Checkpoint:** 保留原 `admin.astro`（改名備份）

---

### T09+T11: 批發入口 /wholesale/ + 路由分流

**Goal:** wholesale 用戶有專屬入口，登入後自動跳轉，不再混入 /shop/。

**Context:**
- 依賴：T02 middleware 完成
- 現有：wholesale 用戶登入後也進 /shop/（不適合）

**Execution:**
1. `src/pages/wholesale/index.astro` — 批發客戶入口頁
2. middleware 加入登入後分流邏輯
3. `shop/login.astro` 登入成功 → 按 user_type redirect

**Verify:**
- [ ] wholesale 帳號登入 → /wholesale/
- [ ] staff 帳號登入 → /shop/
- [ ] manager 帳號登入 → /shop/（預設）或 /admin/
- [ ] /wholesale/ 頁面顯示客戶名稱

**Output:** `src/pages/wholesale/index.astro`，middleware 更新

**Checkpoint:** git revert middleware 變更

---

## WEEK 4 — 收尾（P2-P3）

---

### T10: 帳戶頁 /account

**Goal:** wholesale 客戶可查閱自己的訂單歷史與帳戶資訊。

**Context:**
- 依賴：T02 middleware 完成
- 資料：`inari_customer_orders`（按 customer_code 過濾）
- RLS：wholesale 只能看自己的訂單

**Execution:**
1. 新建 `src/pages/account.astro`
2. 顯示帳戶資訊（從 JWT payload 取 username, customer_code）
3. 從 `/api/orders` 取最近 10 筆訂單
4. 訂單狀態顏色標示

**Verify:**
- [ ] wholesale 帳號看到自己的訂單
- [ ] 不能看到其他客戶訂單（RLS 保護）
- [ ] 無訂單時顯示空白狀態

**Output:** `src/pages/account.astro`

**Checkpoint:** 刪除檔案即可回滾

---

### T12+T13: ops-monitor 升級 + 共用組件

**Goal:** 系統健康監控涵蓋新路由，組件可被未來 /retail 複用。

**Context:**
- 現有：`ai.inari.ops-monitor` LaunchAgent（08:30 每日）
- Telegram chat_id: 8399476482

**Execution:**
1. ops-monitor 腳本加入新路由健康檢查
2. 加入 JWT 測試帳號 ping（/api/auth/me）
3. 提取 `src/components/ProductCard.astro`
4. 提取 `src/components/CatalogList.astro`

**Verify:**
- [ ] ops-monitor 報告包含 /brand, /wholesale/, /api/seasonal 狀態
- [ ] ProductCard 組件在 catalog.astro 中正常運作
- [ ] Telegram 每天 08:30 收到更新報告

**Output:** ops-monitor 腳本更新，2個新 Astro 組件

**Checkpoint:** ops-monitor 可回滾，組件新增無破壞性

---

## 快速查閱

| 任務 | 檔案 | 估計時間 | 風險 |
|------|------|---------|------|
| T01 | src/lib/jwt.ts（新增）| 2-3h | 低（新檔案）|
| T02 | src/middleware.ts（重寫）| 3-4h | 高（核心）|
| T03 | src/pages/api/auth/*.ts（新增）| 2h | 低 |
| T08 | Supabase SQL migration | 30m | 中（DB 變更）|
| BUG | confirm.ts L64（1行）| 15m | 低 |
| T04 | src/pages/brand.astro（新增）| 3-4h | 低 |
| T05 | src/pages/knowledge/*.astro（新增）| 4h | 低 |
| T06 | DB + API seasonal.ts | 3h | 中（DB 變更）|
| T07 | src/pages/admin/*.astro（新增）| 5-6h | 中 |
| T09+T11 | wholesale/index.astro + middleware | 3h | 中 |
| T10 | src/pages/account.astro（新增）| 3h | 低 |
| T12+T13 | 腳本 + 組件 | 3h | 低 |
