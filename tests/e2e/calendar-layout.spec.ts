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
  await expect(card).toContainText('$40/dancer');
  await expect(card).not.toContainText('Price:');
  await expect(card).not.toContainText('Whole Series');
  await expect(card).not.toContainText('Wk 1');

  const seriesCard = page.locator('.event-banner', { hasText: series.title }).first();
  await expect(seriesCard).toContainText('Class');
  await expect(seriesCard).toContainText('Whole Series');
});
