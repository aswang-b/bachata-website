import { test, expect } from './support/fixtures';
import { db, seedEvent, sweepTestData, type Seeded } from './support/db';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Calendar event banners must keep their text inside the colored box at
// narrow widths (e.g. a laptop at 125% zoom): a "Wk N" pill once had no
// space after it, so the title's first word couldn't wrap below it and ran
// past the edge.
let series: Seeded;

test.beforeAll(async () => {
  // A day of its own: other specs' classes share the early dates, and a crowded day hides banners behind "+ more".
  series = await seedEvent({ name: 'Bachata Foundations Intermediate', occurrences: 2, dayOffset: 30 });
});

for (const width of [1280, 1100, 1000, 900]) {
  test(`banner text stays inside its box at ${width}px wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { data } = await db.from('events').select('start_time').eq('id', series.ids[0]).single();
    const d = new Date(data!.start_time);
    await page.goto(`/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);

    const label = page.locator('.event-banner-label', { hasText: series.title }).first();
    await expect(label).toContainText('Wk 1');
    // Every line of text ends inside the right padding (not just inside the outer edge).
    await expect
      .poll(() =>
        label.evaluate((el) => {
          const style = getComputedStyle(el);
          const limit = el.getBoundingClientRect().right - parseFloat(style.paddingRight);
          const range = document.createRange();
          range.selectNodeContents(el);
          return Array.from(range.getClientRects()).every((r) => r.right <= limit + 0.5);
        })
      )
      .toBe(true);
    // Every banner shares one font size, so a shrunk one doesn't stand out.
    const sizes = await page
      .locator('.event-banner-label')
      .evaluateAll((els) => [...new Set(els.filter((el) => (el as HTMLElement).offsetParent).map((el) => getComputedStyle(el).fontSize))]);
    expect(sizes).toHaveLength(1);
    // The pill and the title wrap as separate words.
    expect(await label.evaluate((el) => el.textContent?.includes('Wk 1 '))).toBe(true);
  });
}

test('a one-off class shows as a Workshop with a single price; a series class keeps both prices', async ({ page }) => {
  const workshop = await seedEvent({ name: 'Pop-Up Workshop', priceWhole: 40, priceDropIn: 25, dayOffset: 33 });
  const { data } = await db.from('events').select('start_time').eq('id', workshop.ids[0]).single();
  const d = new Date(data!.start_time);
  await page.goto(`/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);

  const card = page.locator('.event-banner', { hasText: workshop.title }).first();
  await expect(card).toContainText('Workshop');
  await expect(card).toContainText('Workshop: $40');
  await expect(card).not.toContainText('/dancer');
  await expect(card).not.toContainText('Whole Series');
  await expect(card).not.toContainText('Wk 1');

  const seriesCard = page.locator('.event-banner', { hasText: series.title }).first();
  await expect(seriesCard).toContainText('Class');
  await expect(seriesCard).toContainText('Whole Series');
});

test.describe('a long description', () => {
  const longText = Array.from({ length: 30 }, (_, i) => `<p>Line ${i + 1} of a very long class description that keeps going.</p>`).join('');
  let long: Seeded;
  let month = '';
  test.beforeAll(async () => {
    long = await seedEvent({ name: 'Long Description', description: longText, dayOffset: 36 });
    const { data } = await db.from('events').select('start_time').eq('id', long.ids[0]).single();
    const d = new Date(data!.start_time);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  test('the hover card stays inside the window and offers to click for the rest', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/calendar?month=${month}`);
    const banner = page.locator('.day-banners .event-banner', { hasText: long.title }).first();
    // Near the bottom of the window, where the card used to run off the screen.
    await banner.evaluate((el) => {
      document.documentElement.style.scrollBehavior = 'auto';
      el.scrollIntoView({ block: 'end' });
    });
    await banner.hover();
    const tip = banner.locator('.event-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.tooltip-more')).toHaveText('Click for full details');
    const box = (await tip.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
  });

  test('list view cuts it short with a Read more link that expands it', async ({ page }) => {
    await page.goto(`/calendar?month=${month}`);
    await page.locator('[data-view="list"]').first().click();
    const row = page.locator('#list-view > div', { hasText: long.title });
    const toggle = row.locator('.list-desc-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Read more');
    const clamped = (await row.locator('.list-desc').boundingBox())!.height;
    await toggle.click();
    await expect(toggle).toHaveText('Show less');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect((await row.locator('.list-desc').boundingBox())!.height).toBeGreaterThan(clamped * 5);
    await toggle.click();
    await expect(toggle).toHaveText('Read more');
  });
});

