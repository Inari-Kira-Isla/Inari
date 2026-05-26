#!/usr/bin/env bash
# Phase 2 Inventory v2 — E2E end-to-end test
# Runs against real prod Supabase using TEST- prefix SKU + cleanup trap.

set -uo pipefail

SUPABASE_URL="https://cqartwwsbxnjjatmndtt.supabase.co"
TENANT_ID="b15d5a02-764c-4353-ad40-07b901d9f321"
TEST_SKU="TEST-E2E-$(date +%s)"
USER_TAG="e2e-test"
KEY=""
PASS_COUNT=0
TOTAL_STEPS=15

color_pass() { printf "\033[32mPASS\033[0m"; }
color_fail() { printf "\033[31mFAIL\033[0m"; }

pass() { PASS_COUNT=$((PASS_COUNT+1)); echo "$(color_pass) [$1] $2"; }
fail() { echo "$(color_fail) [$1] $2"; echo "  → $3"; exit 1; }

cleanup() {
  echo "--- cleanup TEST data (SKU=${TEST_SKU}) ---"
  if [[ -z "${KEY}" ]]; then echo "  skipped (no key)"; return 0; fi
  curl -s -X DELETE \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
    "${SUPABASE_URL}/rest/v1/inari_inventory_movements?tenant_id=eq.${TENANT_ID}&created_by=eq.${USER_TAG}" >/dev/null
  curl -s -X DELETE \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
    "${SUPABASE_URL}/rest/v1/inari_inventory_lots?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}" >/dev/null
  curl -s -X DELETE \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
    "${SUPABASE_URL}/rest/v1/inari_products?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}" >/dev/null
  echo "  cleanup done"
}

# --- pre-flight ---
command -v jq >/dev/null || { echo "jq required"; exit 1; }
command -v curl >/dev/null || { echo "curl required"; exit 1; }

KEY=$(/opt/homebrew/bin/python3 /Users/kira/vault/vault.py get supabase_inari service_role_key 2>/dev/null)
[[ -n "${KEY}" && ! "${KEY}" =~ ^❌ ]] || { echo "vault service_role_key unavailable"; exit 1; }

trap cleanup EXIT
pass 1 "setup cleanup trap"
pass 2 "取 key (len=${#KEY})"

# helper: REST GET / DELETE / POST table
api() {
  local method="$1" path="$2"; shift 2
  curl -s -X "${method}" \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    "$@" "${SUPABASE_URL}${path}"
}

# helper: RPC call (POST /rest/v1/rpc/<name>)
rpc() {
  local name="$1" body="$2"
  curl -s -X POST \
    -H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${SUPABASE_URL}/rest/v1/rpc/${name}"
}

# 3. pre-clean (any stale TEST data) — silent best-effort
cleanup >/dev/null 2>&1
pass 3 "預清"

# 4. build TEST product
product_payload=$(jq -n --arg sku "${TEST_SKU}" --arg tenant_id "${TENANT_ID}" --arg name "E2E Test" \
  '{tenant_id:$tenant_id, sku:$sku, name:$name, on_hand:100, avg_cost:10}')
product_resp=$(api POST "/rest/v1/inari_products" -H "Prefer: return=representation" -d "${product_payload}")
product_id=$(echo "${product_resp}" | jq -r '.[0].id // empty')
[[ -n "${product_id}" ]] || fail 4 "build TEST product" "no id; resp=${product_resp:0:300}"
pass 4 "build TEST product (id=${product_id})"

# 5. verify inventory_v2_active=false
v2=$(api GET "/rest/v1/inari_products?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}&select=inventory_v2_active" | jq -r '.[0].inventory_v2_active')
[[ "${v2}" == "false" ]] || fail 5 "verify v2_active=false" "got: ${v2}"
pass 5 "verify v2_active=false"

