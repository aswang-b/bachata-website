import { test, expect } from './support/fixtures';
import { db } from './support/db';

// Every public page renders without a server error or a script crash.
const PAGES = ['/', '/calendar', '/register', '/register/events', '/contact', '/check-in', '/about', '/privacy-policy', '/test'];

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

test('on a phone, Register for Events appears once (the header button), not again in the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#nav-toggle').click();
  await expect(page.locator('#mobile-nav')).toBeVisible();
  await expect(page.locator('#mobile-nav a[href="/register/events"]')).toHaveCount(0);
  await expect(page.locator('#mobile-nav a[href="/register"]')).toHaveCount(0);
});

test('both register buttons stay in the header on the register pages, each marked when it is the current page', async ({ page }) => {
  // The events button follows its Site Visibility setting (off unless an admin turned it on).
  const { data } = await db.from('site_settings').select('enabled').eq('key', 'show_register_events_nav').maybeSingle();
  const eventsShown = data?.enabled ?? false;
  for (const path of ['/register', '/register/events']) {
    await page.goto(path);
    await expect(page.locator('header a[href="/register"]')).toBeVisible();
    await expect(page.locator('header a[href="/register/events"]')).toBeVisible({ visible: eventsShown });
    await expect(page.locator(`header a[href="${path}"]`)).toHaveAttribute('aria-current', 'page');
  }
});

test("the calendar's heading doesn't call a month \"Upcoming\" (past months can be browsed too)", async ({ page }) => {
  await page.goto('/calendar?month=2020-01');
  await expect(page.locator('main, body').first()).not.toContainText(/^Upcoming$/m);
  await expect(page.getByText('Classes & Events', { exact: true })).toBeVisible();
});
