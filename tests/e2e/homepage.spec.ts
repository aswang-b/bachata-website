import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, sweepTestData, type Seeded } from './support/db';
import { BASE_URL, RUN_ID } from './support/env';
import { bearer } from './support/admin';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// The homepage is built from flyers: classes sharing a flyer form one block,
// a lone class shows its details beside its flyer, and one class without a
// flyer still gets a plain banner card. Flyers are a site image with a
// per-flyer query, so each block's URL is unique to this run.
const flyer = (name: string) => `/icon-512.png?flyer=${RUN_ID}-${name}`;

let series: Seeded;
let workshop: Seeded;
let lone: Seeded;
let full: Seeded;
let closed: Seeded;
let hidden: Seeded;
let noFlyer: Seeded;

test.beforeAll(async () => {
  // Two classes on one flyer, with an early bird running and counts shown.
  series = await seedEvent({ name: 'Flyer Series', occurrences: 2, flyerUrl: flyer('pair'), priceWhole: 50, priceDropIn: 15, priceEarlyBird: 40, earlyBirdDays: 30, capacity: 10, showCapacity: true, description: '<p>Series details.</p>', dayOffset: 40 });
  workshop = await seedEvent({ name: 'Flyer Workshop', flyerUrl: flyer('pair'), capacityByRole: true, leaderCapacity: 1, followerCapacity: 3, showCapacity: true, description: '<p>Workshop details.</p>', dayOffset: 41 });
  await seedSignup(workshop, [{ first: 'FlyerLead', role: 'leader' }]);
  // One class per flyer: details inline; full; closed; count hidden from the public.
  lone = await seedEvent({ name: 'Flyer Lone', flyerUrl: flyer('lone'), description: '<p>Everything about the lone class.</p>', dayOffset: 42 });
  full = await seedEvent({ name: 'Flyer Full', flyerUrl: flyer('full'), capacity: 1, showCapacity: true, dayOffset: 43 });
  await seedSignup(full, [{ first: 'FlyerTaken', role: 'leader' }]);
  closed = await seedEvent({ name: 'Flyer Closed', flyerUrl: flyer('closed'), registrationClosed: true, dayOffset: 44 });
  hidden = await seedEvent({ name: 'Flyer Hidden Count', flyerUrl: flyer('hidden'), capacity: 5, showCapacity: false, dayOffset: 45 });
  // The one card without a flyer.
  noFlyer = await seedEvent({ name: 'No Flyer', dayOffset: 46 });
});

const block = (page: import('@playwright/test').Page, s: Seeded) => page.locator('[data-flyer-block]', { has: page.locator(`[data-offering-key="${s.key}"]`) });
const row = (page: import('@playwright/test').Page, s: Seeded) => page.locator(`[data-offering-key="${s.key}"]`);

test('classes sharing a flyer form one block, each with its own tags, prices and Register link', async ({ page, pageErrors }) => {
  await page.goto('/');
  const pair = block(page, series);
  await expect(pair.locator('[data-offering-key]')).toHaveCount(2);
  await expect(pair.locator(`[data-offering-key="${workshop.key}"]`)).toBeVisible();
  await expect(pair.locator('[data-flyer-open] img')).toHaveAttribute('src', flyer('pair'));

  const s = row(page, series);
  await expect(s).toContainText('2-week series');
  await expect(s.locator('[data-public-spots]')).toHaveText('10 spots remaining');
  await expect(s).toContainText('Series: $50 $40');
  await expect(s).toContainText('Early Bird');
  await expect(s).toContainText('Drop in: $15/class');
  await expect(s.locator('a', { hasText: 'Register' })).toHaveAttribute('href', `/register?series=${encodeURIComponent(series.key)}`);
  // With two classes on the flyer, details stay folded.
  await expect(s.locator('details summary', { hasText: 'More about' })).toBeVisible();

  const w = row(page, workshop);
  await expect(w).toContainText('Workshop');
  // Counts shown publicly, so the public sees both roles.
  await expect(w.locator('[data-public-spots]')).toHaveText('Leaders full · 3 follower spots left');
  expect(pageErrors).toEqual([]);
});

