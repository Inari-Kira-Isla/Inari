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
- [ ] Vercel部署現況未核實（CLI查詢逾時，需人手開瀏覽器確認live URL仲正常運作）

---

**通過全部A-H項 = 正式UAT完成，可以將呢個project由「待UAT」轉做「已上線/正式使用」。**
