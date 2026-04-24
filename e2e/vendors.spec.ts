import { test, expect } from '@playwright/test';

/**
 * Vendor queue — smoke test that navigating after login lands on the queue.
 *
 * Skipped unless the backend is up at :8080 because the queue hits
 * `GET /api/v1/admin/vendors`. Unskip locally when you have the stack running.
 */

test.describe('Vendor queue (needs backend)', () => {
  test.skip(
    !process.env.NEERLY_BACKEND_UP,
    'Requires local backend; set NEERLY_BACKEND_UP=1 to run'
  );

  test.beforeEach(async ({ page }) => {
    // Log in via the stubbed flow first
    await page.goto('/login');
    await page.getByPlaceholder('admin@neerly.in').fill('admin@neerly.in');
    await page.locator('input[type="password"]').fill('password');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await page.getByPlaceholder('6-digit code').fill('123456');
    await page.getByRole('button', { name: /Verify/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('can navigate to /vendors and see a filter row', async ({ page }) => {
    await page.getByRole('link', { name: 'Vendors' }).click();
    await expect(page).toHaveURL(/\/vendors/);
    await expect(page.getByRole('heading', { name: /verifications/i })).toBeVisible();

    // Filter chips present
    await expect(page.getByText(/Pending/i)).toBeVisible();
  });
});
