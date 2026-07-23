# map.md — 稻荷商城（~/Projects/INARI）資料位置速查表

> 持續資產，唔係一次性報告。同 `~/inari-web/map.md` 同一套慣例：呢份講「邊個資料喺邊」。
> 建立：2026-07-23（Joe要求「檢查優化導航商城網站的結構」+「B2B/B2C雙軌下單」omni-audit期間）。
> 呢個repo = inari-web CLAUDE.md 第4.7節/陷阱提過嘅「收單網站」，Astro on Vercel，live URL `https://inari-henna.vercel.app`。
> **同`~/inari-web`共用同一個Supabase project**（`cqartwwsbxnjjatmndtt.supabase.co`），但係獨立repo/獨立部署（git push→Vercel auto-deploy，唔係gh-pages）。

## 一、部署 / 環境

- Live：`https://inari-henna.vercel.app`（Vercel，`vercel.json`+`.vercel/`）
- 框架：Astro SSR（`astro.config.mjs`），非static build——`src/pages/api/*.ts`係真server-side function
- 認證：自建HS256 JWT（`src/lib/jwt.ts`），**唔用Supabase Auth**（同inari-web唔同，果邊有真Supabase Auth+RLS；呢個app全部API route用`SUPABASE_SERVICE_KEY`（service_role,繞過RLS）直連
- Cookie：`inari_auth_v3`（HttpOnly+Secure+SameSite=Lax，簽名JWT，`src/middleware.ts`）——**唯一有效session**；`inari_auth_v2`（base64,冇簽名）已於`0afdd3d`宣告淘汰，但簽發嘅endpoint(`api/shop-login.ts`)仲喺度冇刪（見第五節#1）
- `.env`關鍵值：`JWT_SECRET`（Vercel Production/Preview已設定，07-23已核實）、`SUPABASE_SERVICE_KEY`、`SUPABASE_ANON_KEY`

## 二、路由總覽 + 目前auth guard狀態（`src/middleware.ts` `ROUTE_GUARDS`）

| 路由前綴 | 需要 user_type | 現況 |
|---|---|---|
| `/admin/users`、`/admin/analytics`、`/admin/sales`、`/admin/customers`、`/admin/suppliers` | `manager` | 內部後台 |
| `/admin`（其餘） | `staff`、`manager` | 內部後台 |
| `/wholesale` | `wholesale`、`manager` | B2B自助入口（另一套UI，同`/shop`平行） |
| `/account` | `wholesale`、`manager` | B2B「我的帳戶」訂單記錄 |
| `/shop/admin` | `staff`、`manager` | 商城管理 |
| **`/shop`（含`/shop/catalog`、`/shop/order/new`、`/shop/checkout`、`/shop/orders`等全部）** | **`staff`、`manager`、`wholesale`** | **⚠️全部要login，冇任何guest/B2C可入嘅路徑** |
| `/retail` | `retail` | **已預留guard但全站零頁面/零user落喺呢個user_type，屬未完成嘅半吊子設計** |
| 公開（`PUBLIC_PREFIXES`）| 免login | `/shop/login`、`/brand`、`/knowledge`、`/market`、`/salmon`、`/sea-urchin`、`/faq`、`/blog`等行銷/知識頁 |

**核心結論（Joe呢次任務嘅起點）**：`/shop/order/new`（Joe提供嘅URL）同成個`/shop/*`商城，現時**100%要login先入到**（`getAuth()`喺每個`/shop/*`頁面script入面都會`if(!auth.isLoggedIn) location.href='/shop/login'`，加middleware雙重擋）。**B2C零售客戶免密碼直接落單呢個流程，而家完全唔存在**——唔止UI冇做，middleware/API層都冚埋唔畀未登入請求過。

**07-23第二輪審計揪到嘅「production零訂單」已由Joe核實原因（唔係bug）**：商城功能仲未完善，**Joe刻意未開放訂單建立俾真實客戶用**，避免未完善功能寫入污染真實資料庫。即係話而家全站雖然code已deploy，但屬於「仲未正式開放」階段，唔係「已開放但冇人用」或者「開放咗但靜默壞咗」。呢點推翻本次審計原本嘅懸案假設，下次任何商城任務見到呢兩表持續0行，預設解讀係「仲未開放」，唔好誤判做故障。

## 三、B2B下單流程（現有，已部分work）

- **登入方式兩種**：(a) 用戶名密碼（`/shop/login`→`/api/auth/login`→查`inari_users.web_password`）(b) QR免密碼（銷售員喺admin後台生成→`/api/admin/qr.ts`→客戶掃碼→`/api/auth/retail/qr.ts`驗證jti+換發`user_type='wholesale'`嘅session，**注意呢個endpoint路徑叫`retail/qr`但實際發嘅係`wholesale` session，命名同語意唔一致**）
- **下單兩條UI路徑**：
  - `/shop/order/new`——語音/文字「亂單」辨識（`src/lib/order-engine.ts`確定性引擎，比對客戶歷史`hist`+全局`glob`候選），呢個係B2B熟客快速覆購專用，B2C冇歷史數據，呢條路徑對佢哋冇意義
  - `/shop/catalog`→加入購物車(localStorage,`public/js/cart.js`)→`/shop/checkout`——瀏覽商品逐件加，呢條先啱做B2C改造基礎
