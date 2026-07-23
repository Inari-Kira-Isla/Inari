import { expect, test } from '@playwright/test';

test('manager login persists while loading the B2B orders page', async ({ page }) => {
  await page.goto('/shop/login');
  await page.locator('#username').fill('test');
  await page.locator('#password').fill('InariTest2026Qr');
  await page.locator('#submit-btn').click();

  await expect(page).toHaveURL(/\/admin\/?$/);

  const ordersResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/orders') &&
      response.request().method() === 'GET',
  );
  await page.goto('/shop/orders');

  await expect(page).toHaveURL(/\/shop\/orders$/);
  const ordersList = page.locator('#orders-list');
  await expect(ordersList).toBeVisible();

  const ordersResponse = await ordersResponsePromise;
  expect(ordersResponse.ok()).toBe(true);
});