# 6. inventory_init_from_product — should flip v2_active=true and create OPENING lot
init_body=$(jq -n --arg sku "${TEST_SKU}" --arg tenant "${TENANT_ID}" \
  '{p_tenant_id:$tenant, p_sku:$sku, p_user:"e2e-test"}')
init_resp=$(rpc "inventory_init_from_product" "${init_body}")
init_ok=$(echo "${init_resp}" | jq -r '.ok // false')
[[ "${init_ok}" == "true" ]] || fail 6 "init_from_product" "resp=${init_resp:0:300}"
v2=$(api GET "/rest/v1/inari_products?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}&select=inventory_v2_active" | jq -r '.[0].inventory_v2_active')
[[ "${v2}" == "true" ]] || fail 6 "init_from_product" "v2_active not flipped: ${v2}"
opening_lot_id=$(api GET "/rest/v1/inari_inventory_lots?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}&select=id,lot_no,qty_on_hand&order=id" | jq -r '.[0].id // empty')
[[ -n "${opening_lot_id}" ]] || fail 6 "init_from_product" "no OPENING lot"
pass 6 "init_from_product (opening_lot=${opening_lot_id})"

# 7. inventory_receive — add second lot LOT-A qty=50 cost=12
receive_body=$(jq -n --arg sku "${TEST_SKU}" --arg tenant "${TENANT_ID}" \
  '{p_tenant_id:$tenant, p_sku:$sku, p_lot_no:"LOT-A", p_qty:50, p_unit_cost_mop:12, p_user:"e2e-test"}')
receive_resp=$(rpc "inventory_receive" "${receive_body}")
receive_ok=$(echo "${receive_resp}" | jq -r '.ok // false')
[[ "${receive_ok}" == "true" ]] || fail 7 "inventory_receive" "resp=${receive_resp:0:300}"
lot_a_id=$(echo "${receive_resp}" | jq -r '.lot_id')
pass 7 "inventory_receive (LOT-A id=${lot_a_id})"

# 8. recalc_on_hand → expect 100+50=150
recalc_body=$(jq -n --arg sku "${TEST_SKU}" --arg tenant "${TENANT_ID}" \
  '{p_tenant_id:$tenant, p_sku:$sku}')
rpc "recalc_on_hand" "${recalc_body}" >/dev/null
on_hand=$(api GET "/rest/v1/inari_products?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}&select=on_hand" | jq -r '.[0].on_hand')
[[ $(echo "${on_hand} == 150" | bc -l) -eq 1 ]] || fail 8 "recalc_on_hand (post-receive)" "expected 150, got ${on_hand}"
pass 8 "recalc_on_hand → on_hand=150"

# 9. inventory_pick_fefo — pick 30 (FEFO: no expiry on either, so OPENING first by id)
pick_body=$(jq -n --arg sku "${TEST_SKU}" --arg tenant "${TENANT_ID}" \
  '{p_tenant_id:$tenant, p_sku:$sku, p_qty:30, p_user:"e2e-test"}')
pick_resp=$(rpc "inventory_pick_fefo" "${pick_body}")
pick_ok=$(echo "${pick_resp}" | jq -r '.ok // false')
[[ "${pick_ok}" == "true" ]] || fail 9 "inventory_pick_fefo" "resp=${pick_resp:0:300}"
pass 9 "inventory_pick_fefo (picked 30)"

# 10. verify lot quantities (OPENING=70, LOT-A=50)
opening_qty=$(api GET "/rest/v1/inari_inventory_lots?id=eq.${opening_lot_id}&select=qty_on_hand" | jq -r '.[0].qty_on_hand')
lot_a_qty=$(api GET "/rest/v1/inari_inventory_lots?id=eq.${lot_a_id}&select=qty_on_hand" | jq -r '.[0].qty_on_hand')
[[ $(echo "${opening_qty} == 70 && ${lot_a_qty} == 50" | bc -l) -eq 1 ]] || fail 10 "verify lot qty" "OPENING=${opening_qty}, LOT-A=${lot_a_qty}"
pass 10 "lot qty (OPENING=70, LOT-A=50)"