- **DB寫入**：`POST /api/orders`（`src/pages/api/orders/index.ts`）寫`inari_customer_orders`(頭)+`inari_customer_order_items`(明細)，狀態一律`draft`，**故意唔畀客戶自己confirm**（07-21 Joe拍板，要職員喺`/admin/orders`人手審先「確認」→扣庫存，見`supabase/migrations/20260526_order_fulfillment_trigger.sql`嘅`trg_order_fulfillment`）
- **customer_code鎖定**：`isStaff`先可以用body指定`customer_code`（幫客戶落單）；B2B客戶自己落單一律鎖死JWT帶嘅`locals.customerCode`，忽略client傳嘅值（防IDOR冒名）——**呢個機制假設訂單一定有已知customer_code；B2C guest冇customer_code呢個假設就唔成立，要另外設計**

## 四、DB Schema現況（07-23真實查證,`information_schema`+`pg_policies`）

### `inari_customer_orders`（訂單頭）
```
id bigint PK, order_no text, customer_code text NULL, customer_name text NULL,
order_date date, source text default 'wechat'(code一律傳'web'), status text default 'draft',
raw_text text, invoice_no text, notes text, tenant_id uuid,
created_at/updated_at, payment_method text, delivery_date date, confirmed_at timestamptz
```
**冇任何送貨地址/收貨人姓名/收貨人電話欄位。冇`total_amount`/`amount`欄位。**

### `inari_customer_order_items`（訂單明細）
```
id bigint PK, order_id bigint, order_no text, product_id/product_code/product_name,
raw_text, qty numeric, unit text, unit_price numeric, amount numeric,
match_confidence text default 'unmatched', tenant_id, created_at
```
（`amount`呢個欄喺明細表有，但`POST /api/orders`寫入時**冇set呢個值**——見第五節#2）

### RLS狀態（`pg_policies`+`pg_class.relrowsecurity`）
| 表 | RLS enabled | policy數 | 實際生效 |
|---|---|---|---|
| `inari_customer_orders` | true | 0 | deny-all except service_role（app一律用service key，冇受影響） |
| `inari_customer_order_items` | true | 0 | 同上 |
| `inari_users` | true | 0 | 同上 |
| `inari_customers` | true | 2（`inari_is_accounting_or_manager()`/`inari_sales_read_own_customers`）| 呢兩條policy屬**inari-web**（真Supabase Auth）遺留，同呢個Astro app無關（呢個app唔用Supabase Auth session） |
| **`inari_qr_tokens`** | **false（唯一冇開RLS嘅）** | — | 同手足表唔一致，見第五節#4 |

### `inari_schema_registry`已有正確記錄（07-23核實，唔使改）
`inari_customer_orders`/`inari_customer_order_items` status=`live`,safe_to_use=`yes`,authority_note已寫明「商城api/orders live寫入」——`~/inari-web/CLAUDE.md`陷阱#8舊文字「legacy試跑已停用,avoid」已經**過時**，果句寫喺registry未同步之前，registry本身已經係啱嘅，**下次執行`~/inari-web`任務見到陷阱#8呢句，以`v_schema_registry`即時查詢為準，唔好信舊文字**。

### `inari_products`（商品，同inari-web共用）
相關定價欄：`sales_price`/`standard_price`/`price_floor`——冇獨立「零售價/批發價」雙欄設計，B2B價格靠`inari_customers.price_tier`（欄位存在但呢個app未見任何實際join邏輯讀佢嚟改價，落單價全部來自`order-engine.ts`嘅歷史`last_price`或client送嚟嘅`suggested_price`）。

## 五、07-23 /omni-audit：本次發現（未修，等Joe拍板範圍後先落手）

