import { test, expect } from './support/fixtures';

// Every public page renders without a server error or a script crash.
const PAGES = ['/', '/calendar', '/calendar?view=list', '/register', '/register/events', '/contact', '/check-in', '/about', '/privacy-policy'];

for (const path of PAGES) {
  test(`${path} loads cleanly`, async ({ page, pageErrors }) => {
    const res = await page.goto(path);
    expect(res?.status(), `status of ${path}`).toBeLessThan(400);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    await page.waitForLoadState('load');
    // Some pages poll (e.g. the inbox badge), so they never go network-idle; give their scripts a moment instead.
    await page.waitForTimeout(750);
    expect(pageErrors).toEqual([]);
  });
}

test('a confirmation link with no or an unknown id still renders', async ({ page }) => {
  for (const path of ['/register/confirmation', '/register/confirmation?id=00000000-0000-0000-0000-000000000000', '/check-in/confirmation']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
  }
});

test('the test-mode status route is only for the dev server', async ({ request }) => {
  // Here (dev) it answers; a production build returns 404 (see src/pages/api/test-mode.ts).
  expect((await request.get('/api/test-mode')).ok()).toBe(true);
});
