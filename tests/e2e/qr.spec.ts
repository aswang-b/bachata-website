import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { test, expect } from './support/fixtures';
import { db, seedEvent, sweepTestData } from './support/db';
import { signInBrowser } from './support/admin';

// Door signs (/admin/qr). The test server fakes qr.dancewithb.fun and Venmo
// (E2E_FAKE_QR): short links, branded codes and saved signs live in its
// memory (a fresh server each run), so no real link is repointed and nobody is
// looked up; any username is "found" (with a made-up id) except "missing". Its
// generator (embedded, served by this site in tests: api/fake-qr-embed.ts) "makes" codes at once and reports back with the
// same messages as the real one.
test.afterAll(sweepTestData);

const DANCE_WITH_B_VENMO = 'https://venmo.com/code?user_id=2024335518728192092';
const SHORT = /https:\/\/qr\.example\.test\/c\/\w+/;

// What a drawn code opens, read the way a phone would.
async function decode(canvas: Locator): Promise<string | null> {
  const dataUrl = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL('image/png'));
  const { data, info } = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

async function pickClass(page: Page, title: string) {
  await page.locator('.class-item', { hasText: title }).locator('.class-select-btn').click();
}

const card = (page: Page, heading: string) => page.locator('.door-sign', { hasText: heading });
const linkOf = async (page: Page, heading: string) => (await card(page, heading).textContent())!.match(SHORT)![0];

async function saveNew(page: Page, heading: string, classTitle: string) {
  await page.locator('#new-sign').click();
  await pickClass(page, classTitle);
  await page.locator('#sign-heading').fill(heading);
  await page.locator('#sign-save').click();
  await expect(page.locator('#sign-status')).toContainText('Saved');
  return linkOf(page, heading);
}

test('saved door signs: each gets its own short link and branded code, repoints with care, and frees its link when deleted', async ({ page, adminPage }) => {
  void adminPage;
  const first = await seedEvent({ name: 'Door Sign A', priceDropIn: 15 });
  const second = await seedEvent({ name: 'Door Sign B', priceDropIn: 15 });
  const run = first.title.split(' Door Sign')[0];
  const monday = `${run} Monday`;

  // The old check-in QR address lands here.
  await page.goto('/admin/checkin-qr');
  await expect(page).toHaveURL(/\/admin\/qr$/);
  await expect(page.locator('#qr-admin')).toBeVisible();
  await expect(page.locator('#connection')).toContainText('Connected');

  // A new sign: a plain code straight to the classes picked, before it's saved.
  const preview = page.locator('#sign-preview');
  await pickClass(page, first.title);
  await expect(page.locator('#opens')).toContainText('A plain code for now');
  await expect.poll(() => decode(preview.locator('.sign-half').first().locator('canvas'))).toMatch(new RegExp(`/check-in/${first.ids[0]}$`));
  await expect(preview.locator('.sign-names .sign-note')).toHaveText([first.title]);

  // Dance with B's Venmo by default: the code Venmo's own scanner reads, and the name it shows when paying.
  expect(await decode(preview.locator('.sign-half').nth(1).locator('canvas'))).toBe(DANCE_WITH_B_VENMO);
  await expect(preview).toContainText('@amumira · B Zh');
  await expect(preview).toContainText('Haven’t paid yet?');
  await expect(preview).not.toContainText('Step');

  // Saved: it gets its own short link, which the code opens.
  await page.locator('#sign-heading').fill(monday);
  await page.locator('#sign-save').click();
  await expect(page.locator('#sign-status')).toContainText('Saved');
  await expect(card(page, monday)).toContainText(first.title);
  await expect(card(page, monday)).toContainText('scans this week');
  const mondayLink = await linkOf(page, monday);

  // Its new link has no branded code, so the QR site's generator, embedded here, makes one (and spares) on its own.
  await expect(page.locator('#codes-status')).toContainText('ready');
  await expect(page.locator('#codes-dialog')).toBeHidden();
  await expect(card(page, monday)).toContainText('branded code ready');
  await expect(page.locator('#codes-needed')).toBeHidden();
  await expect(preview.locator('.sign-code img')).toBeVisible();
  // Made in vivid colours, so nothing offers to remake them.
  await expect(page.locator('#codes-standard')).toBeHidden();

  // Opened from its card: the branded code, and its simple version opens the same short link.
  await card(page, monday).getByRole('button', { name: 'Open' }).click();
  const full = page.locator('#full-sign');
  await expect(full.locator('.sign-code img')).toBeVisible();
  // All of it fits on the screen, down to the button under the class names (it once ran off the bottom).
  const bottom = await full.evaluate((f) => Math.max(...[...f.querySelectorAll('.sign-half > *')].map((n) => n.getBoundingClientRect().bottom)));
  expect(bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  await full.getByRole('button', { name: /Hard to scan/ }).click();
  expect(await decode(full.locator('.sign-half').first().locator('canvas'))).toBe(mondayLink);
  await page.locator('#full-close').click();

  // Edited to other classes right after it was made: it's still being set up, so it doesn't ask first.
  await card(page, monday).getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#editor-title')).toContainText(monday);
  await pickClass(page, second.title);
  await expect(page.locator('#opens')).toContainText('aren’t saved yet');
  await page.locator('#sign-save').click();
  await expect(page.locator('#sign-status')).toContainText('Saved');
  await expect(page.locator('#point-anyway')).toHaveCount(0);
  await expect(card(page, monday)).toContainText(second.title);
  await expect(preview.locator('.sign-names .sign-note')).toHaveText([first.title, second.title]);
  expect(await linkOf(page, monday)).toBe(mondayLink);

  // A second sign gets a different link (one of the spares the branded codes were made for).
  const tuesdayLink = await saveNew(page, `${run} Tuesday`, second.title);
  expect(tuesdayLink).not.toBe(mondayLink);
  await expect(card(page, `${run} Tuesday`)).toContainText('branded code ready');

  // Deleting the first frees its link: the next new sign gets it, branded code and all.
  page.once('dialog', (d) => d.accept());
  await card(page, monday).getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, monday)).toHaveCount(0);
  expect(await saveNew(page, `${run} Wednesday`, first.title)).toBe(mondayLink);
  await expect(card(page, `${run} Wednesday`)).toContainText('branded code ready');

  // Only the generator's own messages count: one from anywhere else changes nothing.
  await page.evaluate(() => window.postMessage({ type: 'qr-done', results: [] }, '*'));
  await expect(page.locator('#codes-dialog')).toBeHidden();

  // Back from the full-page generator (the fallback), the codes it made are picked up.
  await page.goto(`/admin/qr?qr_ids=${mondayLink.split('/c/')[1]}:1`);
  await expect(page.locator('#page-status')).toContainText('Made branded codes for 1 short link');
  await expect(page).toHaveURL(/\/admin\/qr$/);

  // Once a sign's class has passed it isn't listed to pick, but its heading can still be changed, keeping the class.
  const past = await seedEvent({ name: 'Door Sign Past', priceDropIn: 15 });
  await page.reload();
  await expect(page.locator('#qr-admin')).toBeVisible();
  await saveNew(page, `${run} Thursday`, past.title);
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  await db.from('events').update({ start_time: new Date(yesterday).toISOString(), end_time: new Date(yesterday + 3600_000).toISOString() }).eq('id', past.ids[0]);
  await page.reload();
  await card(page, `${run} Thursday`).getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#opens')).toContainText('have passed');
  await page.locator('#sign-heading').fill(`${run} Thursday redone`);
  await expect(page.locator('#sign-save')).toBeEnabled();
  await page.locator('#sign-save').click();
  await expect(page.locator('#sign-status')).toContainText('Saved');
  await expect(card(page, `${run} Thursday redone`)).toContainText(past.title);

  // Downloads as a picture, named for its heading.
  const download = page.waitForEvent('download');
  await card(page, `${run} Tuesday`).getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toMatch(/tuesday\.png$/);
});

