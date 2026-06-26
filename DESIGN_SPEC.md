# 稻荷商城 — 設計規格文件
> 給 Claude Design 使用，目標風格：海鮮食材電商（參考 FreshDirect.com）

---

## 一、專案概覽

**稻荷商城** 是日本海鮮食材 B2B 訂購平台，服務對象為澳門高端餐廳、酒店採購員及散客。  
核心功能：語音/文字下單、商品目錄瀏覽、購物車結帳、員工後台管理訂單。

**技術棧**：Astro.js + Cloudflare Pages + Supabase PostgreSQL  
**主要用戶**：餐廳採購員（手機為主）、稻荷內部員工（桌機）

---

## 二、後端資料結構

### 2.1 資料庫 Schema（Supabase PostgreSQL）

#### `inari_users` — 用戶帳號
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | uuid PK | 用戶 ID |
| username | text UNIQUE | 登入名稱 |
| role | text | 角色標籤 |
| user_type | text | `staff` / `b2b` / `b2c` / `manager` |
| customer_code | text NULL | B2B 客戶代碼（如 AB001） |
| web_password | text | `$sha256$<hex>` 格式 |
| is_active | bool | 帳號是否啟用 |
| created_at | timestamptz | |

#### `inari_products` — 商品目錄（649 件）
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | bigint PK | |
| sku | text UNIQUE | 商品編號（如 A1A0005、KK0007） |
| name | text | 商品名稱（繁中） |
| category | text | 分類（見下方列表） |
| unit | text | 計算單位（件/kg/隻/盒/包/pack） |
| sales_price | numeric | 售價（MOP） |
| storage_type | text | `冷凍` / `冰鮮` / `空運` |
| is_air_freight | bool | 是否空運 |
| is_active | bool | |
| product_name_clean | text | 去除括號的搜尋用名稱 |

**商品分類（18 類）**：
乾貨/調味料、冰鮮空運、加工品、包裝材料、小食/甜品、漬物/海藻/紫菜、炸粉/調味粉、珍味小食、茶飲、蝦蟹類、調味醬料、貝類、雜項/取庫存貨、頭足類、魚卵/蟹子、魚類、麵類

**商品類型標記**：
- ✈️ 空運冰鮮（`is_air_freight: true`）— SKU 前綴 A 開頭，如北海道海膽、活扇貝
- ❄️ 冷凍（`storage_type: 冷凍`）— SKU 前綴 KK 開頭

#### `inari_product_keywords` — 商品關鍵字（101 筆）
| 欄位 | 類型 | 說明 |
|------|------|------|
| sku | text | 關聯 inari_products.sku |
| keyword | text | 語音/文字辨識關鍵字 |
| keyword_type | text | `alias` / `brand` / `common` |

#### `inari_customer_orders` — 訂單主檔
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | bigint PK | |
| order_no | text UNIQUE | 格式 `ORD-YYYYMMDD-XXXXXX` |
| customer_code | text | 客戶代碼（UNKNOWN = 員工/測試） |
| customer_name | text | 客戶名稱 |
| order_date | date | 下單日期 |
| source | text | `web` / `voice` |
| status | text | `draft` → `confirmed` → `invoiced` → `cancelled` |
| payment_method | text | 月結 / 現金 / 轉帳 / 支票 |
| delivery_date | date | 送貨日期 |
| notes | text | 備注 |
| raw_text | text | 語音/文字原文 |
| confirmed_at | timestamptz | 確認時間 |
| tenant_id | uuid | `b15d5a02-764c-4353-ad40-07b901d9f321` |
| created_at | timestamptz | |

**訂單狀態流程**：
```
draft（草稿）→ confirmed（已確認）→ invoiced（已開單）
      ↘                    ↘
        cancelled（已取消）← cancelled
```

#### `inari_customer_order_items` — 訂單明細
| 欄位 | 類型 | 說明 |
|------|------|------|
| id | bigint PK | |
| order_id | bigint FK | → inari_customer_orders.id |
| order_no | text | 冗餘備用 |
| product_id | bigint NULL | → inari_products.id |
| product_code | text | SKU |
| product_name | text | 商品名稱 |
| qty | numeric | 數量 |
| unit | text | 單位 |
| unit_price | numeric | 單價（MOP） |
| amount | numeric GENERATED | = qty × unit_price（自動計算） |
| match_confidence | text | `keyword` / `fuzzy` / `unmatched` |
| tenant_id | uuid | |

