import { test, expect } from './support/fixtures';
import { db, seedEvent, type Seeded } from './support/db';

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
