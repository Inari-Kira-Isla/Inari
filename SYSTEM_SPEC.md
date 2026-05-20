# 稻荷系統規格文件 v1.0
**建立日期：** 2026-05-20  
**適用版本：** inari.pages.dev（Astro v5 + Vercel + Supabase inari-production）  
**Supabase Project：** `cqartwwsbxnjjatmndtt.supabase.co`  
**Tenant ID：** `b15d5a02-764c-4353-ad40-07b901d9f321`

---

## 1. 系統架構圖（文字版 ASCII）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INARI 三層入口架構                                   │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌──────────────────┐
                         │   inari.pages.dev │
                         │   主域 / CDN Edge │
                         └────────┬─────────┘
                                  │
          ┌───────────────────────┼────────────────────────┐
          ▼                       ▼                         ▼
  ┌───────────────┐      ┌────────────────┐       ┌─────────────────┐
  │  品牌主頁      │      │  批發商戶入口   │       │  零售商城入口    │
  │  /            │      │  /shop/*        │       │  /retail/*      │
  │  /brand       │      │  /account       │       │  (Phase 2)      │
  │  /knowledge/* │      │  /admin/*       │       └────────┬────────┘
  │  /market/*    │      │  /wholesale/*   │                │
  │  /salmon/*    │      └────────┬────────┘                │
  │  /sea-urchin/*│               │                         │
  │  /faq/*       │               │                         │
  │  /blog/*      │               │                         │
  └───────────────┘               │                         │
          │                       │                         │
          │                       ▼                         ▼
          │              ┌─────────────────────────────────────────┐
          │              │         Vercel Serverless Functions      │
          │              │  /api/login    /api/shop-login          │
          └──────────────┤  /api/auth/retail-login (Phase 2)       │
                         │  /api/orders/* /api/products/*          │
                         │  /api/admin/*  /api/voice/parse         │
                         │  /api/knowledge /api/chat               │
                         │  /api/seasonal  /api/retail/* (P2)      │
                         └──────────────────┬──────────────────────┘
                                            │
                                            ▼
                         ┌──────────────────────────────────────────┐
                         │      Supabase PostgreSQL (inari-prod)     │
                         │                                           │
                         │  ① inari_users (staff/manager/wholesale) │
                         │  ② inari_products (649件)                │
                         │  ③ inari_customers (179位)               │
                         │  ④ inari_suppliers (3家)                 │
                         │  ⑤ inari_customer_orders + items         │
                         │  ⑥ qb_sales (614,269筆 READ ONLY)        │
                         │  ⑦ inari_knowledge_items (36筆)          │
                         │  ⑧ product_knowledge (44筆)              │
                         │  ⑨ region_knowledge (8筆)                │
                         │  ⑩ inari_product_keywords (101關鍵字)    │
                         │  ⑪ inari_retail_users (Phase 2 新建)     │
                         │  ⑫ inari_retail_orders (Phase 2 新建)    │
                         │  ⑬ inari_cart (已存在，best-effort)      │
                         │  ⑭ inari_brand_content (Phase 1 新建)    │
                         └──────────────────────────────────────────┘

用戶流向：
  manager  → 統一後台 /admin/* ←→ 所有資料庫讀寫
  staff    → 商城系統 /shop/*  ←→ 訂單/商品/客戶
  wholesale → 批發入口 /account ←→ 自己的訂單/商品目錄
  retail   → 零售商城 /retail/* ←→ 購物車/自己的訂單 (Phase 2)
  anon     → 品牌主頁 /* (public) ←→ 知識庫(READ)/FAQ/Chat
```

---

## 2. 用戶類型與權限矩陣

| 用戶類型 | 說明 | 登入方式 | Cookie | 可存取頁面 |
|---------|------|---------|--------|-----------|
| **anon** | 未登入訪客 | 無 | 無 | 品牌主頁、知識庫、FAQ、Chat |
| **staff** | 會計/銷售同事 | 帳號+密碼 (`inari_users`) | `inari_auth_v3` | /shop/*, /account (自己) |
| **manager** | 管理員 | 帳號+密碼 (`inari_users`) | `inari_auth_v3` | /admin/*, /shop/*, 全部 |
| **wholesale** | 批發客戶 | 帳號+密碼 (`inari_users`) | `inari_auth_v3` | /account, /shop/catalog, /shop/order/new |
| **retail** | 零售客戶 (Phase 2) | 手機 OTP (`inari_retail_users`) | `inari_retail_v1` | /retail/*, 零售商城頁面 |

### 頁面存取權限矩陣

| 頁面路徑 | anon | staff | manager | wholesale | retail |
|---------|------|-------|---------|-----------|--------|
| `/` 品牌主頁 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/brand` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/knowledge/*` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/market/*` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/salmon/*` `/sea-urchin/*` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/faq/*` `/blog/*` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/login` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/shop/login` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/shop/` (儀表板) | ✗ | ✓ | ✓ | ✓ | ✗ |
| `/shop/catalog` | ✗ | ✓ | ✓ | ✓ | ✗ |
| `/shop/order/new` | ✗ | ✓ | ✓ | ✓ | ✗ |
| `/shop/orders` | ✗ | ✓ (全部) | ✓ (全部) | ✓ (自己) | ✗ |
| `/shop/admin/*` | ✗ | ✓ | ✓ | ✗ | ✗ |
| `/account` | ✗ | ✗ | ✓ | ✓ | ✗ |
| `/admin/*` | ✗ | ✗ | ✓ | ✗ | ✗ |
| `/wholesale/*` | ✗ | ✗ | ✓ | ✓ | ✗ |
| `/retail/*` (Phase 2) | ✗ | ✗ | ✓ | ✗ | ✓ |

---

## 3. 完整路由表

### 3.1 現有路由（Phase 0，已存在）

| 路徑 | 類型 | 保護 | 存取 | 說明 |
|------|------|------|------|------|
| `/` | 頁面 | public | anon+ | 品牌主頁（英文版，GSAP 動畫）|
| `/login` | 頁面 | public | anon | 舊密碼登入（v1 cookie，待棄用）|
| `/shop/login` | 頁面 | public | anon | 帳號+密碼登入（v2/v3 cookie）|
| `/shop/` | 頁面 | protected | staff/manager/wholesale | 商城首頁儀表板 |
| `/shop/catalog` | 頁面 | protected | staff/manager/wholesale | 商品目錄瀏覽 |
| `/shop/order/new` | 頁面 | protected | staff/manager/wholesale | 語音/文字下單 |
| `/shop/orders` | 頁面 | protected | staff/manager/wholesale | 訂單列表 |
| `/shop/checkout` | 頁面 | protected | staff/manager/wholesale | 訂單確認 |
| `/shop/order/confirmed` | 頁面 | protected | staff/manager/wholesale | 訂單確認成功 |
| `/shop/search` | 頁面 | protected | staff/manager/wholesale | 商品搜尋 |
| `/shop/admin/orders` | 頁面 | protected | staff/manager | 管理員訂單管理 |
| `/admin` | 頁面 | protected | staff/manager | 後台管理（知識庫+對話）|
| `/faq/` | 頁面 | public | anon+ | 常見問題 |
| `/market/*` | 頁面 | public | anon+ | 市場知識 (5頁) |
| `/salmon/*` | 頁面 | public | anon+ | 三文魚知識 (6頁) |
| `/sea-urchin/*` | 頁面 | public | anon+ | 海膽知識 (5頁) |
| `/blog/*` | 頁面 | public | anon+ | 部落格 (3篇) |

### 3.2 Phase 1 新增路由

| 路徑 | 類型 | 保護 | 存取 | 說明 |
|------|------|------|------|------|
| `/brand` | 頁面 | public | anon+ | 品牌故事主頁（繁中版）|
| `/knowledge/` | 頁面 | public | anon+ | 商品知識庫索引 |
| `/knowledge/seafood` | 頁面 | public | anon+ | 海鮮知識庫 |
| `/knowledge/seasonal` | 頁面 | public | anon+ | 季節旬物日曆 |
| `/knowledge/regions` | 頁面 | public | anon+ | 產地地區知識 |
| `/wholesale/` | 頁面 | protected | wholesale/manager | 批發客戶入口頁 |
| `/account` | 頁面 | protected | wholesale/manager | 帳戶資訊、訂單歷史 |
| `/admin/dashboard` | 頁面 | protected | manager | 統一後台：報表儀表板 |
| `/admin/products` | 頁面 | protected | manager | 商品管理 |
| `/admin/customers` | 頁面 | protected | manager | 客戶管理 |
| `/admin/orders` | 頁面 | protected | manager/staff | 全訂單管理 |
| `/admin/knowledge` | 頁面 | protected | manager | 知識庫管理 (原 /admin) |
| `/admin/analytics` | 頁面 | protected | manager | RFM 分析儀表板 |

### 3.3 Phase 1 新增重定向規則

| 來源 | 目標 | 條件 |
|------|------|------|
| `/wholesale` | `/wholesale/` | permanent |
| `/shop` (wholesale user) | `/wholesale/` | 按 user_type 判斷 |
| `/shop` (staff/manager) | `/shop/` | 直接進入 |
| `/admin` (舊路由) | `/admin/knowledge` | permanent |

### 3.4 Phase 2 新增路由

| 路徑 | 類型 | 保護 | 存取 | 說明 |
|------|------|------|------|------|
| `/retail/` | 頁面 | public | anon+ | 零售商城首頁 |
| `/retail/login` | 頁面 | public | anon | 零售客戶登入（OTP）|
| `/retail/register` | 頁面 | public | anon | 零售客戶註冊（手機）|
| `/retail/shop` | 頁面 | protected | retail | 零售購物首頁 |
| `/retail/products` | 頁面 | protected | retail | 零售商品瀏覽 |
| `/retail/cart` | 頁面 | protected | retail | 購物車 |
| `/retail/checkout` | 頁面 | protected | retail | 零售結帳 |
| `/retail/orders` | 頁面 | protected | retail | 零售訂單歷史 |
| `/retail/profile` | 頁面 | protected | retail | 個人資料 |

---

## 4. 資料庫設計

### 4.1 現有表變更（Phase 1）

#### `inari_users` — 新增欄位

```sql
ALTER TABLE inari_users
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT DEFAULT 'zh-TW';
```

> 說明：`user_type` 現有值 staff/manager/wholesale 不變。`web_password` 現有欄位不動（$sha256$ 格式）。

#### `inari_products` — 確認現有欄位，新增 Phase 1 需要的欄位

```sql
ALTER TABLE inari_products
  ADD COLUMN IF NOT EXISTS is_retail_listed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS retail_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS min_retail_qty INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS product_description_zh TEXT,
  ADD COLUMN IF NOT EXISTS seasonal_months INTEGER[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS origin_region TEXT;
```

> 說明：`is_active` 控制批發可見；`is_retail_listed` 控制零售可見（Phase 2 用）。`seasonal_months` 存陣列如 `{4,5,6}`，用於 Seasonal API。

#### `inari_customer_orders` — 確認已有欄位，新增 Phase 1 欄位

```sql
ALTER TABLE inari_customer_orders
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2);
```

### 4.2 新增表（Phase 1）

#### `inari_brand_content` — 品牌內容管理

```sql
CREATE TABLE IF NOT EXISTS inari_brand_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT 'b15d5a02-764c-4353-ad40-07b901d9f321',
  content_type TEXT NOT NULL,
  -- content_type: 'hero', 'story', 'seasonal_callout', 'faq', 'knowledge_card'
  slug TEXT NOT NULL UNIQUE,
  title_zh TEXT,
  title_en TEXT,
  body_zh TEXT,
  body_en TEXT,
  metadata JSONB DEFAULT '{}',
  -- metadata 範例：{"image_url": "...", "season": "spring", "tags": ["海膽", "北海道"]}
  is_published BOOLEAN DEFAULT false,
  publish_from DATE,
  publish_until DATE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_brand_content_type ON inari_brand_content(content_type);
CREATE INDEX idx_brand_content_published ON inari_brand_content(is_published, publish_from, publish_until);
```

#### `inari_seasonal_calendar` — 旬物季節日曆

```sql
CREATE TABLE IF NOT EXISTS inari_seasonal_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT 'b15d5a02-764c-4353-ad40-07b901d9f321',
  product_id UUID REFERENCES inari_products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  peak_months INTEGER[] NOT NULL,
  -- 陣列，1=1月, 12=12月
  off_months INTEGER[] DEFAULT '{}',
  season_notes_zh TEXT,
  quality_peak_description TEXT,
  origin TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_seasonal_sku ON inari_seasonal_calendar(sku);
```

### 4.3 新增表（Phase 2）

#### `inari_retail_users` — 零售客戶（獨立表，不混入 inari_users）

```sql
CREATE TABLE IF NOT EXISTS inari_retail_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT 'b15d5a02-764c-4353-ad40-07b901d9f321',
  phone TEXT NOT NULL UNIQUE,
  phone_verified BOOLEAN DEFAULT false,
  display_name TEXT,
  email TEXT,
  preferred_locale TEXT DEFAULT 'zh-TW',
  is_active BOOLEAN DEFAULT true,
  otp_code TEXT,
  otp_expires_at TIMESTAMPTZ,
  otp_attempts INTEGER DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_retail_users_phone ON inari_retail_users(phone);
CREATE INDEX idx_retail_users_tenant ON inari_retail_users(tenant_id);
```

#### `inari_retail_orders` — 零售訂單主表

```sql
CREATE TABLE IF NOT EXISTS inari_retail_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT 'b15d5a02-764c-4353-ad40-07b901d9f321',
  order_no TEXT NOT NULL UNIQUE,
  retail_user_id UUID NOT NULL REFERENCES inari_retail_users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: 'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_fee NUMERIC(10,2) DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  -- payment_method: 'card', 'bank_transfer', 'cod'
  delivery_address JSONB,
  -- {"name": "...", "phone": "...", "address": "...", "district": "氹仔"}
  notes TEXT,
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_retail_orders_user ON inari_retail_orders(retail_user_id);
CREATE INDEX idx_retail_orders_status ON inari_retail_orders(status);
CREATE INDEX idx_retail_orders_tenant ON inari_retail_orders(tenant_id);
```

#### `inari_retail_order_items` — 零售訂單明細

```sql
CREATE TABLE IF NOT EXISTS inari_retail_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES inari_retail_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES inari_products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_retail_items_order ON inari_retail_order_items(order_id);
```

#### `inari_retail_cart` — 零售購物車（server-side 持久化，補充 localStorage）

```sql
CREATE TABLE IF NOT EXISTS inari_retail_cart (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT 'b15d5a02-764c-4353-ad40-07b901d9f321',
  retail_user_id UUID NOT NULL REFERENCES inari_retail_users(id),
  product_id UUID REFERENCES inari_products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC(10,2),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_retail_cart_unique ON inari_retail_cart(retail_user_id, sku);
```

#### `inari_otp_log` — OTP 發送記錄（防重放、防暴力破解）

```sql
CREATE TABLE IF NOT EXISTS inari_otp_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  -- purpose: 'login', 'register', 'reset'
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_otp_log_phone ON inari_otp_log(phone, created_at);
```

---

## 5. API 端點總表

### 5.1 現有 API 端點（Phase 0）

| 方法 | 路徑 | 認證 | 說明 |
|------|------|------|------|
| POST | `/api/login` | 無 | 舊版單密碼登入（v1 token，待棄用）|
| POST | `/api/shop-login` | 無 | 帳號+密碼登入（v2 token，升級為 v3）|
| GET | `/api/products/catalog` | v2+ | 商品目錄分頁（is_active=true）|
| GET | `/api/products/search` | 無 | 商品搜尋（keyword+name 雙路徑）|
| GET | `/api/orders` | v2+ | 訂單列表（staff=全部，wholesale=自己）|
| POST | `/api/orders` | v2+ | 建立草稿訂單 |
| PATCH | `/api/orders/[id]/confirm` | v2+ | 確認草稿訂單 |
| GET | `/api/admin/orders` | staff/manager | 管理員訂單查詢 |
| PATCH | `/api/admin/orders/[id]` | staff/manager | 管理員更新訂單狀態 |
| POST | `/api/voice/parse` | v2+ | 語音/文字解析 → 商品匹配 |
| POST | `/api/cart/sync` | v2+ | 購物車同步（best-effort）|
| GET/POST/PUT/DELETE | `/api/knowledge` | 無（GET）/ 管理（寫） | 知識庫 CRUD |
| POST | `/api/chat` | 無 | AI 客服（CloudPipe → MiniMax fallback）|
| GET/DELETE | `/api/conversations` | 無 | 對話記錄（Vercel 為 stateless）|

### 5.2 Phase 1 新增 API 端點

| 方法 | 路徑 | 認證 | 說明 |
|------|------|------|------|
| POST | `/api/auth/login` | 無 | **新版統一登入**（取代 /api/shop-login），產生 v3 JWT HS256 |
| POST | `/api/auth/logout` | v3 | 清除 cookie |
| GET | `/api/auth/me` | v3 | 返回當前用戶資訊 |
| GET | `/api/seasonal` | 無 | 本月旬物日曆（從 inari_seasonal_calendar）|
| GET | `/api/seasonal/[month]` | 無 | 指定月份旬物 |
| GET | `/api/brand/content` | 無 | 品牌內容（篩選 is_published=true）|
| GET | `/api/admin/products` | manager | 商品管理列表（含未上架）|
| PATCH | `/api/admin/products/[id]` | manager | 更新商品（上架/下架/編輯）|
| GET | `/api/admin/customers` | manager/staff | 客戶列表 |
| GET | `/api/admin/analytics/rfm` | manager | RFM 客戶分層報表 |
| GET | `/api/admin/analytics/summary` | manager | 銷售摘要（qb_sales READ ONLY）|
| GET | `/api/wholesale/account` | wholesale/manager | 批發客戶帳戶資訊 |
| GET | `/api/wholesale/statement` | wholesale/manager | 批發客戶對帳單 |

### 5.3 Phase 2 新增 API 端點

| 方法 | 路徑 | 認證 | 說明 |
|------|------|------|------|
| POST | `/api/auth/retail/request-otp` | 無 | 發送 OTP 到手機 |
| POST | `/api/auth/retail/verify-otp` | 無 | 驗證 OTP，產生 retail JWT |
| POST | `/api/auth/retail/logout` | retail | 清除 retail cookie |
| GET | `/api/retail/products` | 無（已列商品） | 零售商品目錄（is_retail_listed=true）|
| GET | `/api/retail/cart` | retail | 取得購物車 |
| POST | `/api/retail/cart` | retail | 新增/更新購物車項目 |
| DELETE | `/api/retail/cart/[sku]` | retail | 刪除購物車項目 |
| GET | `/api/retail/orders` | retail | 零售訂單列表 |
| POST | `/api/retail/orders` | retail | 建立零售訂單 |
| GET | `/api/retail/orders/[id]` | retail | 零售訂單詳情 |
| PATCH | `/api/retail/profile` | retail | 更新個人資料 |
| GET | `/api/admin/retail/orders` | manager/staff | 管理員查看零售訂單 |

---

## 6. RLS 矩陣

說明：
- `R` = SELECT
- `W` = INSERT + UPDATE + DELETE
- `R*` = SELECT（有條件，如只能看自己的資料）
- `X` = 無權限
- `service_role` = 繞過 RLS（由 Serverless Functions 直接使用）

所有 Serverless Functions 使用 `SUPABASE_SERVICE_KEY`（service_role），因此以下矩陣反映的是**直接資料庫存取（如未來 PostgREST direct）**及 **RLS policy 邏輯意圖**（後端 service key 可繞過，但需在代碼層自行實施等效過濾）。

| 表名 | anon | staff | manager | wholesale | retail |
|------|------|-------|---------|-----------|--------|
| `inari_users` | X | R*（自己）| R+W（全部）| R*（自己）| X |
| `inari_products` | R（is_active=true）| R（全部）| R+W（全部）| R（is_active=true）| R（is_retail_listed=true）|
| `inari_customers` | X | R | R+W | R*（自己）| X |
| `inari_suppliers` | X | R | R+W | X | X |
| `inari_customer_orders` | X | R+W（全部）| R+W（全部）| R*+W*（自己 customer_code）| X |
| `inari_customer_order_items` | X | R+W（全部）| R+W（全部）| R*（自己訂單）| X |
| `qb_sales` | X | R（全部）| R（全部）| X | X |
| `inari_knowledge_items` | R | R+W | R+W | R | R |
| `product_knowledge` | R | R+W | R+W | R | R |
| `region_knowledge` | R | R | R+W | R | R |
| `inari_product_keywords` | X | R | R+W | X | X |
| `inari_cart` | X | R*+W*（自己 session）| R+W（全部）| R*+W*（自己）| X |
| `inari_brand_content` | R（is_published）| R | R+W | R | R |
| `inari_seasonal_calendar` | R | R | R+W | R | R |
| `inari_retail_users` | X | X | R+W | X | R*+W*（自己 id）|
| `inari_retail_orders` | X | R | R+W | X | R*（自己 retail_user_id）|
| `inari_retail_order_items` | X | R | R+W | X | R*（自己訂單）|
| `inari_retail_cart` | X | X | R+W | X | R*+W*（自己）|
| `inari_otp_log` | X | X | R | X | X |

> 注意：`qb_sales` **絕對禁止 INSERT/UPDATE/DELETE**。任何 API 端點都不得包含對此表的寫入操作。RLS 需明確設定僅允許 SELECT。

---

## 7. JWT 認證設計

### 7.1 Token 結構（v3，Phase 1 升級後）

**Cookie 名稱：** `inari_auth_v3`（批發/staff/manager）、`inari_retail_v1`（零售 Phase 2）

**JWT Header:**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**JWT Payload v3（批發/Staff/Manager）:**
```json
{
  "iss": "inari-global",
  "sub": "<user_uuid>",
  "exp": 1234567890,
  "iat": 1234567890,
  "user_type": "staff | manager | wholesale",
  "customer_code": "SJZ | null",
  "tenant_id": "b15d5a02-764c-4353-ad40-07b901d9f321",
  "username": "alice",
  "v": 3
}
```

**JWT Payload v1（零售，Phase 2）:**
```json
{
  "iss": "inari-retail",
  "sub": "<retail_user_uuid>",
  "exp": 1234567890,
  "iat": 1234567890,
  "user_type": "retail",
  "phone": "+853xxxxxxxx",
  "tenant_id": "b15d5a02-764c-4353-ad40-07b901d9f321",
  "v": 1
}
```

**簽名密鑰：** `JWT_SECRET` 環境變數（Vercel env var，≥ 32 bytes 隨機字串）

**實作：** 使用 Web Crypto API（`crypto.subtle.sign` + `crypto.subtle.verify`），零 npm 依賴。

```typescript
// 核心函數簽名（middleware.ts 使用）
async function signJWT(payload: object, secret: string): Promise<string>
async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null>
```

### 7.2 登入流程

#### 批發/Staff/Manager 登入（POST /api/auth/login）
```
1. 前端 POST { username, password }
2. 後端查 inari_users WHERE username=? AND is_active=true
3. 驗證 SHA-256 密碼（$sha256$<hex> 格式）
4. 建立 JWT payload v3，用 JWT_SECRET 簽名（HS256）
5. Set-Cookie: inari_auth_v3=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
6. 回傳 { ok: true, user_type, username, customer_code }
7. 前端按 user_type 重定向：
   - manager/staff → /shop/
   - wholesale → /wholesale/
```

#### 零售客戶登入（Phase 2，POST /api/auth/retail/request-otp）
```
1. 前端 POST { phone }（格式驗證：+853 開頭）
2. 後端生成 6 位 OTP，過期 5 分鐘
3. 寫入 inari_retail_users.otp_code + otp_expires_at（or upsert 新用戶）
4. 呼叫 SMS 服務（待決定：Twilio / 澳門電信 API）
5. 記錄 inari_otp_log

POST /api/auth/retail/verify-otp { phone, otp }：
1. 查 inari_retail_users WHERE phone=? AND otp_code=? AND otp_expires_at > now()
2. 驗證 otp_attempts < 5（防暴力破解）
3. 清除 otp_code，更新 last_login_at
4. 建立 retail JWT v1，簽名
5. Set-Cookie: inari_retail_v1=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000
```

### 7.3 Middleware 邏輯（完整重寫）

```typescript
// middleware.ts 核心邏輯（Phase 1 版本）

const PUBLIC_PATHS = [
  '/', '/brand', '/login', '/shop/login',
  '/faq', '/blog', '/market', '/salmon', '/sea-urchin', '/knowledge',
  '/api/auth/login', '/api/auth/logout',
  '/api/chat', '/api/knowledge', '/api/seasonal', '/api/brand',
  '/api/products/search',  // 搜尋是 public
];

// Protected 路由對應所需 user_type
const ROUTE_GUARDS = {
  '/admin':     ['manager'],
  '/wholesale': ['wholesale', 'manager'],
  '/account':   ['wholesale', 'manager'],
  '/shop/admin':['staff', 'manager'],
  '/shop':      ['staff', 'manager', 'wholesale'],
  '/retail':    ['retail'],  // Phase 2
};

// 流程：
// 1. 如果路徑在 PUBLIC_PATHS → 直接 next()
// 2. 嘗試讀取 inari_auth_v3 cookie → verifyJWT → 成功則注入 locals
// 3. 嘗試讀取 inari_retail_v1 cookie（Phase 2）
// 4. 確認 user_type 是否符合 ROUTE_GUARDS
// 5. 不符合 → 重定向到對應登入頁
// 6. 舊 v1/v2 cookie 在過渡期內同時支援（6個月後棄用）
```

### 7.4 安全考慮

| 項目 | 現狀 | Phase 1 目標 |
|------|------|-------------|
| Cookie 簽名 | 無簽名 base64（v1/v2）| HS256 HMAC 簽名（v3）|
| HttpOnly Cookie | v1: ✓, v2: ✗（缺少）| v3: ✓ 強制 HttpOnly |
| 密碼雜湊 | SHA-256（可接受，非 bcrypt）| 不變（遷移成本高）|
| CORS | `*`（寬鬆）| **低優先度**：前端與 API 同屬 Vercel 同一 deployment（同 origin），瀏覽器不觸發 CORS；`*` 在此架構下風險極低，不需優先處理 |
| Token 到期 | 7天 | 批發7天，管理員8小時，零售30天 |
| qb_sales 保護 | 代碼層不寫入 | RLS 層 policy 確保只有 SELECT |
| JWT_SECRET 輪換 | 無 | 設計 `/api/auth/rotate-secret`（manager only）|

---

## 8. 商品知識庫整合方案

### 8.1 品牌主頁展示知識庫內容

知識庫資料來源（已存在）：
- `inari_knowledge_items`：36筆，6個域（銷售/AR/市場/日料/會計/行為經濟）
- `product_knowledge`：44筆，22品類
- `region_knowledge`：8筆，各地區含 `seasonal_calendar` JSONB
- `inari_seasonal_calendar`（Phase 1 新建）：補充旬物月份資訊

**品牌主頁整合方式：**

1. **季節旬物橫幅** (`/api/seasonal?month=<current>`)
   - 頁面載入時根據當月查詢 `inari_seasonal_calendar`
   - 顯示「本月旬物」卡片（商品名 + 產地 + 品質描述）
   - 靜態生成（Astro SSG）每週一更新一次

2. **知識庫索引** (`/knowledge/`)
   - 從 `product_knowledge` 取 22 品類，展示品類卡片
   - 每個品類連結到對應的靜態 MD 頁面（已存在於 /salmon/* /sea-urchin/*）
   - 新增 `/knowledge/seafood`（海鮮總覽），從 `region_knowledge` 取地區資料

3. **產地知識** (`/knowledge/regions`)
   - 從 `region_knowledge` 取 8 筆，展示地圖式卡片
   - 各地區顯示：代表水產、季節日曆、旬季說明

### 8.2 語音下單 → 知識庫 → 銷售話術

現有流程（`/api/voice/parse`）已完成：
- 文字輸入 → MiniMax AI 解析 → 商品匹配（keyword + fuzzy）→ 客戶歷史

**Phase 1 加強：知識庫注入話術**

```
語音下單時，在 matchProducts() 結果中附帶知識庫資訊：
1. 對每個匹配商品，查 product_knowledge WHERE sku = matched_sku
2. 提取「品質重點」「季節性」「銷售話術」
3. 在回應中新增 knowledge_tip 欄位
4. 前端在商品卡片下方顯示「本品知識：...」
```

**回應格式增強（/api/voice/parse v2）：**
```json
{
  "items": [
    {
      "product_code": "A1B001",
      "product_name": "北海道馬糞海膽",
      "qty": 2,
      "knowledge_tip": "5月品質最佳，產自北海道根室，甜度高於普通海膽30%",
      "seasonal_status": "peak",
      "season_badge": "旬物 · 5月最佳"
    }
  ]
}
```

### 8.3 Seasonal API 設計

#### `GET /api/seasonal` — 本月旬物

**Request:**
```
GET /api/seasonal
GET /api/seasonal?month=5
GET /api/seasonal?category=sea-urchin
```

**Response:**
```json
{
  "month": 5,
  "peak_items": [
    {
      "sku": "A1B001",
      "product_name": "北海道馬糞海膽",
      "season_notes_zh": "5月甜度最高，蝦夷馬糞海膽旬期",
      "origin": "北海道",
      "quality_peak_description": "...",
      "category": "sea-urchin"
    }
  ],
  "region_highlights": [
    {
      "region": "北海道",
      "month_note": "5月進入帆立貝 + 海膽雙旬期",
      "signature_seafood": ["馬糞海膽", "帆立貝"]
    }
  ],
  "generated_at": "2026-05-20T00:00:00Z"
}
```

**實作注意：** 此 API 為 public，無需認證。結果可在 CDN Edge 快取（Cache-Control: max-age=3600）。

---

## 9. Phase 1 執行計劃

### 9.1 任務清單（優先順序排列）

| 任務編號 | 任務名稱 | 優先級 | 依賴 | 預估複雜度 | 說明 |
|---------|---------|--------|------|-----------|------|
| **T01** | JWT 升級（v3 HS256）| P0 | 無 | 中（2-3天）| 安全核心，必須最先做 |
| **T02** | middleware.ts 重寫 | P0 | T01 | 中（1天）| 換 verifyJWT，改 ROUTE_GUARDS |
| **T03** | /api/auth/login 新端點 | P0 | T01 | 小（0.5天）| 取代 /api/shop-login |
| **T08** | qb_sales RLS policy | P0 | 無 | 小（0.5天）| 安全修補，單獨 SQL migration |
| **T04** | 品牌主頁重設計（/brand）| P1 | 無 | 中（2天）| 繁中版品牌頁，獨立於現有英文版 |
| **T05** | 知識庫頁面（/knowledge/*）| P1 | 無 | 中（2天）| 索引頁 + 3個子頁 |
| **T06** | Seasonal API + 旬物日曆 | P1 | DB 新增表 | 中（1.5天）| inari_seasonal_calendar 建表 + API |
| **T07** | Admin 後台統一（/admin/*）| P1 | T02 | 大（3天）| 4個子頁：dashboard/products/orders/knowledge |
| **T09** | 批發入口頁（/wholesale/）| P2 | T02 | 小（1天）| 簡單入口頁，按 user_type 分流 |
| **T10** | 帳戶頁（/account）| P2 | T02 | 中（2天）| 訂單歷史 + 帳戶資訊 |
| **T11** | 路由重定向邏輯 | P2 | T02 | 小（0.5天）| middleware 加 user_type 分流 |
| **T12** | ops-monitor LaunchAgent 升級 | P3 | T01 | 小（0.5天）| 加 JWT 有效性監控 |
| **T13** | 商品目錄共用組件 | P3 | 無 | 中（2天）| 提取共用 ProductCard / CatalogList |

### 9.2 依賴關係圖

```
T01 (JWT) ──┬── T02 (middleware) ──┬── T07 (admin)
             │                      ├── T09 (wholesale)
             │                      ├── T10 (account)
             │                      └── T11 (redirect)
             └── T03 (auth API)

T08 (RLS) ── 無依賴（可並行）

T04 (brand) ── 無依賴（可並行）
T05 (knowledge) ── 無依賴（可並行）
T06 (seasonal) ── DB migration（可並行）
T13 (components) ── 無依賴（可並行，後期整合）
```

### 9.3 複雜度評估

| 複雜度 | 標準 | 任務 |
|--------|------|------|
| 小 | < 1天，單一文件 | T03, T08, T09, T11, T12 |
| 中 | 1-3天，多文件協調 | T01, T02, T05, T06, T10, T13 |
| 大 | 3天+，跨系統變更 | T04, T07 |

### 9.4 建議執行週期

**Week 1（安全修補）：** T01 + T02 + T03 + T08
- 結果：JWT 安全漏洞修復，系統繼續運作

**Week 2（品牌/知識）：** T04 + T05 + T06（DB migration 並行）
- 結果：品牌主頁上線，知識庫可訪問

**Week 3（管理後台）：** T07 + T09 + T11
- 結果：Admin 後台統一，批發入口就緒

**Week 4（收尾）：** T10 + T12 + T13
- 結果：帳戶頁完整，監控升級，組件整理

---

## 10. Phase 2 執行計劃

### 10.1 零售系統設計摘要

**核心功能：**
1. 手機 OTP 註冊/登入（inari_retail_users）
2. 商品瀏覽（is_retail_listed=true 商品子集）
3. 購物車（localStorage + server sync）
4. 結帳下單（inari_retail_orders）
5. 訂單追蹤

**技術決策：**
- OTP SMS 服務：待選（Twilio 或澳門電信）
- 支付：Phase 2.1 先做 COD + 銀行轉帳；刷卡留 Phase 2.2
- 零售價格：`inari_products.retail_price` 欄位，獨立於批發 `sales_price`
- 商品圖片：連結現有商品圖像 DB（`~/.openclaw/workspace/image-db/`，720件，93% 已有圖）

**前端設計方向：**
- 移動優先（Mobile First），與批發商城（/shop/*）共用設計系統
- 獨立 CSS 入口點（/retail/styles.css）但繼承相同 CSS 變數（oklch 色票）
- 商品探索：按品類瀏覽 + 搜尋 + 季節推薦

**Phase 2 任務清單（概略）：**

| 任務 | 說明 | 依賴 |
|------|------|------|
| R01 | inari_retail_users DDL + RLS | Phase 1 完成 |
| R02 | OTP API（request + verify）| R01 |
| R03 | 零售商城前端（/retail/*）| R02 |
| R04 | 零售商品 API（retail price + listing）| Phase 1 DB 欄位 |
| R05 | 購物車前端 + sync API | R03 |
| R06 | 結帳流程 + 零售訂單 API | R05 |
| R07 | 管理員零售訂單管理 | Phase 1 Admin |
| R08 | 商品推薦（旬物 + 熱銷）| R04 + T06 |

---

## 11. 代碼複用決策

### 11.1 頁面文件

| 文件路徑 | 決策 | 原因 |
|---------|------|------|
| `src/pages/index.astro` | **直接複用** | 英文品牌頁保持不動；新增 `/brand` 作中文版 |
| `src/pages/login.astro` | **需修改** | 加 v3 JWT 提示；過渡期同時支援 v1 cookie |
| `src/pages/shop/login.astro` | **需修改** | 改呼叫 `/api/auth/login`；加登入後路由分流邏輯 |
| `src/pages/shop/index.astro` | **直接複用** | 功能完整；僅 CSS 細節調整 |
| `src/pages/shop/catalog.astro` | **直接複用** | 已有分頁 + 篩選；抽組件後可共用 |
| `src/pages/shop/order/new.astro` | **直接複用** | 語音下單完整；加 knowledge_tip 顯示 |
| `src/pages/shop/orders.astro` | **需修改** | wholesale 只顯示自己的訂單（middleware 已有，前端 UI 確認）|
| `src/pages/shop/admin/orders.astro` | **需修改** | 保留，但加入 `/admin/orders` 作更完整版本 |
| `src/pages/admin.astro` | **需重建** | 功能薄弱（只有 D1 知識庫）；重建為 `/admin/knowledge` |
| `src/pages/faq/index.astro` | **直接複用** | 靜態內容 |
| `src/pages/market/*.astro` | **直接複用** | 靜態內容，已整理好 |
| `src/pages/salmon/*.astro` | **直接複用** | 靜態內容 |
| `src/pages/sea-urchin/*.astro` | **直接複用** | 靜態內容 |
| `src/pages/blog/*.astro` | **直接複用** | 靜態內容 |

### 11.2 API 文件

| 文件路徑 | 決策 | 原因 |
|---------|------|------|
| `src/pages/api/login.ts` | **需修改** | 過渡期保留，但加 deprecation 警告；6個月後棄用 |
| `src/pages/api/shop-login.ts` | **需重建** | 改為 `/api/auth/login`，加 JWT HS256 簽名 |
| `src/pages/api/products/catalog.ts` | **直接複用** | 邏輯完整；僅加 `is_retail_listed` 過濾（Phase 2）|
| `src/pages/api/products/search.ts` | **直接複用** | 搜尋邏輯完整 |
| `src/pages/api/orders/index.ts` | **直接複用** | tenant_id + 用戶過濾已正確 |
| `src/pages/api/orders/[id]/confirm.ts` | **需修改** | 修正 `userType === 'b2b'` 應改為 `'wholesale'`（現有 bug）|
| `src/pages/api/admin/orders/index.ts` | **直接複用** | 邏輯正確 |
| `src/pages/api/admin/orders/[id].ts` | **直接複用** | 邏輯正確 |
| `src/pages/api/voice/parse.ts` | **需修改** | 加 knowledge_tip 注入（查 product_knowledge）|
| `src/pages/api/cart/sync.ts` | **直接複用** | best-effort 設計正確 |
| `src/pages/api/knowledge.ts` | **直接複用** | Supabase 已移植完成 |
| `src/pages/api/chat.ts` | **直接複用** | CloudPipe + MiniMax fallback 邏輯正確 |
| `src/pages/api/conversations.ts` | **直接複用** | stateless 設計合理，保持 |

### 11.3 核心基礎設施文件

| 文件路徑 | 決策 | 原因 |
|---------|------|------|
| `src/middleware.ts` | **需重建** | 核心安全漏洞（無簽名 base64）；重寫引入 verifyJWT |
| `src/layouts/Layout.astro` | **需修改** | 加 user context 傳遞（user_type, username）|
| `src/components/ChatWidget.astro` | **直接複用** | AI 聊天組件完整 |
| `src/components/Welcome.astro` | **直接複用** | 歡迎組件 |
| `public/shop/styles.css` | **直接複用** | 1037 行設計系統完整（oklch 色票 + 組件）|
| `astro.config.mjs` | **需修改** | 確認 Vercel adapter output 設定正確 |
| `vercel.json` | **直接複用** | `{"framework": "astro"}` 最簡設定即可 |

### 11.4 已知 Bug 清單（需在 Phase 1 修復）

| Bug | 位置 | 說明 |
|-----|------|------|
| `userType === 'b2b'` | `orders/[id]/confirm.ts` L64 | 應改為 `'wholesale'`（現有 user_type 值）|
| v2 cookie 缺 HttpOnly | `shop-login.ts` L121 | Set-Cookie 未加 `HttpOnly`，需加入 |
| CORS `*` 過寬 | 所有 API | 需收緊至 `https://*.inari.pages.dev` |
| 舊版 `/api/login` 仍接受單密碼 | `login.ts` | 過渡期保留但需加速棄用計劃 |
| `/api/products/search` 無認證 | `search.ts` | 設計上為 public，確認是否合適 |

---

## 附錄：環境變數清單

### 現有（Vercel 已設定）

| 變數名 | 用途 | 說明 |
|--------|------|------|
| `SUPABASE_SERVICE_KEY` | Supabase service role key | 必須；繞過 RLS |
| `SUPABASE_ANON_KEY` | Supabase anon key | fallback；受 RLS 限制 |
| `MINIMAX_API_KEY` | MiniMax M2.5 API | 語音解析 + AI chat |
| `SITE_PASSWORD` | v1 legacy 密碼 | 過渡期保留；Phase 1 後廢棄 |
| `CLOUDPIPE_URL` | CloudPipe tunnel URL | Chat Mode 1 |

### Phase 1 新增

| 變數名 | 用途 | 說明 |
|--------|------|------|
| `JWT_SECRET` | JWT HS256 簽名密鑰 | ≥ 32 bytes 隨機字串；不可洩露 |

### Phase 2 新增

| 變數名 | 用途 | 說明 |
|--------|------|------|
| `SMS_API_KEY` | OTP SMS 發送 | 待選服務商（Twilio 等）|
| `SMS_FROM_NUMBER` | 發件號碼 | 依服務商設定 |