#### `inari_cart` — 購物車（服務端備份）
| 欄位 | 類型 | 說明 |
|------|------|------|
| session_id | text | 本地 localStorage session |
| sku | text | |
| product_name | text | |
| qty | numeric | |
| unit | text | |
| unit_price | numeric | |
| line_total | numeric | |
| tenant_id | uuid | |

---

### 2.2 API 端點完整列表

#### 🔓 公開 API（無需登入）

| Method | Path | 功能 |
|--------|------|------|
| POST | `/api/login` | 員工舊版密碼登入（legacy） |
| POST | `/api/shop-login` | 用戶名+密碼登入，設 cookie |
| GET | `/api/knowledge` | 查詢知識庫（ AI 問答用） |
| POST/PUT/DELETE | `/api/knowledge` | 管理知識庫 |
| POST | `/api/chat` | AI 客服對話（MiniMax，SSE 串流） |
| POST | `/api/voice/parse` | 語音/文字解析成訂單明細 |
| GET | `/api/products/search?q=` | 商品關鍵字搜尋 |

#### 🔒 需登入 API（X-User-Type header）

| Method | Path | 權限 | 功能 |
|--------|------|------|------|
| GET | `/api/products/catalog` | 所有用戶 | 商品目錄（分頁+篩選） |
| POST | `/api/cart/sync` | 所有用戶 | 同步購物車到 Supabase |
| GET | `/api/orders` | 所有用戶 | 訂單列表（客戶只看自己） |
| POST | `/api/orders` | 所有用戶 | 建立草稿訂單 |
| PATCH | `/api/orders/{id}/confirm` | 所有用戶 | 確認訂單（改狀態+更新欄位） |
| GET | `/api/admin/orders` | staff/manager | 管理員訂單列表+品項 |
| PATCH | `/api/admin/orders/{id}` | staff/manager | 更新訂單狀態 |

#### API 回傳格式範例

**GET /api/products/catalog**
```json
{
  "items": [
    {
      "id": 1,
      "sku": "A1A0005",
      "name": "(北海道/俄羅斯)日本海膽(250g)",
      "category": "魚卵/蟹子",
      "unit": "盒",
      "sales_price": 550,
      "storage_type": "冷凍",
      "is_air_freight": true
    }
  ],
  "categories": ["魚類", "貝類", "蝦蟹類", ...],
  "total": 649,
  "page": 1,
  "limit": 24,
  "has_more": true
}
```

**POST /api/orders（請求）**
```json
{
  "items": [
    {
      "product_code": "A1A0005",
      "product_name": "(北海道/俄羅斯)日本海膽(250g)",
      "qty": 5,
      "unit": "盒",
      "unit_price": 550
    }
  ],
  "source": "web",
  "payment_method": "月結",
  "delivery_date": "2026-05-22",
  "notes": "請在早上10點前送達"
}
```

---

### 2.3 認證系統

**Cookie**：`inari_auth_v2`（不含 HttpOnly，前端可讀）
**格式**：`btoa(JSON.stringify(session))`
**Session 結構**：
```json
{
  "v": 2,
  "id": "uuid",
  "username": "abc_restaurant",
  "user_type": "b2b",
  "role": "user",
  "customer_code": "AB001",
  "exp": 1750000000
}
```

**X-Header 注入（middleware）**：
- `X-User-Type`：`staff` / `b2b` / `b2c` / `manager`
- `X-User-Role`：具體角色
- `X-Username`：用戶名
- `X-Customer-Code`：B2B 客戶代碼
- `X-User-Id`：UUID

**路由保護**：
- `/shop/admin/*` → 僅 staff / manager 可進入
- `/shop/*` → 需登入，否則跳轉 `/shop/login`
- `/api/chat`, `/api/knowledge`, `/api/voice/parse` → 完全公開

---

## 三、前端頁面功能規格

### 3.1 頁面架構圖

```
/shop/login          登入頁
/shop                ★ 首頁 Dashboard
/shop/catalog        ★ 商品目錄（主要購物頁）
/shop/checkout       ★ 購物車結帳
/shop/order/new      語音/文字下單
/shop/orders         訂單記錄列表
/shop/orders/{id}    訂單詳情
/shop/search         商品搜尋
/shop/admin/orders   ★ 員工訂單管理後台
/shop/order/confirmed 訂單確認成功頁
```
★ = 最常用頁面，優先設計

---

### 3.2 各頁面功能詳細

---

