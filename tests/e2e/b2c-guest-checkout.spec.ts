import { expect, test } from '@playwright/test';

// Prerequisite: run scripts/uat_test_fixture_seed.sql before running this test.
test('guest can place an order and look it up afterwards', async ({ page }) => {
  const guestPhone = '66123456';

  await page.goto('/order');

  const firstProduct = page.locator('.product-card[data-sku]').first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.locator('button.add[aria-label="加入購物車"]').click();

  await page.locator('#cart-btn').click();
  const cartDrawer = page.locator('#cart-drawer');
  await expect(cartDrawer).toHaveClass(/open/);
  await cartDrawer.locator('#drawer-ft button', { hasText: '前往結帳' }).click();
  await expect(page).toHaveURL(/\/order\/checkout$/);

  await page.locator('#guest_name').fill('Playwright 測試客戶');
  await page.locator('#guest_phone').fill(guestPhone);
  await page.locator('#guest_address').fill('澳門測試街 1 號測試大廈 2 樓');
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.locator('#delivery_date').fill(tomorrow);
  await page.locator('#pay-現金').click();
  // force:true — astro dev toolbar(<astro-dev-toolbar>,dev-only overlay,唔存在於production build)
  // 有時會擋住bottom-fixed按鈕嘅pointer事件,唔屬於真實app bug。
  await page.locator('#confirm-btn').click({ force: true });

  await expect(page).toHaveURL(/\/order\/confirmed\?no=/);
  const orderNoPill = page.locator('#order-no-pill');
  await expect(orderNoPill).toBeVisible();
  await expect(orderNoPill).not.toHaveText('—');
  const orderNo = (await orderNoPill.textContent())?.trim();
  expect(orderNo).toBeTruthy();

  await page.goto('/order/confirmed');
  await expect(page.locator('#lookup-view')).toBeVisible();
  await page.locator('#lookup-no').fill(orderNo!);
  await page.locator('#lookup-phone').fill(guestPhone);
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.locator('#confirm-view')).toBeVisible();
  await expect(page.locator('#order-no-pill')).toHaveText(orderNo!);
});
