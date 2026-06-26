# 規格書：稻荷後台「收款 / 應收 / 客戶商業圖像」儀表板

> 版本 v1.0 · 2026-06-23 · 作者 Opus · 狀態：**待 Joe 批准後實作**
> 目標：喺現有 admin app（inari-henna / Astro+Tabler+Vercel）加收款應收追蹤，**手機隨時睇公司帳款 + 客戶圖像**，全部連 live Supabase。

---

## 1. 背景與目標
Joe 要喺手機隨時跟公司帳款。現有 `/admin/customers` 已有客戶列表（Astro + Tabler UI + Supabase view），但冇應收/收款時間/商業圖像。本案在同一 app 內擴充。

## 2. 範圍（對應 Joe 4 點要求）
- **F1 客戶管理增強**：各客戶**逐月應收帳款** + 按**收款類型**（月結/過數/現金）同**收款日**（15號/25號/次結/延後2月/岫收）分類；點客戶入詳情睇**商業圖像**（採購行為原型 + 規模檔次 + RFM + 主推商品）。
- **F2 儀表板**：直覺列**近 3 個月銷售**；**現結/轉帳 vs 月結** 對比。
- **F3 即時收款**：即時顯示**本月 15 號 / 25 號可收金額**（及各時段）。
- **F4 全部 live**：所有數據連稻荷 Supabase，永遠最新。
- **不做（YAGNI）**：唔做收款核銷流程（已有 reconcile）；唔做手機 App（用 responsive web）；唔重寫現有 customers 列表底層。

## 3. 現狀（技術基礎）
- App：`~/Projects/INARI`（Astro `prerender=false` SSR on Vercel；Tabler 後台主題，已 responsive）。Vercel 專案 `inari`（inari-henna.vercel.app）。
- 資料存取：API route fetch Supabase REST，讀**預聚合 view**（如 `v_customer_with_web_stats`、`v_ar_aging`）；env `SUPABASE_SERVICE_KEY`；`locals.userType==='manager'` 權限閘。
- Supabase（cqartwwsbxnjjatmndtt，tenant `b15d5a02-...`）。

## 4. 資料來源
**已喺 Supabase（直接用）**
- `inari_daily_invoices`：逐張發票（invoice_date, customer_code, amount, **status 已收/未收/pending 為準**, payment_type）→ 逐月應收、已收/未收。
- `inari_customers`：`due_date`(收款日,已校正)、`payment_type`(收款方式)。
- `v_ar_aging`：每客 outstanding + 帳齡(current/1-30/31-60/60+/max_days_overdue)。
- `qb_sales`：歷史銷售（txn_date, amount, customer, is_void/is_return）→ 近3月銷售趨勢。
- `customer_profile`：RFM/segment/top_skus（注意：此為舊業態，僅輔助）。

**要同步上 Supabase（目前只喺本地 inari_brain PG）**
- `customer_prototype`(客→採購行為原型+規模檔次)、`prototype_def`、`segment_product_rec`/`backbone_rec`（商品推介）。
- **F1「商業圖像」依賴呢批** → 列為 S1 前置：建 Supabase 對應表 + 一支 push 腳本（本地→雲，可納入每月排程更新）。
- 「延後2月」組：`defer_group.json` → 同步成 Supabase 標記（或 inari_customers 加欄 `collection_lag`）。

## 5. 功能設計
### F1 客戶管理增強
- **列表頁** `/admin/customers`：新增欄 **收款方式**、**收款日**、**未收餘額**（v_ar_aging.total_outstanding）、**最高逾期日**；新增篩選「收款日」「採購原型」。
- **逐月應收**：客戶詳情頁 `/admin/customers/[id]` 加「應收歷史」表（近6-12月：每月開單/已收/未收），由 inari_daily_invoices 按月聚合。
- **商業圖像**（詳情頁新區塊）：採購行為原型（①白身精緻/②三文魚走量/③海膽主導/④蟹籽鰻加工/⑤冷凍貝蝦走量）+ 規模檔次（大/中/小客）+ RFM + **主推商品 top5**（segment_product_rec/backbone_rec）+ 買法簽名。

### F2 儀表板 `/admin/收款`（新頁，手機優先）
- **近3月銷售**：每月總額柱狀 + 環比；按 `payment_type` 拆 **現金/過數（轉帳）/月結** 三線對比（金額 + 佔比）。
- 資料：qb_sales（或 inari_daily_invoices）group by month × payment_type。

