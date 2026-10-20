import { test, expect } from './support/fixtures';
import { db, seedEvent, type Seeded } from './support/db';

// Calendar event banners must keep their text inside the colored box at
// narrow widths (e.g. a laptop at 125% zoom): a "Wk N" pill once had no
// space after it, so the title's first word couldn't wrap below it and ran
// past the edge.
let series: Seeded;

test.beforeAll(async () => {
  series = await seedEvent({ name: 'Bachata Foundations Intermediate', occurrences: 2 });
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
    // The pill and the title wrap as separate words.
    expect(await label.evaluate((el) => el.textContent?.includes('Wk 1 '))).toBe(true);
  });
}
