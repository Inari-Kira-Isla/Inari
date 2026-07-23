import { expect, test } from '@playwright/test';

test('catalog renders at least one non-empty product image without page errors', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/order');

  const productCards = page.locator('.product-card[data-sku]');
  await expect(productCards.first()).toBeVisible();

  const productImages = productCards.locator('img[src]:not([src=""])');
  await expect(productImages.first()).toBeVisible();
  expect(await productImages.count()).toBeGreaterThan(0);

  const imageBox = await productImages.first().boundingBox();
  expect(imageBox).not.toBeNull();
  expect(imageBox!.width).toBeGreaterThan(0);
  expect(imageBox!.height).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
});