#### 📄 `/shop` — 首頁 Dashboard

**用戶**：所有登入用戶

**目前功能**：
- 頂部 Header：Logo + 用戶名/客戶代碼 + 登出按鈕
- 快速入口 Grid（2列）：
  - 🎙️ 語音下單 → `/shop/order/new`
  - 📋 訂單記錄 → `/shop/orders`
  - 🔍 商品搜尋 → `/shop/search`
  - ✏️ 文字下單 → `/shop/order/new?mode=text`
  - 🛒 商品目錄 → `/shop/catalog`
  - 💳 購物車結帳 → `/shop/checkout`（顯示購物車件數）
  - ⚙️ 訂單管理 → `/shop/admin/orders`（僅 staff/manager）
- 最近訂單列表（最新 5 筆）：order_no + 客戶 + 日期 + 狀態badge

**設計需求**：
- 歡迎語 + 用戶名稱
- 今日日期顯示
- 購物車件數 badge
- 管理員入口視覺上要明顯區別（不同顏色框）
- 最近訂單的狀態用顏色 badge 區分（草稿=黃、已確認=綠、已開單=藍）

---

#### 📄 `/shop/catalog` — 商品目錄

**用戶**：所有登入用戶

**目前功能**：
- 頂部 Header：返回鍵 + Logo + 搜尋框 + 購物車按鈕（含件數badge）
- 左側分類列表（Sidebar，18 個分類）
- 主區域商品 Grid（24件/頁）
  - 每張商品卡：商品圖片佔位/placeholder + 類型badge（✈️空運 / ❄️冷凍）+ SKU + 名稱 + 價格/單位 + 數量選擇器 + 加入購物車
- 底部「載入更多商品」按鈕（分頁）
- 右側滑出購物車面板（Drawer）：品項列表 + 數量調整 + 合計 + 前往結帳連結

**設計需求**：
- 商品卡需要有清晰的新鮮感（海鮮食材風格）
- ✈️ 空運標籤 = 高端/新鮮，視覺上要突出
- ❄️ 冷凍標籤 = 一般
- 購物車 Drawer 要有固定底部結帳 CTA
- 搜尋框要明顯（用戶常用 SKU 搜尋）
- 分類 Sidebar 在手機版需折疊成橫向捲動 Pills

**商品卡數據**：
```
SKU: A1A0005
名稱: (北海道/俄羅斯)日本海膽(250g)
分類: 魚卵/蟹子
價格: MOP 550 / 盒
標籤: ✈️ 空運
```

---

#### 📄 `/shop/checkout` — 結帳頁

**用戶**：所有登入用戶

**目前功能**（兩欄佈局）：
- 左欄「訂單摘要」：品項列表（名稱 + SKU + 數量 + 單位 + 單價 + 小計）+ 合計金額
- 右欄「送貨資訊」表單：
  - 送貨日期（date picker，最早明天）
  - 付款方式（4 選 1 radio：月結/現金/銀行轉帳/支票）
  - 備注 textarea
  - 確認下單按鈕（紅色全寬）
- 送出流程：POST /api/orders（建草稿）→ PATCH confirm → clearCart → 跳轉成功頁

**設計需求**：
- 手機版需堆疊成單欄
- 確認下單按鈕要夠大、明顯
- 付款方式選項要清晰（月結最常用，預設勾選）
- 品項列表要顯示清楚（名稱+數量+小計三列）

---

#### 📄 `/shop/order/new` — 語音/文字下單

**用戶**：所有登入用戶（B2B 最常用）

**目前功能**：
- 模式切換：語音輸入 / 文字輸入
- **語音模式**：
  - 麥克風按鈕（Web Speech Recognition，語言：粵語 zh-HK）
  - 即時語音轉文字顯示
  - 自動呼叫 `/api/voice/parse` 解析
- **文字模式**：
  - 大型 textarea（如：「海膽5盒 扇貝10隻 三文魚2kg」）
  - 送出後呼叫 `/api/voice/parse`
- **解析結果表格**：
  - 每行：信心度 badge + 商品名稱 + 數量（可編輯）+ 單位（可改） + 單價（可改）
  - 信心度：`keyword`（關鍵字精確）/ `fuzzy`（模糊比對）/ `unmatched`（未比對）
- 確認下單 → POST /api/orders

**設計需求**：
- 語音按鈕要大、觸感清晰（手機操作）
- 解析結果的信心度 badge 要用顏色區分（綠/黃/紅）
- 未比對的品項要明顯標示，提示用戶確認