test('a lone class shows its details beside the flyer, and the flyer opens full size', async ({ page }) => {
  await page.goto('/');
  const b = block(page, lone);
  await expect(b.locator('[data-desc-preview]')).toContainText('Everything about the lone class.');
  await expect(b.locator('details summary', { hasText: 'More about' })).toHaveCount(0);

  await b.locator('[data-flyer-open]').click();
  await expect(page.locator('#flyer-dialog')).toBeVisible();
  await expect(page.locator('#flyer-dialog-img')).toHaveAttribute('src', flyer('lone'));
  await page.keyboard.press('Escape');
  await expect(page.locator('#flyer-dialog')).toBeHidden();
});

test("full and closed classes can't be registered for", async ({ page }) => {
  await page.goto('/');
  const f = row(page, full);
  await expect(f.locator('[data-public-spots]')).toHaveText('Full');
  await expect(f.getByText('Full', { exact: true }).last()).toBeVisible();
  await expect(f.locator('a', { hasText: 'Register' })).toHaveCount(0);

  const c = row(page, closed);
  await expect(c).toContainText('Registration closed');
  await expect(c.locator('a', { hasText: 'Register' })).toHaveCount(0);
});

test('a hidden count stays hidden from the public and shows to admins', async ({ page, browser, adminPage }) => {
  void adminPage;
  // Public view first, in a fresh context with no admin session.
  const publicPage = await browser.newPage({ baseURL: BASE_URL });
  await publicPage.goto('/');
  await expect(row(publicPage, hidden)).toBeVisible();
  await expect(row(publicPage, hidden).locator('[data-public-spots], [data-admin-spots-key]:visible')).toHaveCount(0);
  await publicPage.close();

  await page.goto('/');
  await expect(row(page, hidden).locator('[data-admin-spots-key]')).toHaveText('5 spots remaining (admin only)');
});

test('a class without a flyer still gets a card, with a banner image and a Register link', async ({ page }) => {
  await page.goto('/');
  const b = block(page, noFlyer);
  await expect(b.locator('[data-flyer-open]')).toHaveCount(0);
  await expect(b.locator('img').first()).toBeVisible();
  await expect(row(page, noFlyer).locator('a', { hasText: 'Register' })).toBeVisible();
});

test('the past flyers gallery only accepts images uploaded to the site', async ({ request, admin }) => {
  const get = await request.get('/api/admin/gallery-flyers', { headers: bearer(admin) });
  expect(get.ok()).toBe(true);
  expect(Array.isArray((await get.json()).flyers)).toBe(true);
  // Rejected before anything is written, so the real gallery is never touched.
  const res = await request.post('/api/admin/gallery-flyers', {
    headers: { ...bearer(admin), Origin: BASE_URL },
    data: { flyers: ['https://example.com/not-ours.jpg'] },
  });
  expect(res.status()).toBe(400);
  expect((await request.post('/api/admin/gallery-flyers', { headers: { Origin: BASE_URL }, data: { flyers: [] } })).status()).toBe(403);
});

