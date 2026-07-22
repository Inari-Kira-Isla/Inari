# 稻荷商城 UAT 驗收清單

**由來：** 整理自 `HARNESS.md` T01–T13 各任務嘅 Verify 條件，全部功能code已落地(截至2026-07-16確認)，呢份清單淨係做人手驗收用，唔係開發任務。
**用法：** 逐項打勾，全過先算UAT完成。發現唔過嘅項目直接記低喺對應行，唔使開新文件。

---

## A. 登入/權限（T01-T03, T02 middleware）

- [ ] 用 wholesale 測試帳號登入 → cookie 有 HttpOnly 旗標（DevTools → Application → Cookies 確認）
- [ ] 登入後 `/api/auth/me` 回傳正確 user_type / customer_code
- [ ] 錯誤密碼登入 → 401
- [ ] 登出後 `/api/auth/me` → 401
- [ ] 未登入直接開 `/admin` → 跳轉 `/shop/login`
- [ ] staff 帳號開 `/admin` → 403 或跳轉（staff 唔可以入 manager-only 頁）
- [ ] wholesale 帳號開 `/shop/admin` → 403 或跳轉
- [ ] manager 帳號 → 全部路由可入

## B. 登入分流（T09+T11）

- [ ] wholesale 帳號登入 → 自動去 `/wholesale/`
- [ ] staff 帳號登入 → 自動去 `/shop/`
- [ ] manager 帳號登入 → 去 `/shop/` 或 `/admin/`
- [ ] `/wholesale/` 首頁顯示正確客戶名稱/客戶代號

## C. 下單流程（BUG-FIX confirm.ts）

- [ ] wholesale 帳號語音/文字下單 → 訂單建立成功
- [ ] wholesale 帳號確認訂單 → 狀態變 `confirmed`（呢個之前有bug，改咗要重測）

## D. 帳戶頁（T10，已喺 `/account/index.astro`）

- [ ] wholesale 帳號登入 → 開 `/account` → 見到自己訂單
- [ ] 唔會見到其他客戶嘅訂單（換第二個客戶帳號交叉測試）
- [ ] 冇訂單嘅新帳號 → 顯示「無訂單記錄」空白狀態，唔係報錯
- [ ] 本月訂單/本月金額/待確認 三個統計數字啱

## E. 品牌/知識頁（T04-T06，公開頁）

- [ ] `GET /brand` → 200，手機 viewport 正常
- [ ] 旬物橫幅有內容（或 placeholder，冇報錯）
- [ ] `/knowledge`、`/knowledge/seafood`、`/knowledge/seasonal`、`/knowledge/regions` 四條路由全部 200
- [ ] `GET /api/seasonal?month=5` 有帆立貝/海膽等資料
- [ ] 知識庫頁面無登入都可以開（公開SEO頁）

## F. Admin 後台（T07）

- [ ] manager 帳號 `/admin/dashboard` → 200，銷售摘要正常
- [ ] `/admin/products` 可以切換商品上架狀態
- [ ] `/admin/knowledge` 功能同舊 `/admin.astro` 一致

## G. 資料庫層（T08，要有 Supabase 存取先驗到）

- [ ] anon key `SELECT COUNT(*) FROM qb_sales` → 成功
- [ ] anon key 試 `INSERT INTO qb_sales` → 應該畀 403 擋（唔可以寫入）
- [ ] service_role `INSERT INTO qb_sales` → 成功（後端寫入正常）

## H. 監控（T12+T13）

- [ ] `ai.inari.ops-monitor` 每日08:30 Telegram報告有包含 `/brand`、`/wholesale/`、`/api/seasonal` 狀態
- [ ] `/admin/catalog` 商品卡（ProductCard組件）顯示正常

---

## 已知待處理（唔阻UAT，但要記低）

- [ ] `/admin` 同時有 `admin/index.astro` 同 `admin.astro` 兩個檔案撞路由（build有warning，未來Astro版本會變hard error）— 需要揀一個刪
- [ ] `/salmon/storage` 同樣有 `salmon/storage/index.astro` 同 `salmon/storage.astro` 撞路由，同上處理
- [x] Vercel部署現況未核實 → **2026-07-23已核實**：live URL = `https://inari-henna.vercel.app`（HTTP 200健康），`JWT_SECRET`喺Vercel Production/Preview已設定（`vercel env pull`因「Sensitive」標記顯示空值屬CLI限制非真相，實測`/api/auth/login`回401非500確認secret真實有效）