// Banners opened only on click or hover, so keyboard and screen-reader users
// couldn't reach any event on the calendar.
test('a calendar event can be reached with Tab and opened with Enter', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { data } = await db.from('events').select('start_time').eq('id', series.ids[0]).single();
  const d = new Date(data!.start_time);
  await page.goto(`/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  const banner = page.locator('.event-banner', { hasText: series.title }).first();
  await expect(banner).toHaveAttribute('role', 'button');
  await banner.focus();
  // Its tooltip links stay out of the tab order (the tooltip hides once focus leaves the banner).
  expect(await banner.locator('.event-tooltip a').evaluateAll((els) => els.every((a) => (a as HTMLElement).tabIndex === -1))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#detail-title')).toHaveText(series.title);
  await expect(page.locator('#detail-title')).toBeFocused();
});

test("an evening class shows on its own day in the site's time zone, though the server runs in UTC", async ({ page }) => {
  // Seeded classes start at 1:00 AM UTC: the evening before, in Central time.
  const { data } = await db.from('events').select('start_time').eq('id', series.ids[0]).single();
  const start = new Date(data!.start_time);
  const central = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
  const [y, m] = central.split('-');
  await page.goto(`/calendar?month=${y}-${m}`);
  await expect(page.locator('meta[name="site-time-zone"]')).toHaveAttribute('content', 'America/Chicago');
  const cell = page.locator('.calendar-cell', { has: page.locator('.event-banner', { hasText: series.title }) }).first();
  await expect(cell).toHaveAttribute('data-date', central);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(start);
  await expect(cell.locator('.event-banner', { hasText: series.title }).first()).toContainText(time);
});

// On a phone, tapping a day listed only the first three of its events (the
// banners kept in the cell), and its dots wrapped unevenly past three.
test('a busy day on a phone shows its dots in even rows and lists every event when tapped', async ({ page }) => {
  const busy = await Promise.all([1, 2, 3, 4, 5].map((i) => seedEvent({ name: `Busy Day ${i}`, dayOffset: 70 })));
  await page.setViewportSize({ width: 375, height: 812 });
  const { data } = await db.from('events').select('start_time').eq('id', busy[0].ids[0]).single();
  const central = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data!.start_time));
  const [y, m] = central.split('-');
  await page.goto(`/calendar?month=${y}-${m}`);
  await page.locator('#view-toggle-calendar').click();
  const cell = page.locator(`.calendar-cell[data-date="${central}"]`);
  // Five dots: a row of three over a row of two.
  await expect(cell.locator('.day-dots')).toHaveClass(/grid-cols-3/);
  await expect(cell.locator('.day-dots > span')).toHaveCount(5);
  await cell.locator('.day-dots').click();
  const panel = page.locator('.day-expand-panel');
  for (const s of busy) await expect(panel.getByText(s.title)).toBeVisible();
});

// The 📍 emoji had a blank margin on its left that differs by emoji font
// (wide on Android, narrower on Windows), so pins never lined up with the
// text above them. The drawn pin (lib/locationPin.ts) starts flush.
for (const width of [390, 1280]) {
  test(`a location's pin lines up with the text above it at ${width}px wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');
    const pin = page.locator(`.series-item[data-key="${series.key}"] a svg`).first();
    // Measured only where the pin starts a line (on a wide screen it can follow the date on the same line).
    const gap = await pin.evaluate((svg) => {
      const box = svg.closest('a')!.parentElement!;
      const lineStart = box.getBoundingClientRect().left + parseFloat(getComputedStyle(box).paddingLeft);
      const left = svg.getBoundingClientRect().left;
      return left - lineStart > 40 ? null : left - lineStart;
    });
    if (gap !== null) expect(Math.abs(gap)).toBeLessThan(1);
    else expect(width).toBeGreaterThan(400);
  });
}