---

#### 📄 `/shop/orders` — 訂單記錄

**用戶**：所有登入用戶

**目前功能**：
- 頂部狀態篩選 pills（全部/草稿/已確認/已開單）
- 訂單卡列表（最新100筆）：
  - 訂單號 + 狀態 badge
  - 客戶名/代碼 + 日期 + 來源(web/voice)
  - 原始文字 preview（60字）
- FAB 按鈕「＋ 新增訂單」
- 點擊卡片 → `/shop/orders/{id}`

---

#### 📄 `/shop/admin/orders` — 員工訂單管理

**用戶**：僅 staff / manager

**目前功能**：
- 頂部統計卡（4格）：草稿待確認數 / 已確認數 / 已開單數 / 今日金額
- 篩選列：日期選擇 + 狀態下拉 + 客戶名稱搜尋 + 查詢按鈕
- 訂單表格（8欄）：單號 / 客戶 / 日期 / 品項（前2個商品名+總數）/ 金額 / 付款 / 狀態 / 操作
- 操作按鈕依狀態動態顯示：
  - `draft`：確認訂單 + 取消
  - `confirmed`：標記開單 + 取消
  - `invoiced`：無操作
- Toast 通知（右下角滑出）

**設計需求**：
- 統計卡要有清晰的數字對比（大字體）
- 表格在桌機版要緊湊，手機版要橫向捲動
- 操作按鈕顏色：確認=綠、開單=藍、取消=紅
- 狀態 badge：草稿=黃底、已確認=綠底、已開單=藍底、已取消=灰底

---

### 3.3 前端共用 JavaScript 模組

#### `/js/auth.js`
```javascript
// 從 inari_auth_v2 cookie 讀取 session
getAuth() → {
  isLoggedIn: bool,
  isStaff: bool,        // user_type === "staff"
  isB2B: bool,          // user_type === "b2b"
  isB2C: bool,          // user_type === "b2c"
  user: {
    username,
    user_type,
    customer_code,
    role
  }
}
logout() // 清除 cookie，跳轉 /login
```

#### `/js/cart.js`
```javascript
// LocalStorage key: "inari_cart"
// 購物車結構：
{
  session_id: "uuid",
  items: [{
    sku: "A1A0005",
    product_id: 1,
    product_name: "(北海道)日本海膽(250g)",
    qty: 3,
    unit: "盒",
    unit_price: 550,
    line_total: 1650,
    added_at: "ISO string"
  }],
  updated_at: "ISO string"
}

// 導出方法
addToCart(sku, name, price, unit, productId)
removeFromCart(sku)
updateQty(sku, qty)
getCart()                // 回傳整個 cart 物件
clearCart()
getCartCount()           // 總件數
getCartTotal()           // 總金額（MOP）
openCartPanel()          // 打開右側 Drawer
closeCartPanel()
initCart(containerEl)    // 初始化 cart panel HTML
```

---

## 四、UI/UX 設計規格

### 4.1 用戶旅程（主要流程）

```
登入 → 首頁 → 商品目錄 → 加入購物車 × N → 結帳 → 成功頁
                ↓ 或
              語音下單 → 確認品項 → 建立訂單 → 成功頁
```

### 4.2 目標風格 — 海鮮食材電商

**參考**：FreshDirect.com  
**核心感受**：新鮮、優質、信任感、專業食材供應

**色彩建議**：
- 主色：深藍 `#0a3d62` 或深海藍（代表海洋、新鮮）
- 強調色：珊瑚橙/紅 `#e55039` 或深橙（食欲感）
- 背景：米白 `#f9f7f4` 或淡海藍
- 成功：綠 `#27ae60`
- 空運/高端商品：金色 badge `#f1c40f`
- 冷凍商品：冰藍 badge

**Typography 建議**：
- 標題：粗體，大字，清晰
- 商品名稱：14-15px，中文需清晰可讀（PingFang TC / Noto Sans TC）
- 價格：突出顯示，紅色或橙色，font-weight 800

**商品卡設計元素**：
- 清新的商品圖片區（現為空白 placeholder）
- 新鮮度標籤（✈️ 今日空運、❄️ 冷凍庫存）
- 原產地標記（括號內：北海道/俄羅斯）
- 清晰的價格 + 單位
- 加入購物車按鈕（全寬或右下角）

### 4.3 響應式設計要求