// The calendar offers the same flyer: a "See flyer" button in the detail
// panel, and a thumbnail on each list entry (a link on phones).
async function calendarMonth(page: import('@playwright/test').Page, s: Seeded) {
  const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
  const d = new Date(data!.start_time);
  await page.goto(`/calendar?month=${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
}

test("the calendar's detail panel offers See flyer only for a class with a flyer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await calendarMonth(page, series);
  await page.locator('.event-banner', { hasText: series.title }).first().click();
  const button = page.locator('#detail-flyer-btn');
  await expect(button).toBeVisible();
  await expect(button).toContainText('See flyer');
  await button.click();
  await expect(page.locator('#flyer-dialog-img')).toHaveAttribute('src', flyer('pair'));
  await expect(page.locator('#flyer-dialog-img')).toHaveAttribute('alt', `Flyer for ${series.title}`);
  await page.keyboard.press('Escape');

  await calendarMonth(page, noFlyer);
  await page.locator('.event-banner', { hasText: noFlyer.title }).first().click();
  await expect(page.locator('#detail-title')).toHaveText(noFlyer.title);
  await expect(button).toBeHidden();
});

test('calendar list entries show a flyer thumbnail that opens it full size (a link on phones)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await calendarMonth(page, series);
  await page.locator('#view-toggle-list').click();
  const entry = page.locator('#list-view > div', { hasText: series.title }).first();
  const thumb = entry.locator('.list-flyer-thumb');
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator('#flyer-dialog-img')).toHaveAttribute('src', flyer('pair'));
  await page.keyboard.press('Escape');
  // Phones get a "See flyer" link instead of the thumbnail.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(thumb).toBeHidden();
  await expect(entry.locator('.list-flyer-link')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await calendarMonth(page, noFlyer);
  await page.locator('#view-toggle-list').click();
  const plain = page.locator('#list-view > div', { hasText: noFlyer.title }).first();
  await expect(plain).toBeVisible();
  await expect(plain.locator('[data-flyer-open]')).toHaveCount(0);
});

// Reads the real gallery without changing it, so it only runs while the gallery has flyers.
test('the past flyers gallery loops forever both ways', async ({ page }) => {
  await page.goto('/');
  const gallery = page.locator('#past-flyers');
  test.skip((await gallery.count()) === 0, 'The gallery is empty right now.');
  await gallery.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelectorAll<HTMLImageElement>('#past-flyers img').forEach((i) => (i.loading = 'eager')));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('#past-flyers img')].every((i) => i.complete && i.naturalWidth > 0));
  // Which flyer is in the middle, and which copy of the row it's in.
  const centered = () =>
    page.evaluate(() => {
      const g = document.getElementById('past-flyers')!;
      const items = [...g.querySelectorAll<HTMLElement>('[data-gallery-flyer]')];
      const mid = g.scrollLeft + g.clientWidth / 2;
      const index = items.reduce((best, it, i) => (Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid) < Math.abs(items[best].offsetLeft + items[best].offsetWidth / 2 - mid) ? i : best), 0);
      const count = Number(g.dataset.count);
      // How far that flyer sits from the exact middle (flyers differ in width, so a fixed step used to drift).
      const off = Math.abs(items[index].offsetLeft + items[index].offsetWidth / 2 - mid);
      return { flyer: index % count, copy: Math.floor(index / count), copies: Number(g.dataset.copies), count, off };
    });
  const start = await centered();
  const steps = start.count * start.copies;
  // More arrow steps than the row has flyers, each way: it never runs out.
  for (let i = 0; i < steps; i++) await page.click('[data-gallery-scroll="-1"]', { delay: 0 }).then(() => page.waitForTimeout(450));
  await page.waitForTimeout(400);
  const back = await centered();
  expect(back.flyer).toBe((((start.flyer - steps) % start.count) + start.count) % start.count);
  expect(back.copy).toBeGreaterThan(0);
  expect(back.off).toBeLessThan(2);
  for (let i = 0; i < steps * 2; i++) await page.click('[data-gallery-scroll="1"]', { delay: 0 }).then(() => page.waitForTimeout(450));
  await page.waitForTimeout(400);
  const forward = await centered();
  expect(forward.flyer).toBe((back.flyer + steps * 2) % start.count);
  expect(forward.copy).toBeLessThan(start.copies - 1);
  expect(forward.off).toBeLessThan(2);
  // Clicking fast, faster than the glide, still ends on a centered flyer and never runs out.
  for (let i = 0; i < steps * 2; i++) await page.click('[data-gallery-scroll="1"]', { delay: 0 }).then(() => page.waitForTimeout(60));
  await page.waitForTimeout(1500);
  const fast = await centered();
  expect(fast.flyer).toBe((forward.flyer + steps * 2) % start.count);
  expect(fast.off).toBeLessThan(2);
  for (let i = 0; i < steps * 2; i++) await page.click('[data-gallery-scroll="-1"]', { delay: 0 }).then(() => page.waitForTimeout(60));
  await page.waitForTimeout(1500);
  const fastBack = await centered();
  expect(fastBack.flyer).toBe(fast.flyer);
  expect(fastBack.off).toBeLessThan(2);
});
