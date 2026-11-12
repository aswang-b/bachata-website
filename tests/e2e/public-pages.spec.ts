import { test, expect } from './support/fixtures';
import { db, sweepTestData } from './support/db';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Every public page renders without a server error or a script crash.
const PAGES = ['/', '/calendar', '/register', '/register/events', '/contact', '/check-in', '/about', '/privacy-policy'];

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

test('the homepage shows no cookie banner (the site sets no consent-dependent cookies)', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(750);
  await expect(page.locator('#cookie-consent, [aria-label="Cookie consent"]')).toHaveCount(0);
});

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

test('a button shows it is pressed (dimmed and slightly smaller) while held, and returns on release; no layout moves', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('header a[href="/register"]').first();
  await expect(button).toBeVisible();
  const state = () => button.evaluate((el) => ({ filter: getComputedStyle(el).filter, scale: getComputedStyle(el).scale, top: (el.parentElement as HTMLElement).offsetHeight, width: (el as HTMLElement).offsetWidth }));
  const resting = await state();
  expect(resting.filter).toBe('none');
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await state()).filter).not.toBe('none');
  await expect.poll(async () => (await state()).scale).toBe('0.98'); // it eases in over ~90ms
  const pressed = await state();
  // Scaling is visual only: its layout box and its container's height are unchanged.
  expect(pressed.width).toBe(resting.width);
  expect(pressed.top).toBe(resting.top);
  await page.mouse.move(2, 2); // let go off the button, so nothing is followed
  await page.mouse.up();
  await expect.poll(async () => (await state()).filter).toBe('none');
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

test('the header arrives whole: the Site Visibility settings are applied in the page as sent, not after it loads', async ({ request }) => {
  // The events button used to be added by a script once /api/settings answered, so it popped in after the rest.
  const { data } = await db.from('site_settings').select('key, enabled');
  const on = (key: string) => data?.find((r) => r.key === key)?.enabled ?? false;
  const html = await (await request.get('/')).text();
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  expect(header.includes('href="/register/events"')).toBe(on('show_register_events_nav'));
  expect(header.includes('href="/about"')).toBe(!on('hide_about_nav'));
  expect(header.includes('href="/contact"')).toBe(!on('hide_contact_nav'));
});

test('the footer has no Linktree placeholder; its WhatsApp icon, when a link is set, opens only WhatsApp', async ({ page }) => {
  // The link itself is set in Admin → Admin (shared database), so this checks whichever it is now.
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer.locator('a[href*="linktr.ee"]')).toHaveCount(0);
  for (const { href, title } of await footer.locator('a[aria-label="Join our WhatsApp community"]').evaluateAll((as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, title: a.getAttribute('title') })))) {
    expect(new URL(href).hostname).toMatch(/(^|\.)whatsapp\.com$|^wa\.me$/);
    // Its tooltip.
    expect(title).toBe('Join our WhatsApp community!');
  }

  // On every page, including ones once built ahead of time (Contact, About, the
  // admin pages), which then showed no icon: the footer follows the saved link.
  const { data: config } = await db.from('site_config').select('whatsapp_url').eq('id', true).maybeSingle();
  for (const path of [...PAGES, '/admin']) {
    await page.goto(path);
    await expect(page.locator('footer a[aria-label="Join our WhatsApp community"]'), path).toHaveCount(config?.whatsapp_url ? 1 : 0);
  }
});

test("pages that are the same for everyone are kept at Netlify's edge for a minute, so most visits skip the server", async ({ request }) => {
  // They render per request (for the live header and footer settings), which costs a server call each visit without this.
  for (const path of ['/about', '/contact', '/privacy-policy']) {
    const res = await request.get(path);
    expect(res.headers()['netlify-cdn-cache-control'], path).toMatch(/^public, durable, s-maxage=60\b/);
  }
  // Admin pages are never cached for everyone.
  expect((await request.get('/admin')).headers()['netlify-cdn-cache-control']).toBeUndefined();
});

test('on a phone the menu button and the bell take taps from at least 44px tall (the bell as wide as the 8px gaps beside it allow)', async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  await page.goto('/');
  // How far from its center a control still gets the tap, measured with real hit testing.
  const hitSize = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const b = el.getBoundingClientRect();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const reach = (dx: number, dy: number) => {
        let d = 0;
        for (; d < 60; d += 0.5) {
          const hit = document.elementFromPoint(cx + dx * d, cy + dy * d);
          if (!hit || !(hit === el || el.contains(hit))) break;
        }
        return d;
      };
      return { width: reach(1, 0) + reach(-1, 0), height: reach(0, 1) + reach(0, -1) };
    });
  const menu = await hitSize('#nav-toggle');
  expect(menu.width).toBeGreaterThanOrEqual(44);
  expect(menu.height).toBeGreaterThanOrEqual(44);
  const bell = await hitSize('#app-bell');
  expect(bell.width).toBeGreaterThanOrEqual(39);
  expect(bell.height).toBeGreaterThanOrEqual(44);
  await phone.close();
});

test('smooth scrolling is off for visitors who ask for reduced motion', async ({ page }) => {
  await page.goto('/');
  const behavior = () => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await behavior()).toBe('smooth');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await behavior()).toBe('auto');
});