1. **P2 死代碼+弱雜湊殘留**：`src/pages/api/shop-login.ts`——舊v2登入endpoint，`login.astro`已改call`/api/auth/login`（v3），冇任何頁面再call呢個舊endpoint，但middleware `PUBLIC_PREFIXES`仲留住`/api/shop-login`令佢公開可達；用無鹽SHA-256查`web_password`，成功都係設一個而家冇人讀嘅`inari_auth_v2`cookie。純殘留但公開可達，建議直接刪除呢個檔案+移除middleware對應白名單。
2. **P1 訂單總額由頭到尾冇算過，兩個頁面各自估錯唔同欄名**：`/shop/orders`(`orders.astro:136`)讀`o.amount`,`/account`(`account/index.astro:130,160`)讀`o.total_amount`——**兩個都唔存在**於`inari_customer_orders`（訂單頭表根本冇total欄，`amount`淨係明細表`inari_customer_order_items`先有，仲要`POST /api/orders`寫入時完全冇set呢個值，永遠NULL）。結果：客戶自己嘅訂單列表/帳戶頁月結金額統計**顯示永遠係MOP 0或「—」**，UAT_CHECKLIST D項「本月訂單/本月金額」呢類數字實際上冇得驗（因為輸入本身壞咗）。
3. **P1 訂單詳情死鏈**：`/shop/orders`列表每張訂單`onclick="location.href='/shop/orders/${o.id}'"`，但`src/pages/shop/orders/[id].astro`**唔存在**（只有`src/pages/admin/orders/[id].astro`後台版）。B2B客戶喺`/shop/orders`撳自己張訂單想睇明細 = 404。
4. **P2 `inari_qr_tokens`獨欠RLS**：手足表（`inari_customer_orders`/`_items`/`inari_users`）RLS皆enabled(即使0 policy=deny-all)，淨係`inari_qr_tokens`（QR免密碼登入嘅撤銷/使用記錄表）RLS完全冇開。現時app全走service_role key，anon key未見喺client bundle出現（已grep`public/js/*.js`確認），實際曝露有限，但屬defense-in-depth缺口同不一致，建議補開RLS(deny-all，同手足表睇齊)。
5. **設計缺口（非bug，Joe呢次要求嘅核心）**：`/retail`路由guard已預留(`user_type='retail'`)但零頁面/零欄位/零使用者用到呢個type——似係之前構思過「免密碼retail帳號」方向但未落地就轉咗軌，命名同`/api/auth/retail/qr.ts`（實際發wholesale session,同"retail"呢個字冇關係）一齊構成命名同語意脫節，建議廢除或者重新定義呢個guard，唔好留住一個似做咗實際冇做嘅路由。
6. **舊有已知**（UAT_CHECKLIST自己記錄，仍未修，一併carry forward）：`/admin`同時有`admin/index.astro`同`admin.astro`撞路由；`/salmon/storage`同`salmon/storage/index.astro`撞路由。

## 六、Loop 清單

| Loop | 觸發 | 做乜 | 輸出 |
|---|---|---|---|
| `ai.inari.ops-monitor`（見UAT_CHECKLIST H項） | 每日08:30 | Telegram報告`/brand`、`/wholesale/`、`/api/seasonal`健康狀態 | Telegram |

## 七、報告存底
- 07-23 B2B/B2C商城結構審計+schema設計：`~/.openclaw/reports/omni-audit-inari-shop-b2b-b2c-2026-07-23/`（待Phase5補完）

## 八、07-23 B2C guest 下單新建（Joe拍板：新獨立命名空間 `/order/*`，guest欄位直存訂單表，冇customer master）

**狀態：code已寫完+`npm run build`通過，DB migration已草擬未applied，全部未git push——等Joe睇完先決定幾時上線。**

- **路由**：`/order`（公開catalog+cart）、`/order/checkout`（guest表格：姓名/電話/地址/送貨日/付款方式現金or銀行轉帳(可上傳備款相片)/備注）、`/order/confirmed`（公開確認頁，兼「查詢我的訂單」用order_no+電話）
- **API**：`/api/order/catalog`（GET，公開商品目錄，同`/api/products/catalog`分開唔影響B2B）、`/api/order`（POST建guest訂單/GET用order_no+phone查）、`/api/order/receipt`（POST上傳銀行轉帳備款相片,存Storage bucket`commerce-images/order-receipts/`）
- **middleware.ts**：`/order`+`/api/order`加入`PUBLIC_PREFIXES`（本身冇任何`ROUTE_GUARDS`prefix會擋到呢兩條，加落去純為明確自文檔，防止日後有人加catch-all guard）
- **購物車**：獨立`public/js/guest-cart.js`（key=`inari_guest_cart`），刻意唔用B2B嗰個`cart.js`/`inari_cart`，避免同一部裝置B2B/B2C狀態互相污染
- **DB migration（草稿，未apply）**：`supabase/migrations/20260723_b2c_guest_orders_and_totals.sql`——
  1. `inari_customer_orders`加`total_amount`欄+trigger（`fn_recalc_order_total`掛`inari_customer_order_items`），一併修埋B2B「訂單金額永遠顯示0」嘅舊bug
  2. 加`order_type`（'b2b'/'b2c'，CHECK約束）、`guest_name`/`guest_phone`/`guest_delivery_address`/`payment_receipt_url`
  3. `inari_qr_tokens`補返RLS enable（手足表原本就有，佢獨欠）
- **B2C 訂單一樣要人工審**：同B2B同一條規矩，`status='draft'`，職員喺`/admin/orders`人手confirm先算，唔會guest提交就自動扣庫存
- **已知follow-up（未做，MVP範圍之外）**：guest下單endpoint冇rate limit/防灌單機制（現時靠人工審單擋住垃圾單變成真訂單，但admin queue本身可能被灌爆，長遠需要）；商城首頁(`src/pages/index.astro`,B2B trade行銷向Tailwind站)未加`/order`入口連結（品牌調性唔啱，建議另外用QR/社交媒體推廣，唔好夾硬拉落黎）

## 九、07-23 B2B 3個bug已修（已commit `427f24d`+已push origin/main，07-23稍後核實：本節標題舊字「未push」已過時）

