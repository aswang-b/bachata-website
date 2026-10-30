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

test('a deal shows its icon beside its price (and wider up when it ends), with the full end in a bubble on tap or hover', async ({ page, browser }) => {
  // On a phone a pill beside the price wrapped onto two lines; now it's an icon, and a tap shows when the deal ends.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tapPage = await phone.newPage();
  await tapPage.goto(`${BASE_URL}/`);
  const s = row(tapPage, series);
  const deal = s.locator('[data-deal]');
  const bubble = deal.locator('[data-deal-bubble]');
  await expect(deal).toHaveCount(1);
  await expect(deal).toHaveAttribute('aria-label', /^Early Bird ends [A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d\d [AP]M$/);
  await expect(deal.locator('[data-deal-note]')).toBeHidden();
  // On the Series price's own line, which stays one line.
  const price = s.locator('p > span', { hasText: 'Series:' });
  const [dealBox, priceBox] = [await deal.boundingBox(), await price.boundingBox()];
  expect(priceBox!.height).toBeLessThan(24);
  expect(dealBox!.y).toBeGreaterThanOrEqual(priceBox!.y - 1);
  expect(dealBox!.y + dealBox!.height).toBeLessThanOrEqual(priceBox!.y + priceBox!.height + 1);

  await expect(bubble).toBeHidden();
  await deal.tap();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Early Bird');
  await expect(bubble).toContainText(/Ends [A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d\d [AP]M/);
  // It stays inside the flyer block, also once the screen changes size while it's open.
  const inside = async () => {
    const [bubbleBox, blockBox] = [await bubble.boundingBox(), await block(tapPage, series).boundingBox()];
    return bubbleBox!.x >= blockBox!.x && bubbleBox!.x + bubbleBox!.width <= blockBox!.x + blockBox!.width;
  };
  expect(await inside()).toBe(true);
  await tapPage.setViewportSize({ width: 330, height: 844 });
  await expect(bubble).toBeVisible();
  await expect.poll(inside).toBe(true);
  // Tapping anywhere else closes it.
  await s.locator('h3').tap();
  await expect(bubble).toBeHidden();
  await phone.close();

  // Wider up the note says when it ends (seeded 30 days out), and hovering shows the bubble.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const wideDeal = row(page, series).locator('[data-deal]');
  const wideBubble = wideDeal.locator('[data-deal-bubble]');
  await expect(wideDeal.locator('[data-deal-note]')).toHaveText(/^ends [A-Z][a-z]{2} \d{1,2}$/);
  await wideDeal.hover();
  await expect(wideBubble).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(wideBubble).toBeHidden();
  // A click with the mouse doesn't pin it open once the pointer leaves.
  await wideDeal.click();
  await page.mouse.move(0, 0);
  await expect(wideBubble).toBeHidden();
  // From the keyboard it shows on focus, and Escape hides it until focus comes back.
  await page.keyboard.press('Shift');
  await wideDeal.focus();
  await expect(wideBubble).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(wideBubble).toBeHidden();
  await wideDeal.blur();
  await page.keyboard.press('Shift');
  await wideDeal.focus();
  await expect(wideBubble).toBeVisible();
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

test('on a phone, the past flyers show a "Swipe to see more" hint until the first swipe, and not again that browser session', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const gallery = page.locator('#past-flyers');
  test.skip((await gallery.count()) === 0, 'The gallery is empty right now.');
  const hint = page.locator('#past-flyers-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Swipe to see more');
  // The row centering itself as its images load isn't a swipe.
  await page.waitForTimeout(500);
  await expect(hint).toBeVisible();
  await gallery.dispatchEvent('touchstart');
  await gallery.evaluate((g) => g.scrollBy({ left: 200 }));
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#past-flyers')).toBeVisible();
  await expect(page.locator('#past-flyers-hint')).toHaveCount(0);
  // Remembered only for the session: a cookie with no expiry date.
  const cookie = (await page.context().cookies()).find((c) => c.name === 'past-flyers-swiped');
  expect(cookie?.expires).toBe(-1);
  // A new session (another browser profile here) sees it again.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const again = await fresh.newPage();
  await again.goto(`${BASE_URL}/`);
  await expect(again.locator('#past-flyers-hint')).toBeVisible();
  await fresh.close();
});

test('on a wider screen the past flyers have arrows, and no swipe hint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  test.skip((await page.locator('#past-flyers').count()) === 0, 'The gallery is empty right now.');
  await expect(page.locator('#past-flyers-hint')).toBeHidden();
});

test('on a narrow phone, "Registration closed" leaves room for a three-digit price on one line', async ({ page }) => {
  const closed = await seedEvent({ name: 'Closed Wide Price', occurrences: 2, priceWhole: 160, registrationClosed: true, dayOffset: 43 });
  await page.setViewportSize({ width: 352, height: 800 });
  await page.goto('/');
  const result = await page.evaluate((title) => {
    const heading = [...document.querySelectorAll('main h3, main h4, main p, main span')].find((el) => el.textContent?.trim() === title);
    let row: Element | null = null;
    for (let el = heading?.parentElement; el && !row; el = el.parentElement) {
      row = [...el.querySelectorAll('span')].find((s) => /^registration closed$/i.test(s.textContent?.trim() ?? ''))?.parentElement ?? null;
    }
    const price = row?.querySelector('p > span');
    if (!price) return null;
    return { text: price.textContent?.replace(/\s+/g, ' ').trim(), height: price.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(price).lineHeight) };
  }, closed.title);
  expect(result?.text).toBe('Series: $160');
  expect(result!.height).toBeLessThan(result!.lineHeight * 1.5);
});

test('on a phone, letting go of a swipe on the past flyers settles with the nearest flyer centered', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/`);
  const gallery = page.locator('#past-flyers');
  test.skip((await gallery.count()) === 0, 'The gallery is empty right now.');
  await gallery.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const box = (await gallery.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  // A slow drag, most of a flyer long, that stops and lets go between two flyers.
  const startLeft = await gallery.evaluate((g) => g.scrollLeft);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (let x = 290; x >= 130; x -= 10) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // How far the nearest flyer is from the middle, measured with the turn of
  // each flyer (its 3D transform) briefly switched off.
  const offCenter = () =>
    gallery.evaluate((g) => {
      const middle = g.getBoundingClientRect().left + g.clientWidth / 2;
      const flyers = [...g.querySelectorAll<HTMLElement>('[data-gallery-flyer]')];
      const turns = flyers.map((f) => f.style.transform);
      flyers.forEach((f) => (f.style.transform = 'none'));
      const gap = Math.min(...flyers.map((f) => Math.abs(f.getBoundingClientRect().left + f.offsetWidth / 2 - middle)));
      flyers.forEach((f, i) => (f.style.transform = turns[i]));
      return gap;
    });
  await expect.poll(offCenter, { timeout: 5000 }).toBeLessThan(2);
  // And it did move: the drag wasn't too short to count.
  expect(await gallery.evaluate((g) => g.scrollLeft)).not.toBe(startLeft);
  await ctx.close();
});

test('wider up, the past flyers show only the middle three, also after an arrow click', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const gallery = page.locator('#past-flyers');
  test.skip((await gallery.count()) === 0, 'The gallery is empty right now.');
  await gallery.scrollIntoViewIfNeeded();
  const shown = () =>
    gallery.evaluate((g) => [...g.querySelectorAll<HTMLElement>('[data-gallery-flyer]')].filter((f) => Number(f.style.opacity || 1) > 0.05).length);
  await expect.poll(shown).toBe(3);
  await page.locator('[data-gallery-scroll="1"]').click();
  await page.waitForTimeout(1200);
  await expect.poll(shown).toBe(3);
});

// Hiding the flyers beyond the middle three (visibility: hidden) took them out
// of the tab order, so a keyboard could reach only the ones in view.
test('wider up, tabbing to a past flyer out of view brings it to the middle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const real = page.locator('#past-flyers [data-gallery-flyer]:not([aria-hidden])');
  test.skip((await real.count()) < 3, 'Too few flyers to have one out of view.');
  await page.locator('#past-flyers').scrollIntoViewIfNeeded();
  const far = real.last();
  // Out of view to start with: faded right out, and not clickable.
  await expect.poll(() => far.evaluate((el) => Number(el.style.opacity || 1))).toBeLessThan(0.05);
  expect(await far.evaluate((el) => el.style.pointerEvents)).toBe('none');
  await far.focus();
  await expect(far).toBeFocused();
  await expect.poll(() => far.evaluate((el) => Number(el.style.opacity || 1)), { timeout: 5000 }).toBeGreaterThan(0.9);
});

// Scroll snapping waited (on some phones) for the coast to stop, then jumped
// to a flyer. Now a flick carries the row on past where the finger let go and
// eases to a stop with a flyer centered, all in one glide.
test('on a phone, a quick flick of the past flyers glides on and settles centered', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/`);
  const gallery = page.locator('#past-flyers');
  test.skip((await gallery.count()) === 0, 'The gallery is empty right now.');
  await gallery.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const box = (await gallery.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  const startLeft = await gallery.evaluate((g) => g.scrollLeft);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] });
  for (let x = 300; x >= 220; x -= 20) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(10);
  }
  const released = await gallery.evaluate((g) => g.scrollLeft);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const offCenter = () =>
    gallery.evaluate((g) => {
      const middle = g.getBoundingClientRect().left + g.clientWidth / 2;
      const flyers = [...g.querySelectorAll<HTMLElement>('[data-gallery-flyer]')];
      const turns = flyers.map((f) => f.style.transform);
      flyers.forEach((f) => (f.style.transform = 'none'));
      const gap = Math.min(...flyers.map((f) => Math.abs(f.getBoundingClientRect().left + f.offsetWidth / 2 - middle)));
      flyers.forEach((f, i) => (f.style.transform = turns[i]));
      return gap;
    });
  await expect.poll(offCenter, { timeout: 5000 }).toBeLessThan(2);
  // It followed the finger, then carried on beyond where the finger let go
  // (allowing for the loop's invisible jump back by whole copies).
  expect(released).toBeGreaterThan(startLeft + 60);
  const copy = await gallery.evaluate((g) => {
    const items = [...g.querySelectorAll<HTMLElement>('[data-gallery-flyer]')];
    return items[Number(g.dataset.count)].offsetLeft - items[0].offsetLeft;
  });
  const travelled = (((await gallery.evaluate((g) => g.scrollLeft)) - released) % copy + copy) % copy;
  expect(travelled).toBeGreaterThan(20);
  expect(travelled).toBeLessThan(copy - 20);
  await ctx.close();
});