# 11. inventory_adjust LOT-A delta=-5 reason=damage
adjust_body=$(jq -n --arg tenant "${TENANT_ID}" --argjson lot "${lot_a_id}" \
  '{p_tenant_id:$tenant, p_lot_id:$lot, p_qty_delta:-5, p_reason:"damage", p_user:"e2e-test"}')
adjust_resp=$(rpc "inventory_adjust" "${adjust_body}")
adjust_ok=$(echo "${adjust_resp}" | jq -r '.ok // false')
[[ "${adjust_ok}" == "true" ]] || fail 11 "inventory_adjust" "resp=${adjust_resp:0:300}"
new_qty=$(echo "${adjust_resp}" | jq -r '.new_qty')
[[ $(echo "${new_qty} == 45" | bc -l) -eq 1 ]] || fail 11 "inventory_adjust" "expected new_qty=45, got ${new_qty}"
pass 11 "inventory_adjust LOT-A → 45"

# 12. inventory_count OPENING lot, qty_counted=68 (was 70) → delta=-2
count_body=$(jq -n --arg tenant "${TENANT_ID}" --argjson lot "${opening_lot_id}" \
  '{p_tenant_id:$tenant, p_lot_id:$lot, p_qty_counted:68, p_user:"e2e-test"}')
count_resp=$(rpc "inventory_count" "${count_body}")
count_ok=$(echo "${count_resp}" | jq -r '.ok // false')
delta=$(echo "${count_resp}" | jq -r '.delta')
[[ "${count_ok}" == "true" && $(echo "${delta} == -2" | bc -l) -eq 1 ]] || fail 12 "inventory_count" "resp=${count_resp:0:300}"
pass 12 "inventory_count OPENING → 68 (delta=-2)"

# 13. inventory_scrap LOT-A reason=damaged → qty=0 status=damaged
scrap_body=$(jq -n --arg tenant "${TENANT_ID}" --argjson lot "${lot_a_id}" \
  '{p_tenant_id:$tenant, p_lot_id:$lot, p_reason:"damaged", p_user:"e2e-test"}')
scrap_resp=$(rpc "inventory_scrap" "${scrap_body}")
scrap_ok=$(echo "${scrap_resp}" | jq -r '.ok // false')
new_status=$(echo "${scrap_resp}" | jq -r '.new_status')
[[ "${scrap_ok}" == "true" && "${new_status}" == "damaged" ]] || fail 13 "inventory_scrap" "resp=${scrap_resp:0:300}"
pass 13 "inventory_scrap LOT-A → damaged"

# 14. final recalc → OPENING=68, LOT-A=0 (status!=active) → on_hand=68
rpc "recalc_on_hand" "${recalc_body}" >/dev/null
on_hand=$(api GET "/rest/v1/inari_products?tenant_id=eq.${TENANT_ID}&sku=eq.${TEST_SKU}&select=on_hand" | jq -r '.[0].on_hand')
[[ $(echo "${on_hand} == 68" | bc -l) -eq 1 ]] || fail 14 "final recalc" "expected 68, got ${on_hand}"
pass 14 "final recalc → on_hand=68"

# 15. movement count (init=1+1[opening_movement]=actually 1, receive=1, pick=1, adjust=1, count=1, scrap=1 = 6)
movement_count=$(api GET "/rest/v1/inari_inventory_movements?tenant_id=eq.${TENANT_ID}&created_by=eq.${USER_TAG}&select=movement_type" | jq 'length')
# init creates one 'receive' (opening balance) by inventory_init_from_product
[[ "${movement_count}" -ge 6 ]] || fail 15 "movement count" "expected >=6, got ${movement_count}"
pass 15 "movement count = ${movement_count}"

echo ""
echo "=========================================="
echo "ALL PASSED (${PASS_COUNT}/${TOTAL_STEPS} steps)"
echo "TEST_SKU=${TEST_SKU}"
echo "=========================================="