1. `inari_customer_orders`加`total_amount`（見上面migration）+`/api/orders`GET改用PostgREST embed(`select=*,items:inari_customer_order_items(*)`)+`shop/orders.astro`改讀`o.total_amount`
2. `shop/orders.astro`嘅死link（連去唔存在嘅`/shop/orders/{id}`）改做原地展開accordion（同`/account`頁一致嘅UX pattern），用返上面嘅items embed顯示明細
3. 刪除`src/pages/api/shop-login.ts`（舊v2登入,無鹽SHA-256,冇人再call）+移除middleware `PUBLIC_PREFIXES`對應嘅`/api/shop-login`

## 十一、07-23 第二輪 /omni-audit：商城功能完整性 + 競品分析（report.md：`~/.openclaw/reports/omni-audit-inari-shop-features-competitive-2026-07-23/`）

**⚠️核心發現**：直接查production DB核實，`inari_customer_orders`/`inari_customer_order_items` 兩表**0行**，即使 `inari_schema_registry` 寫住「live/api/orders live寫入」。B2B自助下單套系統code完整已deploy，但從未有一張訂單真正成功落地過——下次任何商城任務見到「live」標記，記得呢個係「code已通」唔等於「已有人用」，兩者要分開驗證。

**本次新揪到並已修復（已commit `d69e19e`+已push origin/main，07-23稍後核實：本節標題舊字「未commit」已過時）**：
1. **訂單建立冇transaction保護**（`src/pages/api/orders/index.ts`+`src/pages/api/order/index.ts`）：items insert失敗只log,仍回201成功,產生孤兒訂單頭。已加DELETE補償清理+改回500。已用codex exec修+獨立deep-reasoner覆核(CONFIRMED,無阻塞問題)。
2. **搜尋頁`shop/search.astro`假「最近搜尋」demo資料**：5個關鍵字+4個寫死價格(MOP550/1280/285/92)全部demo,非真實。已改標題做「熱門搜尋」+移除假價格。

**功能缺口清單（對比9個成熟B2B食材電商標配，詳見report.md）**：客戶端庫存顯示、price_tier定價未接通、訂單狀態主動通知(零)、發票/對帳單下載、地址簿、促銷碼、線上付款閘道、送貨時段選擇、交易頁AI客服widget（得行銷頁有裝）——全部屬新功能開發範圍，本次未動，留待Joe排優先序。

**競品分析結論**：澳門本地暫時搵唔到深度追得上稻荷嘅直接競品；香港**FoodBuyer**（App+AI格價）明確講3年內擴展嚟澳門/大灣區，係最具體嘅未來威脅信號，記入觀察名單。

**Joe拍板+已執行（2026-07-23）**：兩組修復+`/retail`廢除已一併commit `d69e19e`+已push origin/main（觸發Vercel auto-deploy）。

## 十、⚠️發現同今次任務無關嘅pre-existing未commit狀態（07-23，唔係我改嘅，特此記錄）

`git status`顯示`src/pages/api/login.ts`/`src/pages/login.astro`/`src/pages/api/orders/[id]/confirm.ts`喺working tree顯示為「已刪除/已改」但從未commit——呢啲檔案喺磁碟上已經唔存在，但`git log`最後commit(`833ed37`前)仲有佢哋。時間點同`UAT_CHECKLIST.md`記錄嘅commit`0afdd3d`(「auth.js改讀真實session」)、`fdca65f`(「Task B UAT最終確認成功」)提到嘅清理工作吻合，估計係之前一個session做咗刪除但漏咗commit。**建議下次git commit時一併處理（同今日B2B/B2C改動一齊定分開commit，睇Joe意願），唔好誤刪或者忽略。**

## 十三、07-23 第三輪 /omni-audit：商城圖片讀取失敗 + 燃料庫(彈藥庫)商品混入

**Joe要求**：商城不能讀取資料庫商品圖片；應該只顯示「有在銷售」嘅武器庫商品，唔好顯示燃料庫（未賣候選）商品。

**根因①圖片**：`/api/products/catalog.ts`+`/api/order/catalog.ts`嘅`select=`從未帶`image_url`；`shop/catalog.astro`+`order/index.astro`嘅卡片渲染函數一直用emoji圖示（🐟🦔🐚），設計上就冇`<img>`——唔係「讀取失敗」，係從未讀過。`inari_products.image_url`實際798筆有570筆有圖（見[[inari_product_image_sku_quote_audit_2026-07-22]]）。

**根因②燃料庫混入**：catalog API淨係濾`is_active=eq.true`，冇濾「有冇真實銷售」。按`~/inari-web`兩層SKU架構（`v_arsenal`武器庫=有sd/qb銷售／`v_ammo`彈藥庫=供應商未賣候選，見`tools/qnl/SKU_BUILD_SOP.md`），親自查證：目前商城顯示嘅332件active商品中，只有203件屬武器庫，其餘129件係彈藥庫候選貨（從未賣過）混入。

