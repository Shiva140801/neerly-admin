import { test, expect } from '@playwright/test';

/**
 * Admin login flow — hits the stubbed login path (Session 1 state).
 * When Firebase is wired in Session 4 closeout, replace the credential submit
 * with a real Firebase test-user token, then remove the stub timeout.
 */

test.describe('Admin login', () => {
  test.beforeEach(async ({ page }) => {
    // Guard sends unauthenticated visits to /login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('full two-step flow lands on dashboard', async ({ page }) => {
    // Step 1: credentials
    await expect(page.getByRole('heading', { name: /Admin/ })).toBeVisible();
    await page.getByPlaceholder('admin@neerly.in').fill('admin@neerly.in');
    await page.locator('input[type="password"]').fill('correct-horse-battery-staple');

    await page.getByRole('button', { name: /Sign in/i }).click();

    // Stub advances to TOTP after ~600ms
    await expect(page.getByText('Enter verification code')).toBeVisible();

    // Step 2: TOTP
    await page.getByPlaceholder('6-digit code').fill('123456');
    await page.getByRole('button', { name: /Verify/i }).click();

    // Stub navigates to /dashboard after another ~600ms
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.getByText('City')).toBeVisible();      // brand title contains "City pulse"
  });

  test('Sign-in button disabled when form empty', async ({ page }) => {
    const btn = page.getByRole('button', { name: /Sign in/i });
    await expect(btn).toBeDisabled();

    await page.getByPlaceholder('admin@neerly.in').fill('only-email');
    await expect(btn).toBeDisabled();

    await page.locator('input[type="password"]').fill('x');
    await expect(btn).toBeEnabled();
  });
});