test('Venmo on a sign: an artist found by username, remembered, then removed; or no Venmo code at all', async ({ page, adminPage }) => {
  void adminPage;
  const event = await seedEvent({ name: 'Door Sign Venmo', priceDropIn: 15 });
  await page.goto('/admin/qr');
  await expect(page.locator('#qr-admin')).toBeVisible();
  await pickClass(page, event.title);
  const preview = page.locator('#sign-preview');

  await page.getByRole('radio', { name: /Someone else/ }).check();
  await page.locator('#venmo-username').fill('missing');
  await page.locator('#venmo-find').click();
  await expect(page.locator('#venmo-status')).toContainText('Venmo has no @missing');
  await page.locator('#venmo-username').fill('@lunamoves');
  await page.locator('#venmo-find').click();
  await expect(page.locator('#venmo-found')).toContainText('Test lunamoves');
  await expect(preview).toContainText('@lunamoves · Test lunamoves');
  expect(await decode(preview.locator('.sign-half').nth(1).locator('canvas'))).toBe('https://venmo.com/code?user_id=1234567890123456789');
  await page.locator('#venmo-label').fill('Luna');
  await page.locator('#venmo-remember').click();
  await expect(page.getByRole('radio', { name: /Luna/ })).toBeChecked();
  await page.locator('#tab-venmo').click();
  const luna = page.locator('.venmo-account', { hasText: '@lunamoves' });
  await luna.getByRole('button', { name: 'Remove' }).click();
  await expect(luna).toHaveCount(0);
  await page.locator('#tab-sign').click();
  await expect(page.getByRole('radio', { name: /Luna/ })).toHaveCount(0);

  // No Venmo code: just check-in.
  await page.getByRole('radio', { name: /No Venmo code/ }).check();
  await expect(preview.locator('.sign-half')).toHaveCount(1);
});

test('on a phone, the full-screen sign shows one code at a time and the page never scrolls sideways', async ({ browser, adminSession }) => {
  const event = await seedEvent({ name: 'Door Sign Phone', priceDropIn: 15 });
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  await signInBrowser(context, adminSession);
  const page = await context.newPage();
  await page.goto('/admin/qr');
  await expect(page.locator('#qr-admin')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await pickClass(page, event.title);

  await page.locator('#show-full').click();
  const halves = page.locator('#full-sign .sign-half');
  await expect(halves.first()).toBeVisible();
  await expect(halves.nth(1)).toBeHidden();
  await page.locator('#full-switch').getByRole('button', { name: 'Pay' }).click();
  await expect(halves.nth(1)).toBeVisible();
  await expect(halves.first()).toBeHidden();
  expect(await decode(halves.nth(1).locator('canvas'))).toBe(DANCE_WITH_B_VENMO);
  await context.close();
});