**已修復（2026-07-23，Joe拍板兩個一齊修+push）**：
1. 新建DB view `v_shop_catalog`（`supabase/migrations/20260723b_shop_catalog_arsenal_view.sql`）= `inari_products` WHERE `is_active` AND (有sd銷售 OR 有qb_sales)，帶`image_url`；已apply production+已登記入`inari_schema_registry`（唔改`v_arsenal`本身，避免影響SKU_BUILD/成本會計用途，商城前台獨立開一個view）。REST核實：203筆，129筆有image_url。
2. `/api/products/catalog.ts`(B2B)+`/api/order/catalog.ts`(B2C guest)改查`v_shop_catalog`（原本查`inari_products?is_active=eq.true`），select加`image_url`。
3. `shop/catalog.astro`+`order/index.astro`嘅`renderProductCard()`：`.thumb`(CSS `display:grid`)入面glyph同`<img>`用`grid-area:1/1`疊埋同一格，有`image_url`就img蓋住glyph，`onerror`令img `display:none`令glyph透返出嚟做fallback——冇圖仍然睇到emoji佔位，唔會爛圖示。
4. `npm run build`通過；`curl /api/order/catalog`已核實真實回傳`image_url`(如KK0001)。因Playwright瀏覽器profile畀另一個進行中session佔用，未做視覺截圖驗證，改以API層+build層驗證。

**Why**：兩層SKU架構(`v_arsenal`/`v_ammo`)本身07-20已建好，但商城前台一直冇接線去用，淨係直查`inari_products`；圖片render用emoji屬於最初設計選擇，一直冇跟返`admin/products.astro`已有嘅`image_url`寫法。
**How to apply**：下次商城任何列商品嘅新頁面（例如`/wholesale`、`/retail`如重啟），一律查`v_shop_catalog`唔好直查`inari_products`；新增display fields要記得帶入呢個view嘅select list。`ProductCard.astro`/`CatalogList.astro`發現係死代碼（冇任何頁面import使用），今次冇動，如果將來要複用記得一併補image_url邏輯。

> ⚠️**2026-07-23第五輪更正**：第4點「已修復」結論本身DB/API層冇問題，但**從未真正喺瀏覽器跑過**——見下面十五節，`shop/catalog.astro`有一個獨立、無關嘅壞import bug令成個`<script>`一行都執行唔到，令呢個image修復完全冇機會生效。「API層+build層驗證」≠「功能已生效」，冇瀏覽器實測嘅結論下次要標明「未視覺驗證」風險等級，唔可以當「已修好」寫入memory。

## 十四、07-23 第四輪 /omni-audit：功能完整性測試現況 + 三系統拆分架構確認

**Joe要求**：驗證商城各功能完整性測試有冇問題、分析商城是否一個拆分子系統、列出邊啲系統可以獨立修改擴充。純分析，未拍板任何修復範圍，本輪未改任何code。

**A. 測試現況（`npm test` = vitest，07-23實測57 tests全過，2個檔案）**：
- `tests/security.test.ts`（JWT簽名round-trip、篡改payload/錯secret/過期token拒收、middleware唔可回歸偽造漏洞、orders POST customer_code鎖定）
- `tests/order-engine.test.ts`（語音/文字下單解析：中文數量轉換、size碼、相似度比對、gold set回歸）
- **覆蓋缺口**：全部57條測試集中喺「auth安全」+「order-engine文字解析」兩個模組，**checkout/cart/B2C guest下單/admin人手confirm/圖片顯示/QR端對端流程全部零自動化測試**——呢啲流程目前僅靠UAT_CHECKLIST.md人手勾選（而家A-H八組入面淨係H項小部分`[x]`，其餘全部`[ ]`未勾，即正式UAT從未跑完一輪；Task B QR流程07-23有做過一次真機人手驗證並記錄喺UAT_CHECKLIST，但呢個唔算入自動化test suite）。
- **已知未修build警告**（`npm run build`實測仍在，UAT_CHECKLIST「已知待處理」列出但長期未修）：`/admin`同時撞`admin.astro`+`admin/index.astro`；`/salmon/storage`同時撞`storage.astro`+`storage/index.astro`——Astro官方警告「未來版本會變hard error」，屬技術債，唔阻現時運作。
- 冇Playwright/E2E test，`playwright.config`唔存在於呢個repo（Playwright MCP有裝但07-23審計因瀏覽器profile被佔用未做視覺驗證，一直靠API curl+build替代）。

**B. 拆分子系統分析（結論：係，而且係三向拆分，唔止商城vs會計兩個）**：
獨立repo/獨立部署/獨立技術棧，三者**只共用同一個Supabase project**（`cqartwwsbxnjjatmndtt`）做整合點，冇任何code-level import/依賴：
| 系統 | repo | 部署 | 技術棧 | 角色 |
|---|---|---|---|---|
| `inari-web` | `~/inari-web` | GitHub Pages | 純SPA(單一`index.html`巨檔+`js/`模組) | 內部會計/入庫/銷售/收款/庫存 |
| **商城(INARI)** | `~/Projects/INARI` | Vercel(Astro SSR) | Astro+自建JWT(唔用Supabase Auth) | 對外B2B自助下單(`/shop`,`/wholesale`)+B2C訪客下單(`/order`) |
| `inari-agent` | `~/inari-agent` | Cloudflare Worker | 三段式agentic loop | AI助手(Telegram Router,唔屬前台商城) |
grep核實：`inari-web`code(非文檔)零引用`Projects/INARI`；`Projects/INARI`零引用`inari-agent`；三者互相唔知對方存在，純粹靠共享DB整合（"shared database" integration pattern，唔係microservice API呼叫）。商城內部再細分一層：`/shop`+`/wholesale`(B2B,要login) vs `/order`(B2C guest,免密碼)——兩條命名空間刻意隔離(獨立cart storage key/獨立API prefix)，Joe07-23已拍板呢個設計。

