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

## 九、07-23 B2B 3個bug已修（code done，未push）

1. `inari_customer_orders`加`total_amount`（見上面migration）+`/api/orders`GET改用PostgREST embed(`select=*,items:inari_customer_order_items(*)`)+`shop/orders.astro`改讀`o.total_amount`
2. `shop/orders.astro`嘅死link（連去唔存在嘅`/shop/orders/{id}`）改做原地展開accordion（同`/account`頁一致嘅UX pattern），用返上面嘅items embed顯示明細
3. 刪除`src/pages/api/shop-login.ts`（舊v2登入,無鹽SHA-256,冇人再call）+移除middleware `PUBLIC_PREFIXES`對應嘅`/api/shop-login`

## 十一、07-23 第二輪 /omni-audit：商城功能完整性 + 競品分析（report.md：`~/.openclaw/reports/omni-audit-inari-shop-features-competitive-2026-07-23/`）

**⚠️核心發現**：直接查production DB核實，`inari_customer_orders`/`inari_customer_order_items` 兩表**0行**，即使 `inari_schema_registry` 寫住「live/api/orders live寫入」。B2B自助下單套系統code完整已deploy，但從未有一張訂單真正成功落地過——下次任何商城任務見到「live」標記，記得呢個係「code已通」唔等於「已有人用」，兩者要分開驗證。

**本次新揪到並已修復（code done，未commit）**：
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
