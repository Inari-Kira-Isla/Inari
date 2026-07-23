const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

export type OrderType = 'b2b' | 'b2c';

export interface CreateOrderItem {
  productId?: unknown;
  productCode?: unknown;
  productName?: unknown;
  rawText?: unknown;
  qty: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  matchConfidence?: unknown;
}

interface GuestInfo {
  name: string;
  phone: string;
  deliveryAddress: string;
  paymentReceiptUrl?: string | null;
}

interface CreateOrderParams {
  serviceKey: string;
  orderType: OrderType;
  customerCode: string | null;
  customerName: string;
  items: CreateOrderItem[];
  orderDate?: unknown;
  source?: unknown;
  rawText?: unknown;
  paymentMethod?: unknown;
  deliveryDate?: unknown;
  notes?: unknown;
  guestInfo?: GuestInfo;
}

export type CreateOrderResult =
  | { ok: true; orderNo: string; orderId: string }
  | { ok: false; stage: 'header'; detail: string }
  | { ok: false; stage: 'items' };

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function generateOrderNo(orderType: OrderType, customerCode: string | null) {
  const datePart = todayStr().replace(/-/g, '');
  if (orderType === 'b2c') {
    const code = 'B2C' + Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${datePart}-${code}`;
  }

  const raw = (customerCode || 'STA').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const code =
    (raw.slice(0, 4) || 'STA') +
    Math.random().toString(36).slice(2, 4).toUpperCase();
  return `ORD-${datePart}-${code}`;
}

export async function createOrder(
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  const {
    serviceKey,
    orderType,
    customerCode,
    customerName,
    items,
    orderDate,
    source = 'web',
    rawText,
    paymentMethod,
    deliveryDate,
    notes,
    guestInfo,
  } = params;
  const orderNo = generateOrderNo(orderType, customerCode);
  const headers = sbHeaders(serviceKey);

  const orderPayload: Record<string, unknown> = {
    order_no: orderNo,
    customer_code: customerCode,
    customer_name: customerName,
    order_date: orderDate || todayStr(),
    source,
    status: 'draft',
    tenant_id: TENANT_ID,
    ...(orderType === 'b2c' ? { order_type: 'b2c' } : {}),
    ...(orderType === 'b2b' ? { raw_text: rawText || '' } : {}),
    ...(paymentMethod ? { payment_method: paymentMethod } : {}),
    ...(deliveryDate ? { delivery_date: deliveryDate } : {}),
    ...(notes ? { notes } : {}),
    ...(guestInfo
      ? {
          guest_name: guestInfo.name,
          guest_phone: guestInfo.phone,
          guest_delivery_address: guestInfo.deliveryAddress,
          ...(guestInfo.paymentReceiptUrl
            ? { payment_receipt_url: guestInfo.paymentReceiptUrl }
            : {}),
        }
      : {}),
  };

  const orderResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(orderPayload),
    },
  );

  if (!orderResp.ok) {
    return {
      ok: false,
      stage: 'header',
      detail: await orderResp.text(),
    };
  }

  const [newOrder] = await orderResp.json();
  const orderId = newOrder.id as string;
  const itemPayloads = items.map((item) => ({
    order_id: orderId,
    order_no: orderNo,
    product_id: item.productId || null,
    product_code: item.productCode || null,
    product_name: item.productName || null,
    ...(orderType === 'b2b' ? { raw_text: item.rawText || null } : {}),
    qty: item.qty || 0,
    unit: item.unit || null,
    unit_price: item.unitPrice ?? null,
    // amount 係 DB generated column，唔可以由 app insert。
    // B2C item 已由 catalog 精確識別；B2B 則保留 matching pipeline 結果。
    match_confidence:
      orderType === 'b2c'
        ? 'exact'
        : item.matchConfidence || 'unmatched',
    tenant_id: TENANT_ID,
  }));

  const itemsResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_order_items`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(itemPayloads),
    },
  );

  if (!itemsResp.ok) {
    const errText = await itemsResp.text();
    console.error(`${orderType.toUpperCase()} order items insert failed:`, errText);
    try {
      const deleteResp = await fetch(
        `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${orderId}`,
        { method: 'DELETE', headers },
      );
      if (!deleteResp.ok) {
        console.error(
          `${orderType.toUpperCase()} order header cleanup failed:`,
          await deleteResp.text(),
        );
      }
    } catch (deleteError) {
      console.error(
        `${orderType.toUpperCase()} order header cleanup failed:`,
        deleteError,
      );
    }
    return { ok: false, stage: 'items' };
  }

  return { ok: true, orderNo, orderId };
}