### F3 即時收款（儀表板頂部 + 獨立卡）
- **本月各時段可收**：15號 / 25號 / 次結 / 延後2月(本月) / 岫收 —— 客數 + 金額（未收部分）。
- 即時計：月結客上月單本月收；延後2月組兩月前單本月收（同 `monthly_collection_report.py` 邏輯，改寫成 SQL view 或 API 聚合）。
- 點時段 → 展開該時段客戶清單 + 金額。

### F4 Live 連接
- 全部經 API route 即時 query Supabase（同現有 pattern）；無快取或短快取（≤60s）。商業圖像數據靠 S1 同步表（每月/每日更新）。

## 6. 頁面 / API / DB 架構
**新頁**
- `/admin/收款.astro`（儀表板：F3 即時收款 + F2 近3月銷售）。加入 AdminLayout 側欄。
- 增強 `/admin/customers.astro`（加欄+篩選）、`/admin/customers/[id].astro`（應收歷史 + 商業圖像）。

**新 API route**
- `GET /api/admin/collections`：本月各時段可收（F3）+ 近3月銷售×收款方式（F2）。
- `GET /api/admin/customers/[id]/ar`：該客逐月應收 + 商業圖像。
- 沿用現有：fetch Supabase REST + manager 權限閘 + timeout。

**Supabase 物件（新增）**
- View `v_collection_schedule`：客 × 收款時段 × 本月應收（封裝 F3 邏輯，避免 API 大量 JS）。
- View `v_monthly_ar`：客 × 月 × 開單/已收/未收。
- Table `customer_prototype`（同步自本地）+ `v_customer_business_profile`（join prototype+rec）。

## 7. Mobile / UX
- 沿用 Tabler responsive（card + table-responsive 已 mobile-friendly）。
- 儀表板手機：統計卡 2 欄、時段用可摺疊 list、銷售用簡單 bar（避免重 chart library；用 CSS bar 或輕量）。
- 大字、可點時段展開、頂部即時數字。

## 8. 部署
- 本地 `npm run dev` 起好驗證 → Joe 手機預覽（本地網或 preview deploy）→ 確認後 `git push` 觸發 Vercel production（**部署前問 Joe**）。
- env already set（SUPABASE_SERVICE_KEY on Vercel）；新表/view 用 service key 可讀。

## 9. 驗收標準
1. `/admin/收款` 手機開到，頂部即時顯示本月 15/25 號可收金額（對得上 5月報告口徑）。
2. 近3月銷售現結/轉帳/月結三類對比正確。
3. customers 列表有收款方式/日/未收欄 + 可篩選。
4. 點客戶睇到商業圖像（原型+檔次+RFM+主推商品）。
5. 全部 live（改 Supabase 數據 → 重整即更新）。
6. manager 權限閘有效；非 manager 唔睇到。

## 10. 實施步驟（逐步可驗收）
- **S1 數據前置**：同步 customer_prototype 等上 Supabase + 建 `v_collection_schedule`/`v_monthly_ar`/`v_customer_business_profile`。
- **S2 API**：`/api/admin/collections`、`/api/admin/customers/[id]/ar`。
- **S3 儀表板頁** `/admin/收款`（F3+F2）+ 側欄連結。
- **S4 customers 增強**（列表欄/篩選 + 詳情頁應收歷史 + 商業圖像）。
- **S5 本地驗收** → Joe 手機睇 → 確認 → deploy。

## 11. 風險 / 待決
- **商業圖像數據同步**：本地→Supabase，需定排程更新（每月 build_prototypes 後 push）。
- **代碼污染**：部分 inari_customers 代碼黐名，join 可能對唔齊 → 用 customer_code 精確 + 容錯。
- **效能**：逐月聚合用 view 預算，避免 API 拉大量逐張發票。
- **權限/私隱**：帳款敏感，必須 manager 閘 + 唔好公開。
- **收款日後續變動**：due_date 改咗，view 即時反映（無快取問題）。