| 頁面 | 手機（< 768px） | 桌機（≥ 1024px） |
|------|----------------|-----------------|
| 首頁 | 2 × N Grid | 3 × N Grid |
| 商品目錄 | 頂部分類 Pills 橫向捲動，2列 Grid | 左側 Sidebar + 3-4列 Grid |
| 結帳 | 單欄堆疊 | 雙欄（摘要+表單） |
| 訂單管理 | 橫向捲動表格 | 固定表格 |

### 4.4 關鍵 UI 組件

#### 商品卡（Product Card）
```
┌──────────────────────┐
│  [商品圖片 160px]     │
│  ✈️ 空運              │  ← badge 左上角
├──────────────────────┤
│ A1A0005               │  ← SKU 小字灰色
│ (北海道)日本海膽(250g)│  ← 名稱 14px 粗體
│ MOP 550 / 盒          │  ← 價格紅色 16px 粗
├──────────────────────┤
│ [−] [  1  ] [+]  [🛒]│  ← 數量+加入購物車
└──────────────────────┘
```

#### 訂單狀態 Badge
```
草稿    → 黃底深橙字  背景 #fef3c7  文字 #92400e
已確認  → 綠底深綠字  背景 #d1fae5  文字 #065f46
已開單  → 藍底深藍字  背景 #dbeafe  文字 #1e3a8a
已取消  → 灰底灰字    背景 #f3f4f6  文字 #6b7280
```

#### 購物車 Drawer（右側滑出）
```
┌─────────────────────────┐
│ 購物車（3件）         ✕ │  ← 標題 + 關閉
├─────────────────────────┤
│ 日本海膽(250g)          │
│ MOP 550 / 盒   [−][2][+]│
│ 小計: MOP 1,100       × │
├─────────────────────────┤
│ 寬永木魚花(500g*5)      │
│ MOP 92 / 件   [−][1][+] │
│ 小計: MOP 92          × │
├─────────────────────────┤
│ 合計: MOP 1,192         │
│ [  前往結帳 →  ]        │  ← 主 CTA 按鈕
└─────────────────────────┘
```

---

## 五、頁面間數據流

```
auth.js → getAuth()
    ↓
所有頁面讀取 {isLoggedIn, isStaff, user}
    ↓
商品目錄 GET /api/products/catalog
    ↓
cart.js addToCart() → localStorage
    ↓ (debounce 2s)
POST /api/cart/sync → Supabase inari_cart
    ↓
結帳頁 getCart() → POST /api/orders → PATCH /api/orders/{id}/confirm
    ↓
成功頁 clearCart()
```

---

## 六、現有頁面 URL 結構（重要：設計時不可更改）

| URL | 標題 | 主功能 |
|-----|------|--------|
| `/shop/login` | 稻荷商城 — 登入 | 登入表單 |
| `/shop` | 稻荷商城 | 功能入口 + 近期訂單 |
| `/shop/catalog` | 稻荷商城 — 商品目錄 | 瀏覽649件商品 |
| `/shop/checkout` | 稻荷商城 — 結帳 | 確認訂單 + 送貨資訊 |
| `/shop/order/new` | 稻荷商城 — 新增訂單 | 語音/文字下單 |
| `/shop/orders` | 稻荷商城 — 訂單記錄 | 歷史訂單 |
| `/shop/search` | 稻荷商城 — 商品搜尋 | 快速搜尋 |
| `/shop/admin/orders` | 稻荷商城 — 訂單管理 | 員工後台 |
| `/shop/order/confirmed` | 稻荷商城 — 訂單已確認 | 下單成功頁 |

---

## 七、設計注意事項

1. **語言**：全部繁體中文，少量英文（SKU、MOP）
2. **用戶主要設備**：iPhone / Android 手機（B2B 採購員在倉庫用手機下單）
3. **網路環境**：可能在廚房/倉庫，需要清晰的 Loading 狀態
4. **訂單號格式**：`ORD-20260519-UNKNUV`（不可改，後端自動生成）
5. **金額貨幣**：MOP（澳門幣），格式 `MOP 1,234`
6. **B2B 限制**：客戶只能看自己的訂單，不可看其他客戶
7. **無商品圖片**：現有資料庫無圖片 URL，設計需考慮 placeholder 方案（依分類顯示不同佔位圖）
8. **空運商品**（SKU 前綴 A）：高端食材，設計上需要突顯質感
9. **Toast 通知**：右下角滑入，2.8秒後消失，成功=深色背景白字
