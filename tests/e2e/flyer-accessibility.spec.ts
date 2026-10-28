import { test, expect } from './support/fixtures';
import { db, seedEvent, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import type { Page } from '@playwright/test';

// Each test deletes the classes it seeded for itself (support/fixtures.ts);
// what this file's tests share goes as soon as the file is done.
test.afterAll(sweepTestData);

// Homepage flyers for screen-reader, keyboard and slow-connection visitors,
// and the editor's flyer upload. Flyers are a site image with a per-flyer
// query, so each block's URL is unique to this run.
const flyer = (name: string) => `/icon-512.png?flyer=${RUN_ID}-a11y-${name}`;
const longText = Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1} about this class, which goes on for a while.</p>`).join('') + '<p><a href="/faq-link">Last link</a></p>';

let lone: Seeded;
let pairA: Seeded;
let pairB: Seeded;

test.beforeAll(async () => {
  // A new worker (after a failed test) runs this again: drop the first copies,
  // or the pair's block would list each class twice.
  await db.from('events').delete().like('title', 'ZZZ%A11y%');
  lone = await seedEvent({ name: 'A11y Lone', flyerUrl: flyer('lone'), description: longText, dayOffset: 60 });
  pairA = await seedEvent({ name: 'A11y Pair One', flyerUrl: flyer('pair'), dayOffset: 61 });
  pairB = await seedEvent({ name: 'A11y Pair Two', flyerUrl: flyer('pair'), dayOffset: 62 });
});

const block = (page: Page, s: Seeded) => page.locator('[data-flyer-block]', { has: page.locator(`[data-offering-key="${s.key}"]`) });

test('only the first flyer on the page loads eagerly; the rest wait until scrolled to', async ({ page }) => {
  await page.goto('/');
  const loading = await page.locator('[data-flyer-open]:not([data-gallery-flyer]) img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('loading')));
  expect(loading[0]).toBe('eager');
  expect(loading.slice(1).every((l) => l === 'lazy')).toBe(true);
});

test("a flyer is named by what it advertises, and its full-size view says the same", async ({ page }) => {
  await page.goto('/');
  const open = block(page, pairA).locator('[data-flyer-open]');
  await expect(open).toHaveAccessibleName(`Flyer for ${pairA.title} and ${pairB.title} Tap to view full size`);
  await open.click();
  await expect(page.locator('#flyer-dialog-img')).toHaveAttribute('alt', `Flyer for ${pairA.title} and ${pairB.title}`);
});

test('Read more says whether it is open, and tabbing into the cut-off text shows it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const preview = block(page, lone).locator('[data-desc-preview]');
  const toggle = preview.locator('[data-desc-toggle]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', `desc-${lone.key}`);

  // The link at the end is clipped out of view until focus reaches it.
  await preview.getByRole('link', { name: 'Last link' }).focus();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText('Show less');
  // No longer cut off by the clipped box. (Not checked against the window:
  // other runs' test flyers above load without a size and push the page down.)
  await expect
    .poll(() =>
      preview.getByRole('link', { name: 'Last link' }).evaluate((link) => {
        const clip = link.closest('[data-desc-clip]')!.getBoundingClientRect();
        const r = link.getBoundingClientRect();
        return r.height > 0 && r.top >= clip.top && r.bottom <= clip.bottom + 1;
      })
    )
    .toBe(true);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveText('Read more');
});

test("an admin's move arrows say which flyer they move", async ({ page, adminPage }) => {
  void adminPage;
  await page.goto('/');
  const b = block(page, pairA);
  await expect(b.locator('[data-move="-1"]')).toBeVisible();
  await expect(b.locator('[data-move="-1"]')).toHaveAccessibleName(`Move ${pairA.title} and ${pairB.title} up`);
  await expect(b.locator('[data-move="1"]')).toHaveAccessibleName(`Move ${pairA.title} and ${pairB.title} down`);
});

test.describe('the editor flyer upload', () => {
  async function openEditor(page: Page, s: Seeded) {
    const { data } = await db.from('events').select('start_time').eq('id', s.ids[0]).single();
    const d = new Date(data!.start_time);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await page.goto(`/calendar?month=${month}`);
    await expect(page.locator('#add-event-btn')).toBeVisible();
    await page.locator('.event-banner', { hasText: s.title }).first().click();
    await page.locator('#detail-edit-btn').click();
    await expect(page.locator('#event-modal')).toBeVisible();
  }

  test('is reachable by keyboard, and a large see-through PNG keeps its transparency and its size', async ({ page, adminPage }) => {
    void adminPage;
    await openEditor(page, lone);
    // Focusable (only visually hidden), and the existing-flyer picker has a name.
    await page.locator('#event-flyer-file').focus();
    await expect(page.locator('#event-flyer-file')).toBeFocused();
    await expect(page.locator('#event-flyer-existing')).toHaveAttribute('aria-label', 'Use an existing flyer');

    // Answered here, so nothing reaches storage.
    let uploaded = '';
    await page.route('**/api/admin/upload-event-image', async (route) => {
      uploaded = route.request().postDataBuffer()?.toString('latin1') ?? '';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: flyer('uploaded') }) });
    });
    // Wider than 2000px, so it's scaled down and re-encoded; fully transparent.
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 2400;
      c.height = 1200;
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#event-flyer-file').setInputFiles({ name: 'clear.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(page.locator('#event-flyer-upload-label')).toHaveText('Replace Flyer');

    expect(uploaded).toContain('Content-Type: image/webp');
    expect(uploaded).not.toContain('Content-Type: image/jpeg');
    expect(uploaded).toMatch(/name="width"\r\n\r\n2000\r\n/);
    expect(uploaded).toMatch(/name="height"\r\n\r\n1000\r\n/);
  });
});
