// cart.js — localStorage-first cart with Supabase sync
// Exports: addToCart, removeFromCart, updateQty, getCart, clearCart,
//          getCartCount, getCartTotal, openCartPanel, closeCartPanel, initCart

const CART_KEY = "inari_cart";
const SYNC_DEBOUNCE_MS = 2000;
let _syncTimer = null;

function genSessionId() {
  return "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return { session_id: genSessionId(), items: [], updated_at: new Date().toISOString() };
    return JSON.parse(raw);
  } catch {
    return { session_id: genSessionId(), items: [], updated_at: new Date().toISOString() };
  }
}

function saveCart(cart) {
  cart.updated_at = new Date().toISOString();
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCartPanel();
  updateCartBadge();
}

export function addToCart(item) {
  const cart = getCart();
  const existing = cart.items.find((i) => i.sku === item.sku);
  if (existing) {
    existing.qty += item.qty || 1;
    existing.line_total = existing.qty * existing.unit_price;
  } else {
    cart.items.push({
      sku: item.sku,
      product_id: item.product_id || null,
      product_name: item.product_name,
      qty: item.qty || 1,
      unit: item.unit || "件",
      unit_price: item.unit_price || 0,
      line_total: (item.qty || 1) * (item.unit_price || 0),
      added_at: new Date().toISOString(),
    });
  }
  saveCart(cart);
  scheduleSyncToServer(cart);
}

export function removeFromCart(sku) {
  const cart = getCart();
  cart.items = cart.items.filter((i) => i.sku !== sku);
  saveCart(cart);
  scheduleSyncToServer(cart);
}

export function updateQty(sku, qty) {
  if (qty <= 0) { removeFromCart(sku); return; }
  const cart = getCart();
  const item = cart.items.find((i) => i.sku === sku);
  if (item) {
    item.qty = qty;
    item.line_total = qty * item.unit_price;
  }
  saveCart(cart);
  scheduleSyncToServer(cart);
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
  renderCartPanel();
  updateCartBadge();
}

export function getCartCount() {
  const cart = getCart();
  return cart.items.reduce((s, i) => s + i.qty, 0);
}

export function getCartTotal() {
  const cart = getCart();
  return cart.items.reduce((s, i) => s + (i.line_total || 0), 0);
}

function fmt(n) {
  return "MOP " + Number(n).toLocaleString("zh-HK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function scheduleSyncToServer(cart) {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => syncToServer(cart), SYNC_DEBOUNCE_MS);
}

async function syncToServer(cart) {
  try {
    await fetch("/api/cart/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: cart.session_id, items: cart.items }),
    });
  } catch {
    // silent fail — localStorage is source of truth
  }
}

export function openCartPanel() {
  document.getElementById("cart-panel")?.classList.add("open");
}

export function closeCartPanel() {
  document.getElementById("cart-panel")?.classList.remove("open");
}

function updateCartBadge() {
  const count = getCartCount();
  document.querySelectorAll(".cart-badge").forEach((el) => {
    el.textContent = count > 0 ? count : "";
    el.style.display = count > 0 ? "flex" : "none";
  });
}

function renderCartPanel() {
  const list = document.getElementById("cart-items-list");
  const totalEl = document.getElementById("cart-total-display");
  if (!list) return;

  const cart = getCart();
  const total = getCartTotal();
  if (totalEl) totalEl.textContent = fmt(total);

  if (!cart.items.length) {
    list.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:40px 0">購物車是空的</p>';
    return;
  }

  list.innerHTML = cart.items.map((item) => `
    <div class="cart-item">
      <div>
        <div style="font-size:13px;font-weight:600;color:#1f2937">${item.product_name}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px">${fmt(item.unit_price)} / ${item.unit}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button onclick="import('/js/cart.js').then(m=>m.updateQty('${item.sku}',${item.qty - 1}))" 
          style="width:24px;height:24px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer">−</button>
        <span style="min-width:28px;text-align:center;font-size:13px">${item.qty}</span>
        <button onclick="import('/js/cart.js').then(m=>m.updateQty('${item.sku}',${item.qty + 1}))"
          style="width:24px;height:24px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer">+</button>
        <button onclick="import('/js/cart.js').then(m=>m.removeFromCart('${item.sku}'))"
          style="width:24px;height:24px;border:none;background:none;cursor:pointer;color:#ef4444;font-size:16px">×</button>
      </div>
    </div>
  `).join("");
}

function injectCartPanel() {
  if (document.getElementById("cart-panel")) return;

  const panel = document.createElement("div");
  panel.id = "cart-panel";
  panel.className = "cart-panel";
  panel.innerHTML = `
    <div class="cart-overlay" onclick="closeCartPanel()"></div>
    <div class="cart-drawer">
      <div class="cart-header">
        <h3 style="font-size:18px;font-weight:700;color:#1f2937">購物車</h3>
        <button onclick="closeCartPanel()" style="background:none;border:none;cursor:pointer;font-size:24px;color:#9ca3af;line-height:1">✕</button>
      </div>
      <div id="cart-items-list" class="cart-items-list"></div>
      <div class="cart-footer">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:15px;color:#374151">合計</span>
          <strong id="cart-total-display" style="font-size:20px;color:#c0392b">MOP 0</strong>
        </div>
        <a href="/shop/checkout" class="btn-checkout">前往結帳 →</a>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const style = document.createElement("style");
  style.textContent = `
    .cart-panel{position:fixed;inset:0;z-index:9999;pointer-events:none}
    .cart-panel.open{pointer-events:all}
    .cart-overlay{position:absolute;inset:0;background:rgba(0,0,0,0.5);opacity:0;transition:opacity .3s}
    .cart-panel.open .cart-overlay{opacity:1}
    .cart-drawer{position:absolute;right:0;top:0;bottom:0;width:min(400px,100vw);background:#fff;transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.15)}
    .cart-panel.open .cart-drawer{transform:translateX(0)}
    .cart-header{display:flex;justify-content:space-between;align-items:center;padding:20px;border-bottom:1px solid #e5e7eb}
    .cart-items-list{flex:1;overflow-y:auto;padding:16px}
    .cart-item{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f3f4f6}
    .cart-footer{padding:20px;border-top:1px solid #e5e7eb}
    .btn-checkout{display:block;text-align:center;background:#c0392b;color:#fff;padding:14px;border-radius:12px;font-weight:600;text-decoration:none;font-size:15px;transition:background .15s}
    .btn-checkout:hover{background:#a93226}
  `;
  document.head.appendChild(style);

  // Expose to window for non-module contexts
  window.closeCartPanel = closeCartPanel;
  window.openCartPanel = openCartPanel;
}

export function initCart() {
  injectCartPanel();
  renderCartPanel();
  updateCartBadge();
}
