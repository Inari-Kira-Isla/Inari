# REVIEW.md — 稻荷商城 (INARI) Code Review
**版本** v1.0 (2026-05-25)

## 嚴重度
| 等級 | 定義 | Gate |
|------|------|:-:|
| Critical | 影響商城前台/支付/訂單 | 🔴 |
| Important | 影響 admin UI | 🟡 |
| Nit | 限 5 條 | 🟢 |
| Pre-existing | 不擋 | ⚪ |

## 必查
- **inari_users.web_password** 必 SHA-256
- **inari_users.role** ('manager','staff','customer') 必驗
- **CF env vars** 必透過 wrangler set (不可硬編碼)
- **`/admin/*` 路徑** 必驗 staff/manager role
- 客戶可見資料必經 RLS (anon key + RLS policy)

## 商業規則
參考 `inari_business_rules` 表 BR-001~009

## 跳過路徑
- node_modules/, .next/, dist/
- *.bak, generated/

## /code-review 流程同稻荷 web REVIEW.md