**C. 可獨立修改擴充嘅系統清單（改一個唔會影響其他兩個，前提係唔改共用DB schema）**：
1. **`inari-web`（會計/內部營運）**——獨立GH Pages部署，改佢完全唔影響商城/AI助手，只要唔碰commerce_products/inari_customer_orders等共用表結構。
2. **`Projects/INARI` B2B商城**（`/shop`,`/wholesale`,`/admin`）——獨立Vercel部署，可單獨加功能（發票下載/price_tier接通/主動通知，見[[inari_shop_feature_competitive_audit_2026-07-23]]功能缺口清單）。
3. **`Projects/INARI` B2C訪客下單**（`/order/*`）——同一repo但獨立命名空間，可獨立加rate limit/首頁推廣連結，唔影響B2B。
4. **`inari-agent`（AI助手）**——獨立Cloudflare Worker，改RBAC/搜尋功能唔影響商城或會計前端（見memory index「AI助手07-22擴充系列」）。
5. **共用DB schema/view層**（`inari_products`/`v_shop_catalog`/`v_arsenal`/`v_arsenal`等）——**呢層唔獨立**，三個系統都讀，改呢層任何一個表結構要三邊逐一check會唔會炸，屬唯一嘅硬耦合點。

**How to apply**：日後想單獨開發/擴充商城任何一邊，先睇上面B部三系統表確認邊個repo，唔使擔心波及其他兩個前端；但凡改動涉及`inari_customer_orders`/`inari_products`/`inari_customers`等共用表結構，一律當高風險，三repo都要search一次引用先落手。想補齊自動化測試覆蓋缺口(checkout/cart/B2C/QR端對端)，屬新開發範圍，留待Joe拍板優先序。

## 十五、07-23 第五輪 /omni-audit：商城圖片依然唔顯示嘅真正根因（同07-23第三輪image修復完全無關）

**Joe觀察**：手機截圖顯示`/shop/catalog`（B2B「商品目錄」頁）成頁卡喺灰色skeleton loading，永久唔resolve；同時問「加一個快取資料表」係咪可以順便加速。

**真正根因（3個subagent交叉驗證+主session親自confirm）**：`src/pages/shop/catalog.astro:132`有一句
`import { addToCart, getCart, getCartTotal, updateCartItem, removeCartItem } from '/js/cart.js';`
`cart.js`實際export係`updateQty`/`removeFromCart`，冇`updateCartItem`/`removeCartItem`；而且成句import嘅5個名呢個檔案從來冇用過（純死code，cart邏輯全部靠inline嘅`getLocalCart()`/`saveLocalCart()`/`window.cartInc`等）。ES module遇到唔存在嘅named export會喺**link階段**直接throw，令成個`<script type="module">`一行都冇執行過——包括頂部嘅`getAuth()`登入檢查、底部嘅`loadProducts()`——所以server端寫死嘅4張skeleton卡片永久冇被覆蓋，連錯誤訊息都唔會顯示（因為錯誤處理邏輯都喺同一個死咗嘅script入面）。呢個bug由更早嘅redesign commit `e7f3f05`引入，**同07-23第三輪嘅`v_shop_catalog`/image_url修復完全冇關係**——嗰個修復本身冇問題，但由頭到尾冇機會喺瀏覽器跑到。

**排除嘅假設**（一併記錄，避免下次重新排查）：
- DB view `v_shop_catalog`存在、有204行(130張有圖)、curl即刻回應——唔係「查太慢」。
- API層極resilient：`v_shop_catalog`就算炸咗，`prodResp.ok ? await prodResp.json() : []`都會回200 `{items:[]}`，前端會顯示「無符合的商品」文字，唔會卡skeleton。
- CORS header兩個catalog API都齊全（`Access-Control-Allow-Origin:*`+`OPTIONS` handler），前端用same-origin相對路徑，唔涉跨域。
- B2C guest版`/order`用獨立`guest-cart.js`（export名全部合法），唔受影響，運作正常（已用curl核實200+真實image_url）。

**已修復（2026-07-23，Joe拍板：刪走死+壞import並push，commit `90c4c71`）**：
1. `src/pages/shop/catalog.astro:132` 成句import已刪除（改前已備份、build通過、production部署後grep確認`updateCartItem`/`removeCartItem`已喺live HTML消失）。
2. Vercel已重新deploy（`inari-henna.vercel.app` alias已指向新版本，deployment `dpl_5KNpXCssBUDeFGUfKV8e74gRi5SA`）。
3. ⚠️**未完成**：因本機Playwright瀏覽器profile再次被佔用（同07-23第三輪一樣嘅環境問題），未能做登入後嘅真實視覺截圖驗證，淨係驗證咗「壞import字串已喺production HTML消失」+「build/syntax通過」。**下次Joe用手機開返個頁面就係最終驗證**，如果仲卡skeleton要即刻反饋。