// The past flyers' phone gestures, in a touch phone context with the gallery in view.
async function phoneGallery(browser: import('@playwright/test').Browser, options: { reducedMotion?: 'reduce' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...options });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/`);
  const gallery = page.locator('#past-flyers');
  const empty = (await gallery.count()) === 0;
  if (!empty) {
    await gallery.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
  }
  const box = empty ? null : await gallery.boundingBox();
  const y = box ? Math.round(box.y + box.height / 2) : 0;
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ x, y }] });
  const flick = async () => {
    await touch('touchStart', 320);
    for (let x = 300; x >= 220; x -= 20) {
      await touch('touchMove', x);
      await page.waitForTimeout(10);
    }
    await touch('touchEnd');
  };
  // How far the nearest flyer is from the middle, with the flyers' turn briefly switched off.
  const offCenter = () =>
    gallery.evaluate((g) => {
      const middle = g.getBoundingClientRect().left + g.clientWidth / 2;
      const flyers = [...g.querySelectorAll<HTMLElement>('[data-gallery-flyer]')];
      const turns = flyers.map((f) => f.style.transform);
      flyers.forEach((f) => (f.style.transform = 'none'));
      const gap = Math.min(...flyers.map((f) => Math.abs(f.getBoundingClientRect().left + f.offsetWidth / 2 - middle)));
      flyers.forEach((f, i) => (f.style.transform = turns[i]));
      return gap;
    });
  return { ctx, page, gallery, touch, flick, offCenter, empty };
}

test('on a phone, a tap that catches the past flyers mid-glide settles them centered and opens nothing', async ({ browser }) => {
  const g = await phoneGallery(browser);
  test.skip(g.empty, 'The gallery is empty right now.');
  await g.flick();
  await g.page.waitForTimeout(80);
  await g.touch('touchStart', 200);
  await g.touch('touchEnd');
  await expect.poll(g.offCenter, { timeout: 5000 }).toBeLessThan(2);
  expect(await g.page.locator('#flyer-dialog').evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  await g.ctx.close();
});

test('on a phone, the past flyers start following the finger without a jump', async ({ browser }) => {
  const g = await phoneGallery(browser);
  test.skip(g.empty, 'The gallery is empty right now.');
  const before = await g.gallery.evaluate((el) => el.scrollLeft);
  await g.touch('touchStart', 300);
  await g.touch('touchMove', 290);
  await g.touch('touchMove', 288);
  // 12px of finger, the first 10 before the drag counts: the row moves by the rest, not all 12.
  const moved = (await g.gallery.evaluate((el) => el.scrollLeft)) - before;
  expect(moved).toBeGreaterThan(0);
  expect(moved).toBeLessThan(6);
  await g.touch('touchEnd');
  await g.ctx.close();
});

test('on a phone with reduced motion, a flick of the past flyers settles at once', async ({ browser }) => {
  const g = await phoneGallery(browser, { reducedMotion: 'reduce' });
  test.skip(g.empty, 'The gallery is empty right now.');
  await g.flick();
  await g.page.waitForTimeout(60);
  expect(await g.offCenter()).toBeLessThan(2);
  await g.ctx.close();
});
