// guest-cart.js — B2C 訪客購物車 (localStorage-only, 完全獨立於 B2B 嘅 cart.js/inari_cart，
// 避免同一部裝置曾經login過wholesale/staff時兩個購物車互相污染)
// Exports: addToCart, removeFromCart, updateQty, getCart, clearCart, getCartCount, getCartTotal

const CART_KEY = "inari_guest_cart";

export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return { items: [] };
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function addToCart(item) {
  const cart = getCart();
  if (!cart.items) cart.items = [];
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
    });
  }
  saveCart(cart);
  return cart;
}

export function updateQty(sku, qty) {
  const cart = getCart();
  const idx = (cart.items || []).findIndex((i) => i.sku === sku);
  if (idx < 0) return cart;
  if (qty <= 0) {
    cart.items.splice(idx, 1);
  } else {
    cart.items[idx].qty = qty;
    cart.items[idx].line_total = qty * cart.items[idx].unit_price;
  }
  saveCart(cart);
  return cart;
}

export function removeFromCart(sku) {
  const cart = getCart();
  cart.items = (cart.items || []).filter((i) => i.sku !== sku);
  saveCart(cart);
  return cart;
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

export function getCartCount() {
  return getCart().items.reduce((s, i) => s + (i.qty || 0), 0);
}

export function getCartTotal() {
  return getCart().items.reduce((s, i) => s + (i.line_total || i.qty * i.unit_price || 0), 0);
}