**Joe提出嘅「加快取資料表」判斷（3個subagent一致）**：**唔對症，唔建議加**。204行view規模極細，curl即刻回應，冇「查太慢」呢個問題；加cache table對而家呢類「script link error令API根本冇被call」嘅bug完全冇幫助，仲有機會遮蓋類似bug令下次更難發現。如果純粹想長遠慳Supabase讀取次數/加快TTFB（同今次bug分開嘅獨立優化），已加`Cache-Control`header：`/api/order/catalog.ts`用`public, s-maxage=300, stale-while-revalidate=600`（B2C公開資料，食Vercel Edge CDN，已驗證`x-vercel-cache: HIT`生效）；`/api/products/catalog.ts`用`private, max-age=120`（B2B auth-gated，唔畀CDN層跨用戶共享，只做browser-side cache）。**未開新DB表，亦冇必要開**。

**Why**：Astro嘅`<script type="module">`入面import自`public/js/*.js`（絕對路徑）嘅statement，Vite/Astro build**唔會bundle/tree-shake去驗證export是否存在**——build/`npm run build`一律通過，呢類壞import只會喺真實瀏覽器執行時先曝光，`node --check`都查唔到（syntax valid，只係runtime/link error）。
**How to apply**：日後商城任何頁面新增/修改`import ... from '/js/*.js'`呢類public路徑import，一律先`grep "^export" <目標js檔>`核實每個named import真係存在，唔可以淨靠`npm run build`過就當有效——build過只證明syntax啱，證明唔到module能唔能夠喺瀏覽器真正執行。任何「已修復」結論如果冇真實瀏覽器（登入後）視覺驗證，一律要喺memory/report標明「未視覺驗證，僅API/build層核實」呢個風險等級，唔可以直接寫「已修好」。

## 十六、07-23 第六輪：修復路由撞名+補測試覆蓋缺口，過程中揪到兩個現正影響production嘅P0 bug

**Joe拍板**：「可以全部修復優化嗎？」——確認範圍(AskUserQuestion)：路由撞名直接查邊個真正用緊刪走另一個；測試補齊vitest單元/整合+Playwright端對端兩者都要；驗證通過就直接push。

**A. 路由撞名已修**：
1. `/salmon/storage`：`storage/index.astro`(19行粗糙草稿,3條FAQ)已刪，保留`storage.astro`(282行完整版,5條FAQ schema,跟返其他salmon頁嘅設計語言)。
2. `/admin`：`admin.astro`(舊版847行自建HTML shell)已刪，`admin/index.astro`(新版AdminLayout dashboard)保留做canonical。但`admin.astro`有個新系統冇對應嘅「對話記錄」tab(睇/刪AI對話session,接`/api/conversations.ts`)——已移植去新建嘅`src/pages/admin/conversations.astro`(用AdminLayout包住)+喺`AdminLayout.astro`側欄nav加返個連結，功能保持一致，冇silent regression。
3. `npm run build`已確認冇再出現route collision warning。

