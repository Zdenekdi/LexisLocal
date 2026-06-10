const { test, expect } = require('@playwright/test');

test.describe('LexisLocal Homepage', () => {
  test('should load the homepage and display correct title', async ({ page }) => {
    // Navigate to the base URL (which is http://localhost:4000 as configured)
    await page.goto('/');

    // Check if the page title is correct
    await expect(page).toHaveTitle(/LexisLocal/i);

    // Verify a main heading or element is present
    const mainHeading = page.locator('h1');
    await expect(mainHeading).toContainText(/LexisLocal/i);

    // Verify sidebar or specific dashboard elements exist
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Verify that the "Přehled" (Overview) navigation link is present
    const overviewBtn = page.locator('button[data-tab="overview"]');
    await expect(overviewBtn).toBeVisible();
  });
});
