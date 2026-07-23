import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../src/pages/api/order/index';
import { POST as postB2BOrder } from '../src/pages/api/orders/index';

const validGuestOrder = {
  guest_name: '陳大文',
  guest_phone: '+853 6123 4567',
  guest_delivery_address: '澳門新口岸宋玉生廣場 100 號',
  payment_method: '現金',
  items: [
    {
      product_id: 'product-1',
      sku: 'SALMON-01',
      product_name: '三文魚',
      qty: 2,
      unit: '條',
      unit_price: 88,
    },
  ],
};

const validCatalogProduct = {
  id: 'product-1',
  sku: 'SALMON-01',
  name: '三文魚',
  unit: '條',
  sales_price: 88,
};

function postContext(body: unknown) {
  return {
    request: new Request('http://localhost/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as any;
}

function getContext(query = '') {
  return { url: new URL(`http://localhost/api/order${query}`) } as any;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('B2C guest order API', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ['guest_name', '請填寫收貨人姓名'],
    ['guest_phone', '請填寫有效聯絡電話'],
    ['guest_delivery_address', '請填寫送貨地址'],
  ])('POST 缺少 %s → 400 同清晰錯誤', async (field, expectedError) => {
    const body = { ...validGuestOrder, [field]: '' };
    const response = await POST(postContext(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: expectedError });
  });

  it('POST payment_method 不受支援 → 400', async () => {
    const response = await POST(
      postContext({ ...validGuestOrder, payment_method: '信用卡' }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '付款方式只支援「現金」或「銀行轉帳」',
    });
  });

  it('POST items 為空 array → 400', async () => {
    const response = await POST(postContext({ ...validGuestOrder, items: [] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '訂單明細不能為空',
    });
  });

  it('POST header 同 items 都建立成功 → 201 同有效 order_no', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([validCatalogProduct]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'order-success-1' }], 201))
      .mockResolvedValueOnce(jsonResponse([], 201));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(postContext(validGuestOrder));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result).toMatchObject({ ok: true, order_id: 'order-success-1' });
    expect(result.order_no).toMatch(/^ORD-\d{8}-B2C[A-Z0-9]{4}$/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/v_shop_catalog');
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/rest/v1/inari_customer_orders',
    );
    expect(fetchMock.mock.calls[2][0]).toContain(
      '/rest/v1/inari_customer_order_items',
    );
  });

  it('POST client 偽造低價 → 用 v_shop_catalog 權威價建立 items', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([validCatalogProduct]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'order-priced-1' }], 201))
      .mockResolvedValueOnce(jsonResponse([], 201));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      postContext({
        ...validGuestOrder,
        items: [
          {
            ...validGuestOrder.items[0],
            product_id: undefined,
            unit_price: 0.01,
            line_total: 0.02,
          },
        ],
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/v_shop_catalog');
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      'sku.eq."SALMON-01"',
    );

    const insertedItems = JSON.parse(
      String(fetchMock.mock.calls[2][1]?.body),
    );
    expect(insertedItems).toEqual([
      expect.objectContaining({
        product_id: 'product-1',
        product_code: 'SALMON-01',
        qty: 2,
        unit_price: 88,
        match_confidence: 'exact',
      }),
    ]);
    expect(insertedItems[0]).not.toHaveProperty('line_total');
    expect(insertedItems[0]).not.toHaveProperty('amount');
  });

  it('POST 商品唔喺權威 catalog → 400 且唔建立 order header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(postContext(validGuestOrder));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '訂單內有商品已下架或不存在',
    });
  });

  it('POST items insert 失敗 → DELETE header 補償並回 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([validCatalogProduct]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'orphan-header-1' }], 201))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(postContext(validGuestOrder));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toContain(
      '/rest/v1/inari_customer_orders?id=eq.orphan-header-1',
    );
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: 'DELETE' });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: '訂單明細建立失敗，請重新落單或聯絡客服',
    });
  });

  it.each([
    ['', '兩者都冇'],
    ['?order_no=ORD-20260723-B2CTEST', '冇 phone'],
    ['?phone=61234567', '冇 order_no'],
  ])('GET %s（%s）→ 400', async (query) => {
    const response = await GET(getContext(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '請提供訂單編號同電話',
    });
  });

  it('GET 查詢資料齊但 Supabase 回空 array → 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      getContext('?order_no=ORD-20260723-B2CTEST&phone=%2B85361234567'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: '搵唔到訂單,請核對訂單編號同落單電話',
    });
  });
});

describe('B2B order transaction safety', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('items insert 失敗 → DELETE header 補償並回 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 'b2b-orphan-header-1' }], 201))
      .mockResolvedValueOnce(new Response('items rejected', { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const context = {
      locals: { userType: 'wholesale', customerCode: 'CUST-001' },
      request: new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_code: 'P-1', product_name: '帶子', qty: 3 }],
        }),
      }),
    } as any;

    const response = await postB2BOrder(context);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const insertedItems = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    );
    expect(insertedItems[0]).toMatchObject({
      product_code: 'P-1',
      match_confidence: 'unmatched',
    });
    expect(insertedItems[0]).not.toHaveProperty('amount');
    expect(fetchMock.mock.calls[2][0]).toContain(
      '/rest/v1/inari_customer_orders?id=eq.b2b-orphan-header-1',
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: '訂單明細建立失敗，請重新落單或聯絡客服',
    });
  });
});