**B. 測試覆蓋已補**：
- **vitest**：新增`tests/order-api.test.ts`(12條)，用`vi.stubGlobal('fetch',...)`mock走Supabase REST call(跟返現有「純函式測試唔打真DB」慣例)，覆蓋B2C/B2B訂單建立嘅驗證邏輯+**items insert失敗嘅補償性DELETE regression test**(07-23第二輪先啱fix嗰個transaction-safety邏輯)。連現有57條，全部**69條通過**。
- **Playwright E2E**：新增`playwright.config.ts`+`tests/e2e/`四個spec——`catalog-image-display`(✓通過,證實`v_shop_catalog`圖片修復喺真瀏覽器work)、`b2b-login-order`(✓通過)、`b2c-guest-checkout`(✓通過,見下面P0#2)、`qr-login`(合理skip,詳細comment解釋依賴JWT_SECRET/已註冊jti/production forwarded-host行為,唔係靜默漏測)。資料隔離重用現有`scripts/uat_test_fixture_seed.sql`/`cleanup.sql`(customer_code=`TEST-UAT`)呢套慣例。**四個spec全部真正跑過本機dev server驗證，唔係淨係寫低就當過**。

**C. ⚠️過程中揪到兩個現正影響production嘅P0 bug（唔喺原本審計範圍，係跑E2E測試時真實撞到，已修復+已驗證）**：

1. **`/api/orders`(B2B訂單API)被middleware誤判做public路由，成個B2B訂單功能一直401**：`middleware.ts`嘅`PUBLIC_PREFIXES`原本有裸字串`'/api/order'`(打算做B2C白名單)，但`'/api/orders'.startsWith('/api/order')`都係`true`——B2C prefix意外連B2B都cover埋。Middleware早退令`locals.userType`永遠冇被注入，`/api/orders`嘅GET/POST handler自己嘅auth check見到`userType==='unknown'`就回401。**影響**：B2B客戶登入後開`/shop/orders`永遠顯示「0張訂單」(唔會報錯,silent)，新增訂單都會401。呢個regression由07-23 B2C launch(commit`427f24d`)引入，一直冇被發現，因為之前嘅UAT/驗證從未實際完整跑過「登入→開訂單頁」呢條路徑（Task B UAT focus係QR登入本身，唔係登入後嘅訂單API）。**已修**：`'/api/order'`改做`'/api/order/'`(trailing slash prefix，只cover`/api/order/catalog`+`/api/order/receipt`)，裸`/api/order`(B2C下單本身)改放入`PUBLIC_EXACT` Set精確比對，唔會再誤配`/api/orders`。獨立deep-reasoner覆核已CONFIRMED呢個fix冇引入新碰撞、B2C sub-route全部仍然覆蓋到。

2. **B2C guest下單100%失敗(500)，`amount`欄已變成DB generated column但code仲手動insert值**：`src/pages/api/order/index.ts`原本insert明細時set`amount: qty*unitPrice`，但直接查production DB(`information_schema.columns`)證實`inari_customer_order_items.amount`已經係`GENERATED ALWAYS AS (qty*unit_price) STORED`，手動insert呢個值會撞Postgres`428C9`。修埋呢個之後仲揪到第二層錯誤：`match_confidence`原本set做`'catalog'`，但DB CHECK約束(`20260719_order_fulfillment_uat_bugfixes.sql`)淨係准`exact/alias/fuzzy/unmatched/history/keyword`，`'catalog'`唔喺入面撞`23514`。**已修**：刪走手動`amount`(交返DB自動算)+`match_confidence`改做`'exact'`(guest直接喺catalog撳實件貨=完全命中,語意啱)。**呢個bug完全解釋咗07-23第二輪審計嘅懸案**——`inari_customer_orders`/`_items`兩表production 0行，之前記錄係「Joe刻意未開放」，而家證實**技術上根本冇一張訂單有可能成功建立過**，兩個原因並存(刻意未推廣 + 客觀上壞咗)。已用真實Playwright瀏覽器完整跑一次guest下單→確認頁→用order_no+電話反查，成功後手動清走測試訂單(id=62)冇留低污染數據。

3. **順手補嘅defense-in-depth**（獨立deep-reasoner覆核揪到，同今次改動直接相關）：`/api/conversations.ts`原本完全冇auth check(唔喺`PUBLIC_PREFIXES`亦唔喺`ROUTE_GUARDS`，middleware會放行但唔block)——現時因為Vercel冇persist store(comment自己都寫明`Note: Originally used Cloudflare D1... not persisted (stateless)`)所以無害,但一旦future回復真實儲存就會變成任何人都可以GET全部客戶對話/DELETE任意session。已補`if (!locals.isStaff) return 401`,GET/DELETE兩個handler都加咗，已用curl驗證(無cookie→401,manager cookie→200)。

**D. 已知但未修嘅新發現（超出今次授權範圍，記低留畀Joe拍板，冇擅自改）**：
- **`/api/order`(B2C POST)信任client送嚟嘅`unit_price`，理論上可以落MOP 0.01嘅單**——現有`status='draft'`+職員`/admin/orders`人手confirm有緩解，但若職員信任畫面顯示金額直接confirm就會蝕價出貨。建議：server-side用`product_id`/`sku`喺`v_shop_catalog`重新查價覆寫client送嚟嘅`unit_price`，唔好直接信任body。
- **「對話記錄」tab移植咗但功能本身係空殼**——`/api/conversations`喺Vercel冇persist store,永遠得空list,呢個唔係今次改動造成(舊`admin.astro`一樣係咁)，純粹如實記低。

**驗證方法**：全程用真實Playwright瀏覽器(唔止curl)跑過4條E2E spec；`npx vitest run`69/69通過；`npm run build`冇route collision warning；獨立deep-reasoner對middleware/API/AdminLayout三組核心改動做咗對抗覆核(CONFIRMED三個fix全部正確，額外揪到上面C3同D兩點)。

**Why**：呢次示範咗「E2E測試唔止係補缺口，仲會揪到靠code review/curl永遠揪唔到嘅真實regression」——middleware prefix碰撞同DB generated column衝突,兩個都要「真係喺瀏覽器行完成個登入→操作流程」先會現形,單獨睇任何一個檔案嘅diff都睇唔出。
**How to apply**：日後`PUBLIC_PREFIXES`呢類prefix-based白名單，新增項目前一定要`grep`一次確認冇其他真實路由會被呢個prefix意外cover到(尤其複數/單數字詞好似`order`/`orders`呢類)；DB欄位如果由其他session/migration改成`GENERATED`，code層面insert payload要同步檢查，`information_schema.columns`嘅`is_generated`係最快確認方法。四個Playwright spec已留喺repo，日後任何middleware/checkout改動，建議先手動`npm run dev`+跑一次`npx playwright test`先push，唔好淨係跑`npm run build`就當安全。