## 5b. 必修硬性要求（gstack plan-ceo-review · SELECTIVE EXPANSION · 2026-06-23）
呢 7 條係硬性，唔係 optional：
- **M1 代碼正規化**：`inari_customers` 部分代碼黐咗客名（「MG0028- 琉球」），`inari_daily_invoices` 用乾淨碼 → JOIN 失配令該客 AR 錯/消失。前置：驗證兩邊碼形式 + 清污染碼 或 建正規化映射，所有 view 用正規化碼 join。**無聲失配＝critical defect。**
- **M2 status 正規化**：`COLLECTED = {已收, paid}`、`OUTSTANDING = {未收, pending}` 寫死喺 view。**唔好用 outstanding_amount（冇填）。**
- **M3 數據 Supabase-native**：`customer_prototype`/`prototype_def`/`segment_product_rec` 同步上 Supabase；「延後2月」由 `defer_group.json` → `inari_customers.collection_lag`(int 月數) 欄。配 push 排程（每月 build_prototypes 後）。**sync 失敗要可見**（M6）。
- **M4 時區**：所有「本月/逐月」用 `Asia/Macau`(UTC+8) 計，Vercel UTC 會月界 off-by-one。
- **M5 預聚合防 timeout**：近3月銷售掃 qb_sales 61.9萬行 → 建月×收款方式 rollup view（或 mv），API 5s timeout 內。
- **M6 零靜默失敗**：頁面顯示**數據新鮮度**（「資料截至 X」）+ sync/query 錯誤紅字；API 錯誤唔好 catch 晒當冇事。
- **M7 空狀態/邊界**：冇上月開單客顯示 0（非 error）；未算原型新客顯示「待分析」；退貨/作廢（is_return/is_void）要扣；負額正確顯示。

## 5c. 擴張功能（Joe 2026-06-23 全納入 scope）
- **E1 到期/逾期提醒**：到 15/25 號或逾期 N 日（接 v_ar_aging.max_days_overdue）→ 儀表板紅旗 + 本月到期清單置頂。（通知：in-app 角標；Telegram 靜音中見 [[telegram_notifications_muted]]）。
- **E2 現金流預測**：未來 3 個月按收款時段 × 各客近期開單 → 預計每月/每週可收，cash flow 日曆。
- **E3 業務員收款績效**：按 salesperson（文/雲/德/岫）算準時收率、逾期額、平均收款延遲（avg_collection_delay_days）。
- **E4 客戶流失預警**：慢付（帳齡）+ 落單下滑（RFM recency/decline）+ 採購原型 → 紅旗清單；接 F1 商業圖像 + `inari_customer_health_scores`。

## 8b. 實施步驟（更新後 · 含必修+擴張）
- **S1 數據前置**：M1 代碼正規化 + M3 同步 customer_prototype/collection_lag 上 Supabase + 建 view（`v_collection_schedule`/`v_monthly_ar`/`v_sales_by_paytype`/`v_customer_business_profile`，全部釘 M2/M4）。
- **S2 API**：collections / customer ar / 加 E2 forecast、E3 salesperson、E4 churn 端點（manager 閘 + timeout + M6 錯誤回傳）。
- **S3 儀表板** `/admin/收款`：F3 即時 + F2 近3月 + E1 到期紅旗置頂 + E2 現金流 + 數據新鮮度條。
- **S4 customers 增強**：列表欄/篩選 + 詳情頁逐月應收 + 商業圖像(F1) + E4 流失旗。
- **S5 E3 業務員績效** 區塊/頁。
- **S6 本地驗收（含 M7 空狀態 + browser QA）** → Joe 手機睇 → 部署。

## 9b. 驗收補充
- M1：抽 5 個污染碼客，dashboard AR 對得返 qb/Excel 口徑（唔丟客）。
- M6：拔網/壞 key 時頁面顯示錯誤而非白畫面或假 0。
- E1-E4 各有可驗收輸出 + Joe 手機確認。

---
## GSTACK REVIEW REPORT
- **Mode**：SELECTIVE EXPANSION（守 4 點底線 + cherry-pick 擴張）。
- **Prime Directives 套用**：零靜默失敗(M6)、每 error 有名(M2 status/M1 join)、shadow paths(M7 空/退貨/無單)、6個月後(M3 data 由 file→DB-native)、可觀測性(M6 新鮮度)。
- **必修地雷**：M1-M7（已入 §5b，硬性）。最致命＝M1 代碼污染 join 失配（無聲丟客 AR）。
- **擴張決議**：E1+E2+E3+E4 全納入（Joe 揀）。E5 一鍵核銷 / E6 匯出 暫不納（未揀，可後加）。
- **STATUS：DONE** — spec 已硬化 + 擴張，可進實作。

---
**請 Joe 最後拍板**：① 呢份硬化+擴張版 spec OK？② 批准入 **S1（代碼正規化 + 數據同步上 Supabase + 建 view）** 開工？（部署去 production 前我會再問你）