## 2026-07-23 銷售員版面SDD Task B 真實UAT紀錄（重要）

**用真實API做咗一次完整真人流程驗證，唔止靠code review**：

1. **用本機`scripts/gen_qr_tokens.mjs`生成嘅QR完全用唔到**——本機`.env`嘅`JWT_SECRET=localtest_s1s2_smoke`只係佔位符，同production實際secret唔一致，簽出嚟嘅QR一scan即fallback去手動登入頁（呢個fallback行為本身都算細bug，應該顯示「QR已失效」清晰提示，唔應該靜默降級去登入頁，令人以為個QR系統唔work）。**後續呢類真人測試一律用真實admin後台/API生成，唔好用呢個本機script。**
2. **🔴 P0發現：`/api/admin/qr.ts`生成嘅QR URL網域錯誤**——`new URL(request.url).origin`喺Vercel serverless function入面唔反映真實對外域名，實測直接回傳`https://localhost`。即係話由呢個功能上線（commit`be06f2e`）到而家，**任何人經admin後台撳「生成客戶QR」，出嚟嘅QR畀客戶手機掃都係死路**（連唔到localhost）。**呢個好可能就係`inari_qr_tokens`/`inari_customer_orders`「全部0行all-time」嘅真正根因**——唔係冇人試過，而係試極都連唔到，前線員工/客戶大概率靜默放棄，冇人回報。
3. **已修+已部署+已驗證**（commit `7374c75`）：改用`X-Forwarded-Host`/`Host`request header構造正確base URL，`request.url.origin`降做冇header時嘅fallback。修復後真實測試：登入(manager)→生成QR(customer_code=MM0024)→URL正確顯示`https://inari-henna.vercel.app/...`→模擬掃碼(直接GET個URL)→302正確跳去`/shop/order/new`+設定7日session cookie。**完整鏈路首次證實真係work**。
4. **新增測試帳號**（供未來UAT用，`inari_users`已有嘅`username='test', user_type='manager'`帳號）：密碼已設為`InariTest2026Qr`（2026-07-23設，先前密碼未知/唔記錄喺文件，UAT_CHECKLIST由頭到尾冇寫過實際測試密碼，呢個係首次補齊）。之後A-H項嘅manager角色測試可以直接用呢個帳號，唔使再猜/再問。
5. **🔴 P0發現#2（比#2更根本，真正終極根因）**：修好localhost bug後Joe真機掃碼仍然「一閃即逝」bounce返login頁。追查揪到`public/js/auth.js`嘅`getAuth()`一直讀`inari_auth_v2`（client可見base64 cookie），但`login.ts`/`qr.ts`早已升級用HttpOnly嘅`inari_auth_v3`（真JWT，security hardening），前端呢層從未同步更新——**任何登入方式（QR或者手動用戶名密碼）都會中招**，伺服器session明明成功建立，前端script一查`isLoggedIn`永遠false即刻彈返login。影響7個頁面（index/orders/search/checkout/admin-orders/order-new/catalog）。`logout()`同樣有問題（清緊清唔到嘅HttpOnly cookie+跳去已刪除嘅`/login`死頁）。
6. **已修+已部署**（commit `0afdd3d`）：`getAuth()`/`logout()`改做async，call真正`GET /api/auth/me`/`POST /api/auth/logout`；7個call site加`await`（全部`type="module"`，top-level await原生支援）；順手移除從未被用到嘅`isB2B`/`isB2C`死欄位。本機`npm run build`通過。
7. **✅ Joe真機掃碼最終確認成功**（2026-07-23）：用真實iPhone camera掃描修復版QR（客戶MM0024盛悅餐飲），成功進入「新增訂單」頁，常買清單正確帶出，語音/文字下單、底部導覽（首頁/目錄/下單/訂單/購物車）全部顯示正常。**QR登入流程首次證實端對端真係work，Task B正式完成。**

A. 登入/權限對應項已透過本次UAT間接驗證：wholesale QR登入(√)、`/api/auth/me`回傳正確user_type/customer_code(√)、manager帳號可正常登入(√)。其餘細項（staff角色/403邊界/logout完整round-trip等）未逐一勾選，建議下次有空再過一次A-H全表。

---

**通過全部A-H項 = 正式UAT完成，可以將呢個project由「待UAT」轉做「已上線/正式使用」。**
